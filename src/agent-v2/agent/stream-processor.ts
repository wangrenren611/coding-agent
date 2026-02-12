/**
 * 流式处理器
 * 负责处理 LLM 流式响应，管理缓冲区和元数据
 * 
 * 支持两种内容类型：
 * - content: 普通文本内容
 * - reasoning_content: 推理/思考内容 (thinking 模式)
 */

import { Chunk, FinishReason, LLMResponse, Usage } from "../../providers";
import { Message } from "../session/types";
import {
    StreamChunkMetadata,
    StreamToolCall,
    ToolCall,
    getChunkContent,
    getChunkReasoningContent,
    getChunkToolCalls,
    getFinishReason,
    hasContentDelta,
    hasReasoningDelta,
    hasToolCalls,
} from "./types-internal";

export interface StreamProcessorOptions {
    maxBufferSize: number;
    onMessageUpdate: (message: Partial<Message> & { messageId: string }) => void;
    onMessageCreate: (message: Partial<Message> & { messageId: string; role: 'assistant' }) => void;
    onTextDelta: (content: string, messageId: string) => void;
    onTextStart: (messageId: string) => void;
    onTextComplete: (messageId: string) => void;
    // 推理内容回调 (thinking 模式)
    onReasoningDelta?: (content: string, messageId: string) => void;
    onReasoningStart?: (messageId: string) => void;
    onReasoningComplete?: (messageId: string) => void;
    // Token 使用量回调
    onUsageUpdate?: (usage: Usage) => void;
}

export class StreamProcessor {
    private buffer = '';
    private reasoningBuffer = '';  // 推理内容缓冲区
    private toolCalls = new Map<number, StreamToolCall>();
    private metadata: StreamChunkMetadata = {};
    private currentMessageId: string = '';
    private aborted = false;
    private reasoningStarted = false;
    private textStarted = false;

    constructor(private options: StreamProcessorOptions) {}

    /**
     * 重置处理器状态
     */
    reset(): void {
        this.buffer = '';
        this.reasoningBuffer = '';
        this.toolCalls.clear();
        this.metadata = {};
        this.currentMessageId = '';
        this.aborted = false;
        this.reasoningStarted = false;
        this.textStarted = false;
    }

    /**
     * 中止处理
     */
    abort(): void {
        this.aborted = true;
    }

    /**
     * 设置当前消息 ID
     */
    setMessageId(messageId: string): void {
        this.currentMessageId = messageId;
    }

    /**
     * 处理单个 chunk
     */
    processChunk(chunk: Chunk): void {
        if (this.aborted) return;

        const content = getChunkContent(chunk);
        const reasoningContent = getChunkReasoningContent(chunk);
        const toolCalls = getChunkToolCalls(chunk);
        const finishReason = getFinishReason(chunk);

        // 更新元数据
        this.updateMetadata(chunk, finishReason);

        // 处理推理内容增量 (reasoning_content) - thinking 模式
        if (hasReasoningDelta(chunk)) {
            this.handleReasoningDelta(reasoningContent, chunk.id, finishReason);
        }

        // 处理普通内容增量 (content)
        if (hasContentDelta(chunk)) {
            this.handleContentDelta(content, chunk.id, finishReason);
        }

        // 处理工具调用
        if (hasToolCalls(chunk)) {
            this.handleToolCalls(toolCalls!, chunk.id, finishReason);
        }

        // 处理单独的 finish_reason（没有 content 或 tool_calls 的情况）
        if (finishReason && !hasContentDelta(chunk) && !hasReasoningDelta(chunk) && !hasToolCalls(chunk)) {
            this.handleFinishReason(finishReason, chunk.id);
        }
    }

