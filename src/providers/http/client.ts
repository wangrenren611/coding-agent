/**
 * HTTP 客户端工具
 *
 * 提供统一的 HTTP 客户端，具有以下功能：
 * - 单次请求执行（不包含重试）
 * - 超时处理
 * - Abort 信号支持
 * - 与 LLM 错误类型集成的错误处理
 */

import {
    LLMError,
    LLMAbortedError,
    LLMRetryableError,
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
 * 带超时和错误归一化的 HTTP 客户端
 */
export class HTTPClient {
    readonly defaultTimeout: number;
    readonly debug: boolean;

    constructor(options: HttpClientOptions) {
        this.defaultTimeout = options.timeout;
        this.debug = options.debug ?? false;
    }

    /**
     * 单次 Fetch（重试由上层 Agent 负责）
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
                throw createErrorFromStatus(response.status, response.statusText, errorText);
            }

            return response;
        } catch (rawError) {
            throw this.normalizeError(rawError, timeout, options.signal ?? undefined);
        }
    }

    /**
     * 带超时支持的 Fetch
     */
    private async fetchWithTimeout(
        url: string,
        options: RequestInit,
        timeout: number
    ): Promise<Response> {
        const upstreamSignal = options.signal;
        const timeoutSignal = AbortSignal.timeout(timeout);
        const combinedSignal = upstreamSignal
            ? AbortSignal.any([upstreamSignal, timeoutSignal])
            : timeoutSignal;

        try {
            if (this.debug) {
                console.log(`[HTTPClient] Sending request: ${options.method || 'GET'} ${url}`);
            }
            fs.writeFileSync('./request.json', JSON.stringify(options, null, 2));
            const response = await fetch(url, {
                ...options,
                signal: combinedSignal,
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

            if (upstreamSignal?.aborted) {
                throw new LLMAbortedError('Request was cancelled by upstream signal');
            }

            if (timeoutSignal.aborted) {
                throw new LLMRetryableError(
                    `Request timeout after ${timeout}ms`,
                    timeout,
                    'TIMEOUT'
                );
            }

            throw error;
        }
    }

    private normalizeError(
        error: unknown,
        timeout: number,
        signal?: AbortSignal
    ): Error {
        if (error instanceof LLMError) {
            return error;
        }

        if (signal?.aborted) {
            return new LLMAbortedError('Request was cancelled');
        }

        if (this.isBodyTimeoutLikeError(error)) {
            return new LLMRetryableError(
                `Response body timeout after ${timeout}ms`,
                undefined,
                'BODY_TIMEOUT'
            );
        }

        if (this.isNetworkLikeError(error)) {
            const message = error instanceof Error ? error.message : String(error);
            return new LLMRetryableError(
                `Network request failed: ${message}`,
                undefined,
                'NETWORK_ERROR'
            );
        }

        if (error instanceof Error) {
            return error;
        }

        return new LLMError(String(error));
    }

    private isBodyTimeoutLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;

        const code = this.getErrorCode(error);
        const message = `${error.name} ${error.message}`.toLowerCase();

        return (
            code === 'UND_ERR_BODY_TIMEOUT'
            || message.includes('body timeout')
            || message.includes('terminated')
        );
    }

    private isNetworkLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;

        const code = this.getErrorCode(error);
        if (!code) {
            // Node fetch/undici 常见网络失败会以 TypeError 抛出
            return error instanceof TypeError;
        }

        return [
            'ECONNRESET',
            'ECONNREFUSED',
            'ENOTFOUND',
            'EAI_AGAIN',
            'ETIMEDOUT',
            'UND_ERR_SOCKET',
            'UND_ERR_CONNECT_TIMEOUT',
            'UND_ERR_HEADERS_TIMEOUT',
            'UND_ERR_ABORTED',
        ].includes(code);
    }

    private getErrorCode(error: Error): string | undefined {
        const withCode = error as Error & { code?: unknown; cause?: unknown };
        if (typeof withCode.code === 'string') {
            return withCode.code;
        }
        const cause = withCode.cause as { code?: unknown } | undefined;
        if (cause && typeof cause.code === 'string') {
            return cause.code;
        }
        return undefined;
    }
}
