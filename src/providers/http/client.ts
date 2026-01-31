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

export interface HttpClientOptions {
    /** 请求超时时间（毫秒） */
    timeout?: number;
    /** 最大重试次数 */
    maxRetries?: number;
    /** 初始重试延迟（毫秒） */
    initialRetryDelay?: number;
    /** 最大重试延迟（毫秒） */
    maxRetryDelay?: number;
    /** 启用调试日志 */
    debug?: boolean;
}

export interface RequestInitWithOptions extends RequestInit {
    timeout?: number;
    maxRetries?: number;
}

/**
 * 带重试逻辑和错误处理的 HTTP 客户端
 */
export class HTTPClient {
    readonly defaultTimeout: number;
    readonly maxRetries: number;
    readonly initialRetryDelay: number;
    readonly maxRetryDelay: number;
    readonly debug: boolean;

    constructor(options: HttpClientOptions = {}) {
        this.defaultTimeout = options.timeout ?? 1000*60*10;// 10 minutes
        this.maxRetries = options.maxRetries ?? 10;
        this.initialRetryDelay = options.initialRetryDelay ?? 1000;
        this.maxRetryDelay = options.maxRetryDelay ?? 10000;
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
        const maxRetries = options.maxRetries ?? this.maxRetries;

        let lastError: Error | undefined;
        let attempt = 0;

        while (attempt <= maxRetries) {
            try {
                if (this.debug) {
                   console.log(`[HTTPClient] Attempt ${attempt + 1}/${maxRetries + 1}: ${options.method || 'GET'} ${url}`);
                }
                console.log(options);
                const response = await this.fetchWithTimeout(url, options, timeout);

                // 检查 HTTP 错误
                if (!response.ok) {
                    const errorText = await response.text();
                    const error = createErrorFromStatus(response.status, response.statusText, errorText);

                    // 不重试永久性错误
                    if (!isRetryableError(error)) {
                        throw error;
                    }

                    lastError = error;
                    attempt++;

                    // 计算重试前的延迟
                    if (attempt <= maxRetries) {
                        const delay = this.calculateRetryDelay(attempt, error as LLMRetryableError);
                        if (this.debug) {
                           console.log(`[HTTPClient] Retrying after ${delay}ms...`);
                        }
                        await this.sleep(delay);
                        continue;
                    }

                    throw error;
                }

                return response;
            } catch (error) {
                // 如果是网络错误或超时，可能可以重试
                if (this.isNetworkError(error) || this.isTimeoutError(error)) {
                    lastError = error as Error;
                    attempt++;

                    if (attempt <= maxRetries) {
                        const delay = this.calculateRetryDelay(attempt);
                        if (this.debug) {
                           console.log(`[HTTPClient] Network error, retrying after ${delay}ms...`);
                        }
                        await this.sleep(delay);
                        continue;
                    }
                }

                // 重新抛出不可重试的错误
                throw error;
            }
        }

        // 不应该到达这里，但以防万一
        throw lastError || new LLMError('Max retries exceeded');
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
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // 如果提供了 options.signal，则合并 abort 信号
        const signal = options.signal;
        if (signal) {
            // 如果原始信号被中止，也中止我们的超时控制器
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: options.headers,
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);

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

    /**
     * 计算带指数退避的重试延迟
     */
    private calculateRetryDelay(attempt: number, error?: LLMRetryableError): number {
        // 如果可用，使用错误建议的 retry-after
        if (error?.retryAfter) {
            return Math.min(error.retryAfter, this.maxRetryDelay);
        }

        // 指数退避：2^attempt * initialDelay
        const delay = Math.min(
            this.initialRetryDelay * Math.pow(2, attempt),
            this.maxRetryDelay
        );

        // 添加抖动（±25%）
        const jitter = delay * 0.25;
        return delay - jitter + Math.random() * jitter * 2;
    }

    /**
     * 检查错误是否为网络错误（可重试）
     */
    private isNetworkError(error: unknown): boolean {
        if (!(error instanceof Error)) {
            return false;
        }

        // 常见的网络错误模式
        const networkPatterns = [
            'ECONNREFUSED',
            'ECONNRESET',
            'ENOTFOUND',
            'ENETUNREACH',
            'EAI_AGAIN',
            'fetch failed',
            'network',
        ];

        const message = error.message.toLowerCase();
        return networkPatterns.some((pattern) =>
            message.includes(pattern.toLowerCase())
        );
    }

    /**
     * 检查错误是否为超时错误（可重试）
     */
    private isTimeoutError(error: unknown): boolean {
        if (!(error instanceof Error)) {
            return false;
        }

        const message = error.message.toLowerCase();
        return (
            message.includes('timeout') ||
            message.includes('aborted') ||
            error.name === 'AbortError'
        );
    }

    /**
     * 休眠指定时长
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
