/**
 * Agent 配置管理模块
 * 
 * 集中管理所有配置默认值、验证逻辑和规范化方法
 */

import type { AgentOptions } from './types';
import { AgentError } from './errors';


// ==================== 常量定义 ====================

/** 默认最大循环次数 */
export const DEFAULT_LOOP_MAX = 3000;

/** 默认最大重试次数 */
export const DEFAULT_MAX_RETRIES = 10;

/** 默认补偿重试次数 */
export const DEFAULT_MAX_COMPENSATION_RETRIES = 1;

/** 默认重试延迟（毫秒）= 10分钟 */
export const DEFAULT_RETRY_DELAY_MS = 1000 * 60 * 10;

/** 默认流式缓冲区大小（字节）= 100KB */
export const DEFAULT_MAX_BUFFER_SIZE = 100_000;

/** 默认工具执行超时（毫秒）= 5分钟 */
export const DEFAULT_TOOL_TIMEOUT_MS = 300_000;

/** 默认压缩触发阈值 */
export const DEFAULT_COMPACTION_TRIGGER_RATIO = 0.90;

/** 默认保留消息数 */
export const DEFAULT_KEEP_MESSAGES_NUM = 40;

/** Query 最大长度限制 */
export const MAX_QUERY_LENGTH = 100_000;


// ==================== 配置接口 ====================

/**
 * 规范化后的 Agent 完整配置
 */
export interface NormalizedAgentConfig {
    provider: AgentOptions['provider'];
    systemPrompt: string;
    toolRegistry: AgentOptions['toolRegistry'];
    maxRetries: number;
    requestTimeoutMs: number | undefined;
    retryDelayMs: number;
    stream: boolean;
    streamCallback: AgentOptions['streamCallback'];
    timeProvider: AgentOptions['timeProvider'];
    maxBufferSize: number;
    memoryManager: AgentOptions['memoryManager'];
    sessionId: string;
    enableCompaction: boolean;
    compactionConfig: AgentOptions['compactionConfig'];
    thinking: boolean | undefined;
    // 内部配置
    loopMax: number;
    maxCompensationRetries: number;
}


// ==================== 配置类 ====================

/**
 * Agent 配置管理器
 * 负责配置验证、默认值填充和规范化
 */
export class AgentConfig {
    private readonly config: NormalizedAgentConfig;

    constructor(options: AgentOptions) {
        this.validateOptions(options);
        this.config = this.normalizeConfig(options);
    }

    /**
     * 获取规范化后的配置
     */
    getConfig(): Readonly<NormalizedAgentConfig> {
        return this.config;
    }

    /**
     * 验证输入配置
     */
    private validateOptions(options: AgentOptions): void {
        if (!options.provider) {
            throw new AgentError('Provider is required');
        }
    }

    /**
     * 规范化配置，应用默认值
     */
    private normalizeConfig(options: AgentOptions): NormalizedAgentConfig {
        return {
            // 必需配置
            provider: options.provider,
            systemPrompt: options.systemPrompt ?? '',
            toolRegistry: options.toolRegistry,
            
            // 重试配置
            maxRetries: this.normalizePositiveInteger(options.maxRetries, DEFAULT_MAX_RETRIES),
            retryDelayMs: this.normalizePositiveMs(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS),
            requestTimeoutMs: this.normalizeOptionalPositiveMs(options.requestTimeout),
            
            // 内部重试配置
            loopMax: DEFAULT_LOOP_MAX,
            maxCompensationRetries: DEFAULT_MAX_COMPENSATION_RETRIES,
            
            // 流式配置
            stream: options.stream ?? false,
            streamCallback: options.streamCallback,
            maxBufferSize: this.normalizePositiveInteger(options.maxBufferSize, DEFAULT_MAX_BUFFER_SIZE),
            
            // 时间提供者
            timeProvider: options.timeProvider,
            
            // 会话配置
            memoryManager: options.memoryManager,
            sessionId: options.sessionId ?? '',
            enableCompaction: options.enableCompaction ?? false,
            compactionConfig: options.compactionConfig,
            
            // 高级配置
            thinking: options.thinking,
        };
    }

