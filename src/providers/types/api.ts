/**
 * LLM API 相关类型定义
 *
 * 统一的 API 类型定义，包含请求、响应、消息、工具调用等核心类型
 */

/**
 * 工具调用
 */
export type ToolCall = {
    id: string;
    type: string;
    index: number;
    function: {
        name: string;
        arguments: string;
    };
};

/**
 * 消息角色类型
 */
export type Role = 'system' | 'assistant' | 'user' | 'tool';

/**
 * Token 使用情况（统一类型，移除重复定义）
 */
export interface Usage {
    /** 用户 prompt 所包含的 token 数 */
    prompt_tokens: number;
    /** 模型 completion 产生的 token 数 */
    completion_tokens: number;
    /** 该请求中，所有 token 的数量（prompt + completion） */
    total_tokens: number;
    /** 用户 prompt 中未命中缓存的 token 数 */
    prompt_cache_miss_tokens: number;
    /** 用户 prompt 中命中缓存的 token 数 */
    prompt_cache_hit_tokens: number;
}

/**
 * 基础消息类型
 */
export interface BaseLLMMessage {
    /** 消息 ID */
    content: string;
    role: Role;
    reasoning_content?: string;
    [key: string]: unknown; // 添加索引签名以兼容 Record<string, unknown>
}

/**
 * LLM 响应消息
 */
export interface LLMResponseMessage extends BaseLLMMessage {
    tool_calls?: ToolCall[];
}

/**
 * LLM 请求消息
 */
export interface LLMRequestMessage extends BaseLLMMessage {
    tool_call_id?: string;
}

/**
 * 完成原因
 */
export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;

/**
 * LLM 响应
 */
export interface LLMResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: LLMResponseMessage;
        finish_reason?: FinishReason;
    }>;
    usage?: Usage;
    [key: string]: unknown; // 添加索引签名以兼容 Record<string, unknown>
}

/**
 * 流式响应块
 */
export interface Chunk {
    id?: string;
    index: number;
    choices?: Array<{
        index: number;
        delta: LLMResponseMessage;
        finish_reason?: FinishReason;
    }>;
    usage?: Usage;
    model?: string;
    object?: string;
    created?: number;
}

/**
 * 流式回调函数
 */
export type StreamCallback = (chunk: Chunk) => void;

/**
 * 工具定义
 */
export type Tool = {
    type: string;
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

/**
 * LLM 生成选项（传给 generate 方法的可选参数）
 */
export interface LLMGenerateOptions {
    /** 模型名称（覆盖默认模型） */
    model?: string;
    /** 最大生成 token 数 */
    max_tokens?: number;
    /** 温度参数 */
    temperature?: number;
    /** 是否启用流式响应 */
    stream?: boolean;
    /** 中止信号 */
    abortSignal?: AbortSignal;
    /** 工具列表 */
    tools?: Tool[];
    [key: string]: unknown; // 添加索引签名以兼容 Record<string, unknown>
}

/**
 * 完整的 LLM 请求（包含消息）
 */
export interface LLMRequest extends LLMGenerateOptions {
    /** 模型名称 */
    model: string;
    /** 对话消息列表 */
    messages: LLMRequestMessage[];
}
