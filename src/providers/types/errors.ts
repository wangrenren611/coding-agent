/**
 * Provider 错误类型定义
 *
 * 统一的错误类型定义，包括基础错误、可重试错误、永久性错误等
 */

// =============================================================================
// 错误基类
// =============================================================================

export class LLMError extends Error {
    constructor(
        message: string,
        public code?: string
    ) {
        super(message);
        this.name = 'LLMError';
    }
}

// =============================================================================
// 可重试错误
// =============================================================================

export class LLMRetryableError extends LLMError {
    constructor(
        message: string,
        public retryAfter?: number,
        code?: string
    ) {
        super(message, code);
        this.name = 'LLMRetryableError';
    }

    getBackoff(retryCount: number): number {
        if (this.retryAfter) return this.retryAfter;
        return Math.pow(2, retryCount) * 1000;
    }
}

export class LLMRateLimitError extends LLMRetryableError {
    constructor(message: string, retryAfter?: number) {
        super(message, retryAfter, 'RATE_LIMIT');
        this.name = 'LLMRateLimitError';
    }
}

// =============================================================================
// 永久性错误
// =============================================================================

export class LLMPermanentError extends LLMError {
    constructor(
        message: string,
        public statusCode?: number,
        code?: string
    ) {
        super(message, code);
        this.name = 'LLMPermanentError';
    }
}

export class LLMAuthError extends LLMPermanentError {
    constructor(message: string) {
        super(message, 401, 'AUTH_FAILED');
        this.name = 'LLMAuthError';
    }
}

export class LLMNotFoundError extends LLMPermanentError {
    constructor(
        message: string,
        public resourceType?: 'model' | 'endpoint' | 'resource'
    ) {
        super(message, 404, 'NOT_FOUND');
        this.name = 'LLMNotFoundError';
    }
}

export class LLMBadRequestError extends LLMPermanentError {
    constructor(
        message: string,
        public validationErrors?: Record<string, string>
    ) {
        super(message, 400, 'BAD_REQUEST');
        this.name = 'LLMBadRequestError';
    }
}

// =============================================================================
// 取消错误
// =============================================================================

export class LLMAbortedError extends LLMError {
    constructor(message: string = 'Request was cancelled') {
        super(message, 'ABORTED');
        this.name = 'LLMAbortedError';
    }
}

// =============================================================================
// 工具函数
// =============================================================================

export type AbortReasonCategory = 'idle_timeout' | 'timeout' | 'abort' | 'unknown';

export const PERMANENT_STREAM_ERROR_CODE_MARKERS = [
    'invalid_request',
    'bad_request',
    'authentication',
    'permission',
    'forbidden',
    'not_found',
    'unsupported',
    'context_length',
    'content_filter',
    'safety',
    'invalid_parameter_error',
] as const;

export const PERMANENT_STREAM_ERROR_MESSAGE_PATTERNS: ReadonlyArray<RegExp> = [
    /\binvalid[\s_-]?request\b/i,
    /\bbad[\s_-]?request\b/i,
    /\bauthentication\b/i,
    /\bunauthorized\b/i,
    /\bpermission\b/i,
    /\bforbidden\b/i,
    /\bnot[\s_-]?found\b/i,
    /\bunsupported\b/i,
    /\bcontext[\s_-]?length\b/i,
    /\bcontent[\s_-]?filter\b/i,
    /\bsafety\b/i,
    /\binvalid[\s_-]?parameter\b/i,
];

export function abortReasonToText(reason: unknown): string {
    if (reason instanceof Error) {
        return `${reason.name} ${reason.message}`.trim();
    }
    if (typeof reason === 'string') {
        return reason.trim();
    }
    return '';
}

export function isIdleTimeoutReasonText(reasonText: string): boolean {
    const signature = reasonText.toLowerCase();
    return (
        signature.includes('idle timeout') || signature.includes('idletimeout') || signature.includes('idle_timeout')
    );
}

export function isTimeoutReasonText(reasonText: string): boolean {
    const signature = reasonText.toLowerCase();
    return (
        signature.includes('timeout') ||
        signature.includes('timed out') ||
        signature.includes('time out') ||
        signature.includes('signal timed out')
    );
}

export function classifyAbortReason(reason: unknown): AbortReasonCategory {
    const reasonText = abortReasonToText(reason);
    if (!reasonText) {
        return 'unknown';
    }

    if (isIdleTimeoutReasonText(reasonText)) {
        return 'idle_timeout';
    }

    if (isTimeoutReasonText(reasonText)) {
        return 'timeout';
    }

    const signature = reasonText.toLowerCase();
    if (signature.includes('abort') || signature.includes('cancel')) {
        return 'abort';
    }

    return 'unknown';
}

export function isPermanentStreamChunkError(code?: string, message?: string): boolean {
    const normalizedCode = typeof code === 'string' ? code.toLowerCase() : '';
    if (normalizedCode) {
        const matchedByCode = PERMANENT_STREAM_ERROR_CODE_MARKERS.some((marker) => normalizedCode.includes(marker));
        if (matchedByCode) {
            return true;
        }
    }

    const normalizedMessage = typeof message === 'string' ? message : '';
    if (!normalizedMessage) {
        return false;
    }

    return PERMANENT_STREAM_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}

export function createErrorFromStatus(
    status: number,
    statusText: string,
    errorText: string,
    retryAfterMs?: number
): LLMError {
    let details = errorText;
    try {
        const parsed = JSON.parse(errorText);
        details = parsed.error?.message || errorText;
    } catch {
        // 使用原始文本
    }

    const message = `${status} ${statusText}${details ? ` - ${details}` : ''}`;

    switch (status) {
        case 401:
        case 403:
            return new LLMAuthError(message);
        case 404:
            return new LLMNotFoundError(message, 'resource');
        case 408:
            return new LLMRetryableError(message, retryAfterMs, 'TIMEOUT');
        case 429:
            return new LLMRateLimitError(message, retryAfterMs);
        case 400:
            return new LLMBadRequestError(message);
        case 501:
            return new LLMPermanentError(message, 501, 'NOT_IMPLEMENTED');
        case 500:
        case 502:
        case 503:
        case 504:
            return new LLMRetryableError(message, retryAfterMs, `SERVER_${status}`);
        default:
            return new LLMError(message, `HTTP_${status}`);
    }
}

export function isRetryableError(error: unknown): error is LLMRetryableError {
    return error instanceof LLMRetryableError;
}

export function isPermanentError(error: unknown): error is LLMPermanentError {
    return error instanceof LLMPermanentError;
}

export function isAbortedError(error: unknown): error is LLMAbortedError {
    return error instanceof LLMAbortedError;
}