    /**
     * 规范化正整数（带默认值）
     */
    private normalizePositiveInteger(value: number | undefined, fallback: number): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
            return fallback;
        }
        return value;
    }

    /**
     * 规范化正数毫秒值（带默认值）
     */
    private normalizePositiveMs(value: number | undefined, fallback: number): number {
        const normalized = this.normalizeOptionalPositiveMs(value);
        return normalized ?? fallback;
    }

    /**
     * 规范化可选正数毫秒值
     */
    private normalizeOptionalPositiveMs(value: number | undefined): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return undefined;
        }
        return value;
    }
}


// ==================== 配置验证 ====================

/**
 * Query 验证结果
 */
export interface QueryValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Query 输入验证器
 */
export class QueryValidator {
    /**
     * 验证文本输入
     */
    static validateTextInput(query: string): QueryValidationResult {
        if (query.length === 0) {
            return { valid: false, error: 'Query cannot be empty' };
        }
        if (query.length > MAX_QUERY_LENGTH) {
            return { valid: false, error: 'Query exceeds maximum length' };
        }
        return { valid: true };
    }

    /**
     * 验证内容部分
     */
    static validateContentPart(part: unknown): QueryValidationResult {
        if (!part || typeof part !== 'object' || !('type' in part)) {
            return { valid: false, error: 'Invalid content part structure' };
        }

        const contentPart = part as { type: string; text?: string; image_url?: { url?: string }; file?: { file_id?: string; file_data?: string }; input_audio?: { data?: string; format?: string }; input_video?: { url?: string; file_id?: string; data?: string } };

        switch (contentPart.type) {
            case 'text':
                if (!contentPart.text) {
                    return { valid: false, error: 'text part must include text content' };
                }
                return this.validateTextInput(contentPart.text);

            case 'image_url':
                if (!contentPart.image_url?.url) {
                    return { valid: false, error: 'image_url part must include a valid url' };
                }
                return { valid: true };

            case 'file':
                if (!contentPart.file?.file_id && !contentPart.file?.file_data) {
                    return { valid: false, error: 'file part must include file_id or file_data' };
                }
                return { valid: true };

            case 'input_audio':
                if (!contentPart.input_audio?.data || !contentPart.input_audio?.format) {
                    return { valid: false, error: 'input_audio part must include data and format' };
                }
                return { valid: true };

            case 'input_video':
                if (!contentPart.input_video?.url && !contentPart.input_video?.file_id && !contentPart.input_video?.data) {
                    return { valid: false, error: 'input_video part must include url, file_id, or data' };
                }
                return { valid: true };

            default:
                return { valid: false, error: `Unsupported content part type: ${contentPart.type}` };
        }
    }
}


// ==================== 错误处理 ====================

/**
 * 安全错误类型
 */
export interface SafeError {
    userMessage: string;
    internalMessage?: string;
}

/**
 * 错误分类码
 */
export type ErrorClassification = 
    | 'AGENT_ABORTED'
    | 'AGENT_MAX_RETRIES_EXCEEDED'
    | 'LLM_TIMEOUT'
    | 'TOOL_EXECUTION_FAILED'
    | 'LLM_REQUEST_FAILED'
    | 'AGENT_RUNTIME_ERROR';

/**
 * 错误处理器
 */
export class ErrorHandler {
    /**
     * 错误分类
     */
    static classify(error: unknown, agentStatus?: string): ErrorClassification {
        if (this.isAbortLikeError(error) || agentStatus === 'aborted') {
            return 'AGENT_ABORTED';
        }
        if (this.isTimeoutLikeError(error)) {
            return 'LLM_TIMEOUT';
        }
        return 'AGENT_RUNTIME_ERROR';
    }

    /**
     * 错误消毒 - 提取安全信息
     */
    static sanitize(error: unknown): SafeError {
        if (error instanceof AgentError) {
            return {
                userMessage: error.message,
                internalMessage: error.stack,
            };
        }

        if (error instanceof Error) {
            return {
                userMessage: 'An unexpected error occurred. Please try again.',
                internalMessage: error.message,
            };
        }

        return {
            userMessage: 'An unexpected error occurred. Please try again.',
            internalMessage: String(error),
        };
    }

    /**
     * 判断是否为中止类错误
     */
    private static isAbortLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return message.includes('abort') || message.includes('aborted');
    }

    /**
     * 判断是否为超时类错误
     */
    private static isTimeoutLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return (
            message.includes('timeout') ||
            message.includes('timed out') ||
            message.includes('time out') ||
            message.includes('signal timed out')
        );
    }
}
