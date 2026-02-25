/**
 * Agent 错误类定义
 *
 * 设计原则：
 * 1. 支持错误码（code）- 便于程序化区分错误类型
 * 2. 支持错误链（cause）- 便于追踪原始错误
 * 3. 支持上下文（context）- 便于调试和问题定位
 * 4. 专用错误子类 - 类型安全，便于 instanceof 检查
 */

import type { AgentFailureCode } from './types';

// ==================== 错误码常量 ====================

/**
 * Agent 错误码常量
 * 与 AgentFailureCode 类型保持同步
 */
export const AgentErrorCode = {
    // Agent 状态错误
    ABORTED: 'AGENT_ABORTED',
    BUSY: 'AGENT_BUSY',
    RUNTIME_ERROR: 'AGENT_RUNTIME_ERROR',
    // 重试相关
    MAX_RETRIES_EXCEEDED: 'AGENT_MAX_RETRIES_EXCEEDED',
    COMPENSATION_RETRY_EXCEEDED: 'AGENT_COMPENSATION_RETRY_EXCEEDED',
    LOOP_EXCEEDED: 'AGENT_LOOP_EXCEEDED',
    // 配置和验证错误
    CONFIGURATION_ERROR: 'AGENT_CONFIGURATION_ERROR',
    VALIDATION_ERROR: 'AGENT_VALIDATION_ERROR',
    // LLM 相关
    LLM_TIMEOUT: 'LLM_TIMEOUT',
    LLM_REQUEST_FAILED: 'LLM_REQUEST_FAILED',
    LLM_RESPONSE_INVALID: 'LLM_RESPONSE_INVALID',
    // 工具相关
    TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
} as const;

export type AgentErrorCodeValue = (typeof AgentErrorCode)[keyof typeof AgentErrorCode];

// ==================== 基础错误接口 ====================

export interface AgentErrorOptions {
    /** 错误代码 */
    code?: AgentFailureCode | string;
    /** 原始错误（错误链） */
    cause?: unknown;
    /** 上下文信息（用于调试） */
    context?: Record<string, unknown>;
}

// ==================== 基础错误类 ====================

/**
 * Agent 基础错误类
 */
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

// ==================== Agent 状态错误 ====================

/**
 * Agent 被中止错误
 */
export class AgentAbortedError extends AgentError {
    constructor(message: string = 'Task was aborted.') {
        super(message, { code: AgentErrorCode.ABORTED });
        this.name = 'AgentAbortedError';
    }
}

/**
 * Agent 忙碌错误
 */
export class AgentBusyError extends AgentError {
    constructor(status: string) {
        super(`Agent is not idle, current status: ${status}`, {
            code: AgentErrorCode.BUSY,
        });
        this.name = 'AgentBusyError';
    }
}

// ==================== 重试相关错误 ====================

/**
 * 超过最大重试次数错误
 */
export class AgentMaxRetriesExceededError extends AgentError {
    constructor(reason?: string) {
        const message = reason
            ? `Agent failed after maximum retries. ${reason}`
            : 'Agent failed after maximum retries.';
        super(message, { code: AgentErrorCode.MAX_RETRIES_EXCEEDED });
        this.name = 'AgentMaxRetriesExceededError';
    }
}

/**
 * 超过补偿重试次数错误
 */
export class AgentCompensationRetryExceededError extends AgentError {
    constructor() {
        super('Agent failed after maximum compensation retries.', {
            code: AgentErrorCode.COMPENSATION_RETRY_EXCEEDED,
        });
        this.name = 'AgentCompensationRetryExceededError';
    }
}

/**
 * 超过最大循环次数错误
 */
export class AgentLoopExceededError extends AgentError {
    constructor(maxLoops: number) {
        super(`Agent exceeded maximum loop count (${maxLoops}).`, {
            code: AgentErrorCode.LOOP_EXCEEDED,
        });
        this.name = 'AgentLoopExceededError';
    }
}

// ==================== 配置和验证错误 ====================

/**
 * Agent 配置错误
 */
export class AgentConfigurationError extends AgentError {
    constructor(message: string) {
        super(message, { code: AgentErrorCode.CONFIGURATION_ERROR });
        this.name = 'AgentConfigurationError';
    }
}

/**
 * Agent 输入验证错误
 */
export class AgentValidationError extends AgentError {
    constructor(message: string) {
        super(message, { code: AgentErrorCode.VALIDATION_ERROR });
        this.name = 'AgentValidationError';
    }
}

