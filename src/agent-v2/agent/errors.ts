/**
 * Agent 错误类定义
 * 
 * 设计原则：
 * 1. 支持错误码（code）- 便于程序化区分错误类型
 * 2. 支持错误链（cause）- 便于追踪原始错误
 * 3. 支持上下文（context）- 便于调试和问题定位
 */

// ==================== 基础错误接口 ====================

export interface AgentErrorOptions {
    /** 错误代码 */
    code?: string;
    /** 原始错误（错误链） */
    cause?: unknown;
    /** 上下文信息（用于调试） */
    context?: Record<string, unknown>;
}

// ==================== ToolError ====================

export class ToolError extends Error {
    public readonly code?: string;
    public readonly cause?: unknown;
    public readonly context?: Record<string, unknown>;

    constructor(message: string, options?: AgentErrorOptions) {
        super(message, { cause: options?.cause });
        this.name = 'ToolError';
        this.code = options?.code;
        this.cause = options?.cause;
        this.context = options?.context;
    }

    /**
     * 创建带上下文的错误
     */
    static withContext(message: string, context: Record<string, unknown>, cause?: unknown): ToolError {
        return new ToolError(message, { context, cause });
    }
}

// ==================== AgentError ====================

export class AgentError extends Error {
    public readonly code?: string;
    public readonly cause?: unknown;
    public readonly context?: Record<string, unknown>;

    constructor(message: string, options?: AgentErrorOptions) {
        super(message, { cause: options?.cause });
        this.name = 'AgentError';
        this.code = options?.code;
        this.cause = options?.cause;
        this.context = options?.context;
    }

    /**
     * 创建带上下文的错误
     */
    static withContext(message: string, context: Record<string, unknown>, cause?: unknown): AgentError {
        return new AgentError(message, { context, cause });
    }
}

// ==================== CompensationRetryError ====================

export class CompensationRetryError extends Error {
    public readonly code?: string;
    public readonly cause?: unknown;
    public readonly context?: Record<string, unknown>;

    constructor(message: string = 'Compensation retry requested.', options?: AgentErrorOptions) {
        super(message, { cause: options?.cause });
        this.name = 'CompensationRetryError';
        this.code = options?.code ?? 'COMPENSATION_RETRY';
        this.cause = options?.cause;
        this.context = options?.context;
    }
}

// ==================== LLMRetryableError ====================

export interface LLMRetryableErrorOptions extends AgentErrorOptions {
    /** 重试等待时间（毫秒） */
    retryAfter?: number;
    /** 错误类型 */
    errorType?: string;
}

export class LLMRetryableError extends Error {
    public readonly code?: string;
    public readonly cause?: unknown;
    public readonly context?: Record<string, unknown>;
    public readonly retryAfter?: number;
    public readonly errorType?: string;

    constructor(
        message: string,
        retryAfter?: number,
        errorType?: string,
        options?: AgentErrorOptions
    ) {
        super(message, { cause: options?.cause });
        this.name = 'LLMRetryableError';
        this.code = options?.code ?? 'LLM_RETRYABLE';
        this.cause = options?.cause;
        this.context = options?.context;
        this.retryAfter = retryAfter;
        this.errorType = errorType;
    }

    /**
     * 创建超时错误
     */
    static timeout(timeoutMs: number): LLMRetryableError {
        return new LLMRetryableError(
            `LLM request timed out after ${timeoutMs}ms`,
            5000,
            'TIMEOUT'
        );
    }

    /**
     * 创建速率限制错误
     */
    static rateLimit(retryAfterMs: number): LLMRetryableError {
        return new LLMRetryableError(
            'Rate limit exceeded',
            retryAfterMs,
            'RATE_LIMIT'
        );
    }
}

// ==================== 类型守卫 ====================

export function isAgentError(error: unknown): error is AgentError {
    return error instanceof AgentError;
}

export function isToolError(error: unknown): error is ToolError {
    return error instanceof ToolError;
}

export function isLLMRetryableError(error: unknown): error is LLMRetryableError {
    return error instanceof LLMRetryableError;
}

export function isCompensationRetryError(error: unknown): error is CompensationRetryError {
    return error instanceof CompensationRetryError;
}
