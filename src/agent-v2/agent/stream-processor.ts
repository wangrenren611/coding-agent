/**
 * 流式处理器 v2
 *
 * 负责处理 LLM 流式响应，统一管理 reasoning_content、content、tool_calls 三种内容类型。
 *
 * 设计原则：
 * 1. 统一的消息更新机制：所有内容变更都通过 onMessageUpdate 持久化
 * 2. 状态机驱动：通过状态枚举追踪处理状态
 * 3. 缓冲区管理：独立的缓冲区存储不同类型内容，支持大小限制
 * 4. 事件驱动：通过回调函数向外部通知状态变化
 *
 * 内容处理顺序（典型 LLM 响应）：
 * reasoning_content → content → tool_calls → finish_reason
 */

import { Chunk, FinishReason, LLMResponse, Usage } from '../../providers';
import { Message } from '../session/types';
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
} from './types-internal';
import {
    ResponseValidator,
    ResponseValidatorOptions,
    ValidationResult,
    createResponseValidator,
} from './response-validator';

// 重新导出状态枚举供外部使用
export { ProcessorState, ContentType } from './processor-state';

/**
 * 内部处理器状态（细粒度状态追踪）
 */
interface InternalProcessorState {
    /** 是否已中止 */
    aborted: boolean;
    /** 推理内容是否已开始 */
    reasoningStarted: boolean;
    /** 普通文本是否已开始 */
    textStarted: boolean;
    /** 工具调用是否已开始 */
    toolCallsStarted: boolean;
    /** 推理内容是否已完成 */
    reasoningCompleted: boolean;
    /** 普通文本是否已完成 */
    textCompleted: boolean;
}

/**
 * 缓冲区数据
 */
interface BufferData {
    /** 推理内容缓冲区 */
    reasoning: string;
    /** 普通文本缓冲区 */
    content: string;
    /** 工具调用映射 (index -> ToolCall) */
    toolCalls: Map<number, StreamToolCall>;
}

/**
 * 流式处理器配置选项
 */
export interface StreamProcessorOptions {
    /** 最大缓冲区大小（字节） */
    maxBufferSize: number;

    // ==================== 消息持久化回调 ====================

    /** 消息更新回调（用于持久化） */
    onMessageUpdate: (message: Partial<Message> & { messageId: string }) => void;
    /** 消息创建回调（用于工具调用场景） */
    onMessageCreate: (message: Partial<Message> & { messageId: string; role: 'assistant' }) => void;

    // ==================== 文本事件回调 ====================

    /** 文本增量回调 */
    onTextDelta: (content: string, messageId: string) => void;
    /** 文本开始回调 */
    onTextStart: (messageId: string) => void;
    /** 文本完成回调 */
    onTextComplete: (messageId: string) => void;

    // ==================== 推理内容事件回调 ====================

    /** 推理增量回调 */
    onReasoningDelta?: (content: string, messageId: string) => void;
    /** 推理开始回调 */
    onReasoningStart?: (messageId: string) => void;
    /** 推理完成回调 */
    onReasoningComplete?: (messageId: string) => void;

    // ==================== Token 使用量回调 ====================

    /** Token 使用量更新回调 */
    onUsageUpdate?: (usage: Usage, messageId: string) => void;

    // ==================== 响应验证选项 ====================

    /** 响应验证器配置（可选，用于检测模型幻觉） */
    validatorOptions?: Partial<ResponseValidatorOptions>;
    /** 验证失败回调 */
    onValidationViolation?: (result: ValidationResult) => void;
}

// ==================== 主类 ====================

export class StreamProcessor {
    // 配置
    private readonly options: StreamProcessorOptions;
    private readonly maxBufferSize: number;

    // 状态
    private state: InternalProcessorState = this.createInitialState();

    // 缓冲区
    private buffers: BufferData = this.createInitialBuffers();

    // 元数据
    private metadata: StreamChunkMetadata = {};
    private currentMessageId: string = '';

    // 响应验证器
    private readonly validator: ResponseValidator;

    constructor(options: StreamProcessorOptions) {
        this.options = options;
        this.maxBufferSize = options.maxBufferSize;
        this.validator = createResponseValidator(options.validatorOptions);
    }

    // ==================== 公共 API ====================

    /**
     * 重置处理器状态
     * 用于开始处理新的消息
     */
    reset(): void {
        this.state = this.createInitialState();
        this.buffers = this.createInitialBuffers();
        this.metadata = {};
        this.currentMessageId = '';
        this.validator.reset();
    }

    /**
     * 中止处理
     * 当缓冲区超出限制时自动调用
     */
    abort(): void {
        this.state.aborted = true;
    }

    /**
     * 设置当前消息 ID
     */
    setMessageId(messageId: string): void {
        this.currentMessageId = messageId;
    }

