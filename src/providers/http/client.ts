/**
 * HTTP 客户端工具
 *
 * 提供统一的 HTTP 客户端，具有以下功能：
 * - 带指数退避的重试逻辑
 * - 超时处理
 * - Abort 信号支持
 * - 与 LLM 错误类型集成的错误处理
 */

import {
    LLMError,
    LLMRetryableError,
    isRetryableError,
    createErrorFromStatus,
} from '../types';
import fs from 'fs';

export interface HttpClientOptions {
    /** 请求超时时间（毫秒） */
    timeout: number;
    /** 启用调试日志 */
    debug?: boolean;
}

export interface RequestInitWithOptions extends RequestInit {
    timeout?: number;
}

/**
 * 带重试逻辑和错误处理的 HTTP 客户端
 */
export class HTTPClient {
    readonly defaultTimeout: number;
    readonly debug: boolean;

    constructor(options: HttpClientOptions) {
        this.defaultTimeout = options.timeout;
        this.debug = options.debug ?? false;
    }

    /**
     * 带重试逻辑和超时的 Fetch
     */
    async fetch(
        url: string,
        options: RequestInitWithOptions = {}
    ): Promise<Response> {
        const timeout = options.timeout ?? this.defaultTimeout;

        try {
            const response = await this.fetchWithTimeout(url, options, timeout);

            // 检查 HTTP 错误
            if (!response.ok) {
                const errorText = await response.text();
                const error = createErrorFromStatus(response.status, response.statusText, errorText);
                throw error;
            }

            return response;
        } catch (error) {

            // 重新抛出不可重试的错误
            throw error;
        }


        // 不应该到达这里，但以防万一
        //throw lastError || new LLMError('Max retries exceeded');
    }

    /**
     * 带超时支持的 Fetch
     */
    private async fetchWithTimeout(
        url: string,
        options: RequestInit,
        timeout: number
    ): Promise<Response> {
        const controller = new AbortController();

        // 如果提供了 options.signal，则合并 abort 信号
        const signal = options.signal;
        if (signal) {
            // 如果原始信号被中止，也中止我们的超时控制器
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            //  console.log(`[HTTPClient] start Sending request: ${options.method || 'GET'} ${url}`,JSON.parse(options.body).model);
            if (this.debug) {
                console.log(`[HTTPClient] Sending request: ${options.method || 'GET'} ${url}`,JSON.parse(options.body as string).model);
            }

            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: options.headers,
            });
            if (this.debug) {
                console.log(`[HTTPClient] end Sending request: ${options.method || 'GET'} ${url}`);
            }

            return response;
        } catch (error) {

            if (this.debug) {
                console.log(`[HTTPClient] Request failed: ${options.method || 'GET'} ${url}`);
            }

            // 检查是否是超时错误
            if (controller.signal.aborted && !signal?.aborted) {
                throw new LLMRetryableError(
                    `Request timeout after ${timeout}ms`,
                    timeout,
                    'TIMEOUT'
                );
            }

            throw error;
        }
    }



}