// ==================== LLM 相关错误 ====================

/**
 * LLM 请求错误
 */
export class LLMRequestError extends AgentError {
    constructor(message: string) {
        super(message, { code: AgentErrorCode.LLM_REQUEST_FAILED });
        this.name = 'LLMRequestError';
    }
}

/**
 * LLM 响应无效错误
 */
export class LLMResponseInvalidError extends AgentError {
    constructor(message: string = 'LLM response is invalid') {
        super(message, { code: AgentErrorCode.LLM_RESPONSE_INVALID });
        this.name = 'LLMResponseInvalidError';
    }
}

// ==================== 工具相关错误 ====================

/**
 * 工具执行错误
 */
export class ToolError extends Error {
    public readonly code?: string;
    public readonly cause?: unknown;
    public readonly context?: Record<string, unknown>;

    constructor(message: string, options?: AgentErrorOptions) {
        super(message, { cause: options?.cause });
        this.name = 'ToolError';
        this.code = options?.code ?? AgentErrorCode.TOOL_EXECUTION_FAILED;
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

// ==================== 特殊错误 ====================

/**
 * 补偿重试请求错误（内部使用）
 * 用于触发空响应补偿重试
 */
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

/**
 * LLM 可重试错误（Agent 层）
 */
export class LLMRetryableError extends Error {
    public readonly code?: string;
    public readonly cause?: unknown;
    public readonly context?: Record<string, unknown>;
    public readonly retryAfter?: number;
    public readonly errorType?: string;

    constructor(message: string, retryAfter?: number, errorType?: string, options?: AgentErrorOptions) {
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
        return new LLMRetryableError(`LLM request timed out after ${timeoutMs}ms`, 5000, 'TIMEOUT');
    }

    /**
     * 创建速率限制错误
     */
    static rateLimit(retryAfterMs: number): LLMRetryableError {
        return new LLMRetryableError('Rate limit exceeded', retryAfterMs, 'RATE_LIMIT');
    }
}

// ==================== 类型守卫 ====================

export function isAgentError(error: unknown): error is AgentError {
    return error instanceof AgentError;
}

export function isAgentAbortedError(error: unknown): error is AgentAbortedError {
    return error instanceof AgentAbortedError;
}

export function isAgentBusyError(error: unknown): error is AgentBusyError {
    return error instanceof AgentBusyError;
}

export function isAgentMaxRetriesExceededError(error: unknown): error is AgentMaxRetriesExceededError {
    return error instanceof AgentMaxRetriesExceededError;
}

export function isAgentCompensationRetryExceededError(error: unknown): error is AgentCompensationRetryExceededError {
    return error instanceof AgentCompensationRetryExceededError;
}

export function isAgentLoopExceededError(error: unknown): error is AgentLoopExceededError {
    return error instanceof AgentLoopExceededError;
}

export function isAgentConfigurationError(error: unknown): error is AgentConfigurationError {
    return error instanceof AgentConfigurationError;
}

export function isAgentValidationError(error: unknown): error is AgentValidationError {
    return error instanceof AgentValidationError;
}

export function isLLMRequestError(error: unknown): error is LLMRequestError {
    return error instanceof LLMRequestError;
}

export function isLLMResponseInvalidError(error: unknown): error is LLMResponseInvalidError {
    return error instanceof LLMResponseInvalidError;
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

/**
 * 检查错误是否有有效的失败码
 */
export function hasValidFailureCode(error: unknown): error is AgentError & { code: AgentFailureCode } {
    if (!(error instanceof AgentError)) return false;
    if (!error.code) return false;

    const validCodes: readonly string[] = [
        AgentErrorCode.ABORTED,
        AgentErrorCode.BUSY,
        AgentErrorCode.RUNTIME_ERROR,
        AgentErrorCode.MAX_RETRIES_EXCEEDED,
        AgentErrorCode.COMPENSATION_RETRY_EXCEEDED,
        AgentErrorCode.LOOP_EXCEEDED,
        AgentErrorCode.CONFIGURATION_ERROR,
        AgentErrorCode.VALIDATION_ERROR,
        AgentErrorCode.LLM_TIMEOUT,
        AgentErrorCode.LLM_REQUEST_FAILED,
        AgentErrorCode.LLM_RESPONSE_INVALID,
        AgentErrorCode.TOOL_EXECUTION_FAILED,
    ];

    return validCodes.includes(error.code);
}
