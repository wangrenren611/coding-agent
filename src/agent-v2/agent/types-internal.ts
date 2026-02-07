/**
 * Agent 内部类型定义
 * 包含类型守卫和内部使用的类型
 */

import { Chunk, FinishReason, InputContentPart, LLMResponse, MessageContent, Usage } from "../../providers";
import { AgentMessage, AgentMessageType } from "./stream-types";

// ==================== 流式处理类型 ====================

export interface StreamToolCall {
    id: string;
    type: string;
    index: number;
    function: {
        name: string;
        arguments: string;
    };
}

export interface StreamChunkMetadata {
    id?: string;
    model?: string;
    created?: number;
    finish_reason?: FinishReason;
    usage?: Usage;
}

export interface ToolCall {
    id: string;
    type: string;
    index: number;
    function: {
        name: string;
        arguments: string;
    };
}

export interface LLMChoice {
    index: number;
    message: {
        role: string;
        content: MessageContent;
        tool_calls?: ToolCall[];
    };
    finish_reason?: FinishReason;
}

export interface ToolExecutionResult {
    tool_call_id: string;
    result?: {
        success?: boolean;
        [key: string]: unknown;
    };
}

// ==================== 时间提供者 ====================

/**
 * 时间提供者接口 - 用于提升可测试性
 */
export interface ITimeProvider {
    getCurrentTime(): number;
    sleep(ms: number): Promise<void>;
}

// ==================== 事件类型 ====================

export interface TaskFailedEvent {
    timestamp: number;
    error: string;
    totalLoops: number;
    totalRetries: number;
}

// ==================== 验证类型 ====================

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

export interface SafeError {
    userMessage: string;
    internalMessage?: string;
}

// ==================== 类型守卫 ====================

/**
 * 检查是否为文本增量消息
 */
export function isTextDeltaMessage(message: AgentMessage): message is AgentMessage & {
    type: AgentMessageType.TEXT_DELTA;
    payload: { content: string };
} {
    return message.type === AgentMessageType.TEXT_DELTA;
}

/**
 * 检查是否为状态消息
 */
export function isStatusMessage(message: AgentMessage): message is AgentMessage & {
    type: AgentMessageType.STATUS;
    payload: { state: string; message: string };
} {
    return message.type === AgentMessageType.STATUS;
}

/**
 * 检查是否为工具调用创建消息
 */
export function isToolCallCreatedMessage(message: AgentMessage): message is AgentMessage & {
    type: AgentMessageType.TOOL_CALL_CREATED;
    payload: { tool_calls: unknown[]; content?: string };
} {
    return message.type === AgentMessageType.TOOL_CALL_CREATED;
}

/**
 * 检查 chunk 是否包含内容增量
 */
export function hasContentDelta(chunk: Chunk): boolean {
    const delta = chunk.choices?.[0]?.delta;
    return !!delta && typeof delta.content === 'string' && delta.content !== '';
}

/**
 * 检查 chunk 是否包含工具调用
 */
export function hasToolCalls(chunk: Chunk): boolean {
    const delta = chunk.choices?.[0]?.delta;
    return !!delta && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
}

/**
 * 获取 chunk 中的 finish_reason
 */
export function getFinishReason(chunk: Chunk): FinishReason | undefined {
    return chunk.choices?.[0]?.finish_reason;
}

/**
 * 获取 chunk 中的 content
 */
export function getChunkContent(chunk: Chunk): string {
    const content = chunk.choices?.[0]?.delta?.content;
    if (!content) return '';
    if (typeof content === 'string') return content;

    return content
        .map((part) => stringifyContentPart(part))
        .filter(Boolean)
        .join('\n');
}

/**
 * 获取 chunk 中的工具调用
 */
export function getChunkToolCalls(chunk: Chunk): ToolCall[] | undefined {
    return chunk.choices?.[0]?.delta?.tool_calls;
}

// ==================== 辅助函数 ====================

/**
 * 检查响应是否包含工具调用
 */
export function responseHasToolCalls(response: LLMResponse): boolean {
    const toolCalls = response.choices?.[0]?.message?.tool_calls;
    return Array.isArray(toolCalls) && toolCalls.length > 0;
}

/**
 * 从响应中获取工具调用
 */
export function getResponseToolCalls(response: LLMResponse): ToolCall[] {
    return response.choices?.[0]?.message?.tool_calls || [];
}

/**
 * 从响应中获取消息内容
 */
export function getResponseContent(response: LLMResponse): string {
    const content = response.choices?.[0]?.message?.content;
    if (!content) return '';
    if (typeof content === 'string') return content;

    return content
        .map((part) => stringifyContentPart(part))
        .filter(Boolean)
        .join('\n');
}

function stringifyContentPart(part: InputContentPart): string {
    switch (part.type) {
        case 'text':
            return part.text || '';
        case 'image_url':
            return `[image] ${part.image_url?.url || ''}`.trim();
        case 'file':
            return `[file] ${part.file?.filename || part.file?.file_id || ''}`.trim();
        case 'input_audio':
            return '[audio]';
        case 'input_video':
            return `[video] ${part.input_video?.url || part.input_video?.file_id || ''}`.trim();
        default:
            return '';
    }
}

/**
 * 从响应中获取 finish_reason
 */
export function getResponseFinishReason(response: LLMResponse): FinishReason | undefined {
    return response.choices?.[0]?.finish_reason;
}