    /**
     * 处理单个 chunk
     *
     * 处理顺序：
     * 1. 更新元数据
     * 2. 处理 reasoning_content
     * 3. 处理 content
     * 4. 处理 tool_calls
     * 5. 处理 finish_reason
     */
    processChunk(chunk: Chunk): void {
        if (this.state.aborted) return;

        const finishReason = getFinishReason(chunk);

        // 1. 更新元数据
        this.updateMetadata(chunk, finishReason);

        // 2. 处理 reasoning_content
        if (hasReasoningDelta(chunk)) {
            const content = getChunkReasoningContent(chunk);
            this.handleReasoningContent(content, chunk.id, finishReason);
        }

        // 3. 处理 content
        if (hasContentDelta(chunk)) {
            const content = getChunkContent(chunk);
            this.handleTextContent(content, chunk.id, finishReason);
        }

        // 4. 处理 tool_calls
        if (hasToolCalls(chunk)) {
            const toolCalls = getChunkToolCalls(chunk)!;
            this.handleToolCalls(toolCalls, chunk.id, finishReason);
        }

        // 5. 处理单独的 finish_reason
        if (finishReason && !hasContentDelta(chunk) && !hasReasoningDelta(chunk) && !hasToolCalls(chunk)) {
            this.handleFinishReasonOnly(finishReason, chunk.id);
        }

        if (chunk.usage) {
            this.metadata.usage = chunk.usage;
            this.options.onUsageUpdate?.(chunk.usage, this.currentMessageId);
        }
    }

