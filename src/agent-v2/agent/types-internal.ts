/**
 * Agent 内部类型定义
 * 包含类型守卫和内部使用的类型
 * 
 * 注意：共享类型已迁移到 core-types.ts
 */

import { Chunk, FinishReason, LLMResponse, InputContentPart } from "../../providers";
import { AgentMessage, AgentMessageType } from "./stream-types";
import { stringifyContentPart } from "./core-types";

// 从 core-types 重新导出共享类型
export type {
    ToolCall,
    StreamToolCall,
    ITimeProvider,
    ValidationResult,
    SafeError,
    ToolExecutionResult,
    TaskFailedEvent,
    StreamChunkMetadata,
} from './core-types';

export {
    contentToText,
    hasContent,
} from './core-types';

// ==================== 流式处理类型守卫 ====================

/**
 * 检查 chunk 是否包含内容增量
 */
export function hasContentDelta(chunk: Chunk): boolean {
    const delta = chunk.choices?.[0]?.delta;
    return !!delta && typeof delta.content === 'string' && delta.content !== '';
}

/**
 * ChunkDelta 类型守卫 - 检查是否包含 reasoning_content
 */
interface ChunkDeltaWithReasoning {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: unknown[];
}

function hasReasoningContent(delta: unknown): delta is ChunkDeltaWithReasoning {
    return delta !== null &&
        typeof delta === 'object' &&
        'reasoning_content' in delta;
}

/**
 * 检查 chunk 是否包含推理内容增量 (reasoning_content)
 */
export function hasReasoningDelta(chunk: Chunk): boolean {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta || !hasReasoningContent(delta)) return false;
    return typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '';
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
        .map((part) => stringifyContentPart(part as InputContentPart))
        .filter(Boolean)
        .join('\n');
}

/**
 * 获取 chunk 中的 reasoning_content
 */
export function getChunkReasoningContent(chunk: Chunk): string {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta || !hasReasoningContent(delta)) return '';
    const reasoningContent = delta.reasoning_content;
    if (!reasoningContent) return '';
    return typeof reasoningContent === 'string' ? reasoningContent : '';
}

/**
 * 获取 chunk 中的工具调用
 */
export function getChunkToolCalls(chunk: Chunk): import('./core-types').ToolCall[] | undefined {
    return chunk.choices?.[0]?.delta?.tool_calls;
}

// ==================== 响应处理辅助函数 ====================

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
export function getResponseToolCalls(response: LLMResponse): import('./core-types').ToolCall[] {
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
        .map((part) => stringifyContentPart(part as InputContentPart))
        .filter(Boolean)
        .join('\n');
}

/**
 * 从响应中获取 finish_reason
 */
export function getResponseFinishReason(response: LLMResponse): FinishReason | undefined {
    return response.choices?.[0]?.finish_reason;
}

// ==================== Agent 消息类型守卫 ====================

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
    payload: { state: string; message?: string };
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

// ==================== 流类型守卫 ====================

/**
 * 检查是否为 AsyncGenerator<Chunk> 类型
 */
export function isChunkStream(result: unknown): result is AsyncGenerator<Chunk, unknown, unknown> {
    return result !== null &&
        typeof result === 'object' &&
        Symbol.asyncIterator in result;
}