    /**
     * 构建最终的 LLMResponse
     */
    buildResponse(): LLMResponse {
        const toolCalls = Array.from(this.toolCalls.values());

        return {
            id: this.metadata.id || '',
            object: 'chat.completion',
            created: this.metadata.created || Date.now(),
            model: this.metadata.model || '',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: this.buffer,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                        // 添加 reasoning_content 到响应中
                        ...(this.reasoningBuffer && { reasoning_content: this.reasoningBuffer }),
                    },
                    finish_reason: this.metadata.finish_reason,
                },
            ],
            usage: this.metadata.usage,
        };
    }

    /**
     * 获取当前元数据
     */
    getMetadata(): Readonly<StreamChunkMetadata> {
        return { ...this.metadata };
    }

    /**
     * 获取缓冲区内容
     */
    getBuffer(): string {
        return this.buffer;
    }

    /**
     * 获取推理内容缓冲区
     */
    getReasoningBuffer(): string {
        return this.reasoningBuffer;
    }

    /**
     * 获取工具调用列表
     */
    getToolCalls(): StreamToolCall[] {
        return Array.from(this.toolCalls.values());
    }

    /**
     * 检查是否有工具调用
     */
    hasToolCalls(): boolean {
        return this.toolCalls.size > 0;
    }

    // ==================== 私有方法 ====================

    /**
     * 处理推理内容增量 (thinking 模式)
     */
    private handleReasoningDelta(
        content: string,
        chunkId: string | undefined,
        finishReason: FinishReason | undefined
    ): void {
        // 检查缓冲区大小限制
        if (!this.appendToReasoningBuffer(content)) {
            return;
        }

        // 触发推理开始事件（首次推理内容）
        if (!this.reasoningStarted) {
            this.reasoningStarted = true;
            this.options.onReasoningStart?.(this.currentMessageId);
        }

        // 触发推理增量事件
        this.options.onReasoningDelta?.(content, this.currentMessageId);

        // 触发推理完成事件
        if (finishReason) {
            this.options.onReasoningComplete?.(this.currentMessageId);
        }
    }

    /**
     * 处理普通内容增量
     */
    private handleContentDelta(
        content: string,
        chunkId: string | undefined,
        finishReason: FinishReason | undefined
    ): void {
        // 检查缓冲区大小限制
        if (!this.appendToBuffer(content)) {
            return;
        }

        // 触发文本开始事件（首次内容）
        if (!this.textStarted) {
            this.textStarted = true;
            this.options.onTextStart(this.currentMessageId);
        }

        // 触发增量事件
        this.options.onTextDelta(content, this.currentMessageId);

        // 更新或创建消息
        this.options.onMessageUpdate({
            messageId: this.currentMessageId,
            role: 'assistant',
            content: this.buffer,
            id: chunkId,
            finish_reason: finishReason,
            type: 'text',
            ...(this.reasoningBuffer && { reasoning_content: this.reasoningBuffer }),
        });

        // 触发完成事件
        if (finishReason) {
            this.options.onTextComplete(this.currentMessageId);
        }
    }

    private handleToolCalls(
        toolCalls: ToolCall[],
        chunkId: string | undefined,
        finishReason: FinishReason | undefined
    ): void {
        // 更新工具调用映射
        for (const toolCall of toolCalls) {
            this.updateToolCall(toolCall);
        }

        // 触发文本完成（工具调用前）
        if (this.textStarted) {
            this.options.onTextComplete(this.currentMessageId);
        }

        // 构建消息数据 - 保留 buffer 中的 content 内容
        const streamToolCalls = Array.from(this.toolCalls.values());
        const messageData = {
            role: 'assistant' as const,
            messageId: this.currentMessageId,
            content: this.buffer, // 保留 content 内容
            tool_calls: streamToolCalls,
            type: 'tool-call' as const,
            id: chunkId,
            finish_reason: finishReason,
        };

        this.options.onMessageCreate(messageData);
    }

    private updateToolCall(toolCall: ToolCall): void {
        const index = toolCall.index ?? 0;

        if (!this.toolCalls.has(index)) {
            this.toolCalls.set(index, {
                id: toolCall.id || '',
                type: toolCall.type || 'function',
                index,
                function: {
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                },
            });
        } else {
            const existing = this.toolCalls.get(index)!;
            if (toolCall.function?.name) {
                existing.function.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
                existing.function.arguments += toolCall.function.arguments;
            }
        }
    }

    private handleFinishReason(
        finishReason: FinishReason,
        chunkId: string | undefined
    ): void {
        // 触发文本完成
        if (this.textStarted) {
            this.options.onTextComplete(this.currentMessageId);
        }
        
        // 触发推理完成
        if (this.reasoningStarted) {
            this.options.onReasoningComplete?.(this.currentMessageId);
        }

        // 更新消息 finish_reason
        const streamToolCalls = Array.from(this.toolCalls.values());
        const hasToolCalls = streamToolCalls.length > 0;

        this.options.onMessageUpdate({
            messageId: this.currentMessageId,
            role: 'assistant',
            content: this.buffer,
            id: chunkId,
            finish_reason: finishReason,
            ...(this.reasoningBuffer && { reasoning_content: this.reasoningBuffer }),
            ...(hasToolCalls
                ? {
                    tool_calls: streamToolCalls,
                    type: 'tool-call' as const,
                }
                : {
                    type: 'text' as const,
                }),
        });
    }

    private updateMetadata(chunk: Chunk, finishReason: FinishReason | undefined): void {
        if (chunk.id) this.metadata.id = chunk.id;
        if (chunk.model) this.metadata.model = chunk.model;
        if (chunk.created) this.metadata.created = chunk.created;
        if (finishReason) this.metadata.finish_reason = finishReason;
        if (chunk.usage) {
            this.metadata.usage = chunk.usage;
            // 触发 usage 更新回调
            this.options.onUsageUpdate?.(chunk.usage);
        }
    }

    private appendToBuffer(content: string): boolean {
        const projectedSize = this.buffer.length + content.length;
        if (projectedSize > this.options.maxBufferSize) {
            this.aborted = true;
            return false;
        }
        this.buffer += content;
        return true;
    }

    private appendToReasoningBuffer(content: string): boolean {
        const projectedSize = this.reasoningBuffer.length + content.length;
        if (projectedSize > this.options.maxBufferSize) {
            this.aborted = true;
            return false;
        }
        this.reasoningBuffer += content;
        return true;
    }
}
