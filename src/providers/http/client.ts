/**
 * HTTP 客户端工具
 *
 * 提供统一的 HTTP 客户端，具有以下功能：
 * - 单次请求执行（不包含重试）
 * - Abort 信号支持（超时由上层 Agent/LLMCaller 控制）
 * - 与 LLM 错误类型集成的错误处理
 *
 * 设计原则：
 * - 超时控制由上层 Agent 层统一管理
 * - HTTPClient 只负责执行请求和错误归一化
 * - 不在 HTTP 层创建额外的超时信号，避免多层超时叠加
 */

import { LLMError, LLMAbortedError, LLMRetryableError, createErrorFromStatus } from '../types';

export interface HttpClientOptions {
    /** 请求超时时间（毫秒）- 仅作为默认值，实际超时由 signal 控制 */
    timeout: number;
    /** 启用调试日志 */
    debug?: boolean;
}

export interface RequestInitWithOptions extends RequestInit {
    timeout?: number;
}

/**
 * HTTP 客户端
 *
 * 超时控制说明：
 * - 本层不再创建独立的超时信号
 * - 超时由上层通过 options.signal 传入（已包含超时逻辑）
 * - 这样确保 Agent 层完全控制超时行为和错误消息
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
     *
     * @param url - 请求 URL
     * @param options - 请求选项，signal 应已包含超时逻辑
     */
    async fetch(url: string, options: RequestInitWithOptions = {}): Promise<Response> {
        const timeout = options.timeout ?? this.defaultTimeout;
        try {
            const response = await this.executeFetch(url, options);

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
     * 执行 Fetch 请求
     *
     * 不再创建额外的超时信号，直接使用传入的 signal
     */
    private async executeFetch(url: string, options: RequestInit): Promise<Response> {
        const upstreamSignal = options.signal;

        try {
            if (this.debug) {
                console.log(`[HTTPClient] Sending request: ${options.method || 'GET'} ${url}`);
            }

            const response = await fetch(url, {
                ...options,
                signal: upstreamSignal,
            });

            if (this.debug) {
                console.log(`[HTTPClient] Response received: ${options.method || 'GET'} ${url}`);
            }

            return response;
        } catch (error) {
            if (this.debug) {
                console.log(`[HTTPClient] Request failed: ${options.method || 'GET'} ${url}`);
            }

            // 检查是否为超时或中止错误
            if (upstreamSignal?.aborted) {
                // 判断是超时还是用户中止
                const reason = this.getAbortReason(upstreamSignal);
                if (reason === 'timeout') {
                    throw new LLMRetryableError(`Request timeout`, undefined, 'TIMEOUT');
                }
                throw new LLMAbortedError('Request was cancelled by upstream signal');
            }

            throw error;
        }
    }

    /**
     * 获取 AbortSignal 的中止原因
     */
    private getAbortReason(signal: AbortSignal): 'timeout' | 'abort' | 'unknown' {
        // AbortSignal.timeout() 创建的信号会有特定的 reason
        try {
            const reason = signal.reason;
            if (reason instanceof Error) {
                if (reason.name === 'TimeoutError' || reason.message?.toLowerCase().includes('timeout')) {
                    return 'timeout';
                }
            }
            if (typeof reason === 'string' && reason.toLowerCase().includes('timeout')) {
                return 'timeout';
            }
        } catch {
            // 忽略访问 reason 的错误
        }
        return 'unknown';
    }

    /**
     * 归一化错误
     */
    private normalizeError(error: unknown, timeout: number, signal?: AbortSignal): Error {
        // 已经是 LLM 错误，直接返回
        if (error instanceof LLMError) {
            return error;
        }

        // 检查中止信号
        if (signal?.aborted) {
            const reason = this.getAbortReason(signal);
            if (reason === 'timeout') {
                return new LLMRetryableError(`Request timeout`, undefined, 'TIMEOUT');
            }
            return new LLMAbortedError('Request was cancelled');
        }

        // Body 超时类错误
        if (this.isBodyTimeoutLikeError(error)) {
            return new LLMRetryableError(`Response body timeout`, undefined, 'BODY_TIMEOUT');
        }

        // 网络类错误
        if (this.isNetworkLikeError(error)) {
            const message = error instanceof Error ? error.message : String(error);
            return new LLMRetryableError(`Network request failed: ${message}`, undefined, 'NETWORK_ERROR');
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

        return code === 'UND_ERR_BODY_TIMEOUT' || message.includes('body timeout') || message.includes('terminated');
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