    /**
     * 构建最终的 LLMResponse
     */
    buildResponse(): LLMResponse {
        const toolCalls = Array.from(this.buffers.toolCalls.values());

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
                        content: this.buffers.content || '',
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                        ...(this.buffers.reasoning && { reasoning_content: this.buffers.reasoning }),
                    },
                    finish_reason: this.metadata.finish_reason,
                },
            ],
            usage: this.metadata.usage,
        };
    }

    // ==================== 状态查询方法 ====================

    getMetadata(): Readonly<StreamChunkMetadata> {
        return { ...this.metadata };
    }

    getBuffer(): string {
        return this.buffers.content;
    }

    getReasoningBuffer(): string {
        return this.buffers.reasoning;
    }

    getToolCalls(): StreamToolCall[] {
        return Array.from(this.buffers.toolCalls.values());
    }

    hasToolCalls(): boolean {
        return this.buffers.toolCalls.size > 0;
    }

    isAborted(): boolean {
        return this.state.aborted;
    }

    // ==================== 私有方法：状态初始化 ====================

    private createInitialState(): InternalProcessorState {
        return {
            aborted: false,
            reasoningStarted: false,
            textStarted: false,
            toolCallsStarted: false,
            reasoningCompleted: false,
            textCompleted: false,
        };
    }

    private createInitialBuffers(): BufferData {
        return {
            reasoning: '',
            content: '',
            toolCalls: new Map(),
        };
    }

    // ==================== 私有方法：内容处理 ====================

    /**
     * 处理推理内容 (reasoning_content)
     */
    private handleReasoningContent(
        content: string,
        chunkId: string | undefined,
        finishReason: FinishReason | undefined
    ): void {
        // 追加到缓冲区
        if (!this.appendToBuffer('reasoning', content)) {
            return;
        }

        // 触发开始事件
        if (!this.state.reasoningStarted) {
            this.state.reasoningStarted = true;
            this.options.onReasoningStart?.(this.currentMessageId);
        }

        // 触发增量事件
        this.options.onReasoningDelta?.(content, this.currentMessageId);

        // 持久化消息
        this.persistMessage(chunkId, finishReason);

        // 触发完成事件
        if (finishReason && !this.state.reasoningCompleted) {
            this.state.reasoningCompleted = true;
            this.options.onReasoningComplete?.(this.currentMessageId);
        }
    }

    /**
     * 处理普通文本内容 (content)
     */
    private handleTextContent(
        content: string,
        chunkId: string | undefined,
        finishReason: FinishReason | undefined
    ): void {
        // 追加到缓冲区
        if (!this.appendToBuffer('content', content)) {
            return;
        }

        // 触发开始事件
        if (!this.state.textStarted) {
            if (this.state.reasoningStarted && !this.state.reasoningCompleted) {
                this.state.reasoningCompleted = true;
                this.options.onReasoningComplete?.(this.currentMessageId);
            }

            this.state.textStarted = true;
            this.options.onTextStart(this.currentMessageId);
        }

        // 触发增量事件
        this.options.onTextDelta(content, this.currentMessageId);

        // 持久化消息
        this.persistMessage(chunkId, finishReason);

        // 触发完成事件
        if (finishReason && !this.state.textCompleted) {
            this.state.textCompleted = true;
            this.options.onTextComplete(this.currentMessageId);
        }
    }

    /**
     * 处理工具调用 (tool_calls)
     */
    private handleToolCalls(
        toolCalls: ToolCall[],
        chunkId: string | undefined,
        finishReason: FinishReason | undefined
    ): void {
        // 更新工具调用映射
        for (const toolCall of toolCalls) {
            this.updateToolCall(toolCall);
        }

        // 标记工具调用开始
        if (!this.state.toolCallsStarted) {
            this.state.toolCallsStarted = true;

            // 如果之前有文本内容，先触发完成
            if (this.state.textStarted && !this.state.textCompleted) {
                this.state.textCompleted = true;
                this.options.onTextComplete(this.currentMessageId);
            }

            if (this.state.reasoningStarted && !this.state.reasoningCompleted) {
                this.state.reasoningCompleted = true;
                this.options.onReasoningComplete?.(this.currentMessageId);
            }
        }

        // 使用 onMessageCreate 创建工具调用消息
        const streamToolCalls = Array.from(this.buffers.toolCalls.values());
        this.options.onMessageCreate({
            messageId: this.currentMessageId,
            role: 'assistant',
            content: this.buffers.content,
            tool_calls: streamToolCalls,
            type: 'tool-call',
            id: chunkId,
            finish_reason: finishReason,
            ...(this.buffers.reasoning && { reasoning_content: this.buffers.reasoning }),
        });
    }

    /**
     * 处理单独的 finish_reason
     * 当 chunk 只有 finish_reason 没有其他内容时调用
     */
    private handleFinishReasonOnly(finishReason: FinishReason, chunkId: string | undefined): void {
        // 触发文本完成
        if (this.state.textStarted && !this.state.textCompleted) {
            this.state.textCompleted = true;
            this.options.onTextComplete(this.currentMessageId);
        }

        // 触发推理完成
        if (this.state.reasoningStarted && !this.state.reasoningCompleted) {
            this.state.reasoningCompleted = true;
            this.options.onReasoningComplete?.(this.currentMessageId);
        }

        // 持久化最终消息
        this.persistMessage(chunkId, finishReason);
    }

    // ==================== 私有方法：辅助方法 ====================

    /**
     * 持久化消息
     * 统一的消息持久化入口
     */
    private persistMessage(chunkId: string | undefined, finishReason: FinishReason | undefined): void {
        const hasTools = this.buffers.toolCalls.size > 0;

        const messageData: Partial<Message> & { messageId: string } = {
            messageId: this.currentMessageId,
            role: 'assistant',
            id: chunkId,
            finish_reason: finishReason,
            type: hasTools ? 'tool-call' : 'text',
        };

        // 只添加有内容的字段
        if (this.buffers.content) {
            messageData.content = this.buffers.content;
        }

        if (this.buffers.reasoning) {
            messageData.reasoning_content = this.buffers.reasoning;
        }

        if (hasTools) {
            messageData.tool_calls = Array.from(this.buffers.toolCalls.values());
        }

        this.options.onMessageUpdate(messageData);
    }

    /**
     * 追加内容到缓冲区
     */
    private appendToBuffer(type: 'reasoning' | 'content', content: string): boolean {
        const currentSize = type === 'reasoning' ? this.buffers.reasoning.length : this.buffers.content.length;

        const projectedSize = currentSize + content.length;

        if (projectedSize > this.maxBufferSize) {
            this.abort();
            return false;
        }

        if (type === 'reasoning') {
            this.buffers.reasoning += content;
        } else {
            this.buffers.content += content;
        }

        return true;
    }

    /**
     * 更新工具调用
     */
    private updateToolCall(toolCall: ToolCall): void {
        const index = toolCall.index ?? 0;

        if (!this.buffers.toolCalls.has(index)) {
            // 创建新的工具调用
            this.buffers.toolCalls.set(index, {
                id: toolCall.id || '',
                type: toolCall.type || 'function',
                index,
                function: {
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                },
            });
        } else {
            // 累积更新现有工具调用
            const existing = this.buffers.toolCalls.get(index)!;

            if (toolCall.id) {
                existing.id = toolCall.id;
            }

            if (toolCall.function?.name) {
                existing.function.name = toolCall.function.name;
            }

            if (toolCall.function?.arguments) {
                existing.function.arguments += toolCall.function.arguments;
            }
        }
    }

    /**
     * 更新元数据
     */
    private updateMetadata(chunk: Chunk, finishReason: FinishReason | undefined): void {
        if (chunk.id) this.metadata.id = chunk.id;
        if (chunk.model) this.metadata.model = chunk.model;
        if (chunk.created) this.metadata.created = chunk.created;
        if (finishReason) this.metadata.finish_reason = finishReason;
    }

    /**
     * 对当前缓冲区内容进行完整验证
     */
    validateCurrentBuffer(): ValidationResult {
        const fullContent = this.buffers.content + this.buffers.reasoning;
        return this.validator.validateFull(fullContent);
    }
}
