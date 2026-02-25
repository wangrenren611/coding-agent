/**
 * LLM 调用器
 *
 * 封装 LLM 调用逻辑，支持流式和非流式两种模式。
 *
 * 职责：
 * 1. 执行 LLM 调用
 * 2. 管理流式处理
 * 3. 构建响应
 */

import { v4 as uuid } from 'uuid';
import {
    LLMRetryableError,
    LLMPermanentError,
    type Chunk,
    type LLMProvider,
    type LLMGenerateOptions,
    type LLMResponse,
    type Tool,
    type Usage,
} from '../../../providers';
import type { Message } from '../../session/types';
import { StreamProcessor } from '../stream-processor';
import { AgentStatus } from '../types';
import type { StatusMeta } from '../stream-types';
import type { ITimeProvider } from '../core-types';
import { DefaultTimeProvider } from '../time-provider';
import type { ResponseValidatorOptions, ValidationResult } from '../response-validator';

/**
 * LLM 调用器配置
 */
export interface LLMCallerConfig {
    /** LLM Provider */
    provider: LLMProvider;
    /** 是否启用流式输出 */
    stream: boolean;
    /** 最大缓冲区大小 */
    maxBufferSize: number;
    /** 请求超时（毫秒） */
    requestTimeoutMs?: number;
    /** 是否启用 thinking 模式 */
    thinking?: boolean;
    /** 时间提供者 */
    timeProvider?: ITimeProvider;

    // 响应验证选项
    /** 响应验证器配置 */
    validatorOptions?: Partial<ResponseValidatorOptions>;
    /** 验证失败回调 */
    onValidationViolation?: (result: ValidationResult) => void;

    // 流式处理回调
    /** 消息创建回调 */
    onMessageCreate?: (message: Partial<Message> & { messageId: string; role: 'assistant' }) => void;
    /** 消息更新回调 */
    onMessageUpdate?: (message: Partial<Message> & { messageId: string }) => void;
    /** 文本开始回调 */
    onTextStart?: (messageId: string) => void;
    /** 文本增量回调 */
    onTextDelta?: (content: string, messageId: string) => void;
    /** 文本完成回调 */
    onTextComplete?: (messageId: string) => void;
    /** 推理开始回调 */
    onReasoningStart?: (messageId: string) => void;
    /** 推理增量回调 */
    onReasoningDelta?: (content: string, messageId: string) => void;
    /** 推理完成回调 */
    onReasoningComplete?: (messageId: string) => void;
    /** Token 使用量更新回调 */
    onUsageUpdate?: (usage: Usage, messageId: string) => void;
    /** 状态变更回调 */
    onStatusChange?: (status: AgentStatus, message: string, messageId?: string, meta?: StatusMeta) => void;
}

/**
 * LLM 调用结果
 */
export interface LLMCallResult {
    /** LLM 响应 */
    response: LLMResponse;
    /** 消息 ID */
    messageId: string;
}

/**
 * LLM 调用器
 */
export class LLMCaller {
    private readonly config: LLMCallerConfig;
    private readonly timeProvider: ITimeProvider;
    private readonly streamProcessor: StreamProcessor;
    private abortController: AbortController | null = null;

    constructor(config: LLMCallerConfig) {
        this.config = config;
        this.timeProvider = config.timeProvider ?? new DefaultTimeProvider();
        this.streamProcessor = this.createStreamProcessor();
    }

    /**
     * 执行 LLM 调用
     */
    async execute(
        messages: Message[],
        tools: Tool[],
        abortSignal?: AbortSignal,
        options?: LLMGenerateOptions
    ): Promise<LLMCallResult> {
        const messageId = uuid();
        this.abortController = new AbortController();
        this.streamProcessor.reset();
        this.streamProcessor.setMessageId(messageId);

        // 合并超时信号
        const requestTimeout = this.config.requestTimeoutMs ?? this.config.provider.getTimeTimeout();
        const mergedAbortSignal = AbortSignal.any([
            this.abortController.signal,
            AbortSignal.timeout(requestTimeout),
            ...(abortSignal ? [abortSignal] : []),
            ...(options?.abortSignal ? [options.abortSignal] : []),
        ]);

        // 合并配置和传入的 options
        const llmOptions: LLMGenerateOptions = {
            tools,
            thinking: this.config.thinking,
            stream: this.config.stream,
            // 允许传入的 options 覆盖配置
            ...options,
            // 始终以合并后的信号为准，避免外部覆盖内部超时/中断保护
            abortSignal: mergedAbortSignal,
        };

        try {
            let response: LLMResponse;

            if (llmOptions.stream ?? this.config.stream) {
                response = await this.executeStream(messages, llmOptions, messageId);
            } else {
                response = await this.executeNormal(messages, llmOptions);
            }

            return { response, messageId };
        } finally {
            this.cleanup();
        }
    }

    /**
     * 执行流式调用
     */
    private async executeStream(
        messages: Message[],
        options: LLMGenerateOptions,
        messageId: string
    ): Promise<LLMResponse> {
        this.config.onStatusChange?.(AgentStatus.THINKING, 'Agent is thinking...', messageId, {
            source: 'llm-caller',
            phase: 'thinking',
        });

        options.stream = true;
        const streamResult = await this.config.provider.generate(messages, options);

        // 检查是否为流式结果
        if (!streamResult || typeof (streamResult as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function') {
            // 非流式结果，直接返回
            return streamResult as LLMResponse;
        }

        const stream = streamResult as AsyncIterable<Chunk>;

        for await (const chunk of stream) {
            const streamError = this.extractStreamChunkError(chunk);
            if (streamError) {
                throw this.createStreamChunkError(streamError, chunk.id);
            }

            this.streamProcessor.processChunk(chunk);

            if (this.streamProcessor.isAborted()) {
                const abortReason = this.streamProcessor.getAbortReason();
                if (abortReason === 'buffer_overflow') {
                    throw new LLMPermanentError(
                        `Stream response exceeded max buffer size (${this.config.maxBufferSize})`,
                        undefined,
                        'STREAM_BUFFER_OVERFLOW'
                    );
                }
                throw new LLMRetryableError('Stream processor aborted unexpectedly', undefined, 'STREAM_ABORTED');
            }
        }

        return this.streamProcessor.buildResponse();
    }

    /**
     * 执行非流式调用
     */
    private async executeNormal(messages: Message[], options: LLMGenerateOptions): Promise<LLMResponse> {
        const response = await this.config.provider.generate(messages, options);
        return response as LLMResponse;
    }

    /**
     * 中止当前调用
     */
    abort(): void {
        this.abortController?.abort();
        this.cleanup();
    }

    /**
     * 清理资源
     */
    private cleanup(): void {
        this.abortController = null;
        this.streamProcessor.reset();
    }

    /**
     * 创建流式处理器
     */
    private createStreamProcessor(): StreamProcessor {
        return new StreamProcessor({
            maxBufferSize: this.config.maxBufferSize,
            onMessageCreate: (msg) => this.config.onMessageCreate?.(msg),
            onMessageUpdate: (msg) => this.config.onMessageUpdate?.(msg),
            onTextStart: (msgId) => this.config.onTextStart?.(msgId),
            onTextDelta: (content, msgId) => this.config.onTextDelta?.(content, msgId),
            onTextComplete: (msgId) => this.config.onTextComplete?.(msgId),
            onReasoningStart: (msgId) => this.config.onReasoningStart?.(msgId),
            onReasoningDelta: (content, msgId) => this.config.onReasoningDelta?.(content, msgId),
            onReasoningComplete: (msgId) => this.config.onReasoningComplete?.(msgId),
            onUsageUpdate: (usage, msgId) => this.config.onUsageUpdate?.(usage, msgId),
            validatorOptions: this.config.validatorOptions,
            onValidationViolation: this.config.onValidationViolation,
        });
    }

    /**
     * 获取当前 AbortController
     */
    getAbortController(): AbortController | null {
        return this.abortController;
    }

    private extractStreamChunkError(chunk: Chunk): NonNullable<Chunk['error']> | null {
        if (!chunk.error || typeof chunk.error !== 'object') {
            return null;
        }
        return chunk.error;
    }

    private createStreamChunkError(chunkError: NonNullable<Chunk['error']>, chunkId?: string): Error {
        console.log('[LLMCaller] createStreamChunkError', chunkError, chunkId);
        const rawMessage =
            typeof chunkError.message === 'string' && chunkError.message.trim().length > 0
                ? chunkError.message.trim()
                : 'LLM stream returned an error chunk';

        const message = chunkId ? `${rawMessage} (chunk: ${chunkId})` : rawMessage;

        const rawCode =
            typeof chunkError.code === 'string' && chunkError.code
                ? chunkError.code
                : typeof chunkError.type === 'string' && chunkError.type
                  ? chunkError.type
                  : 'STREAM_CHUNK_ERROR';

        const signature = `${rawCode} ${message}`.toLowerCase();
        if (this.isPermanentStreamError(signature)) {
            return new LLMPermanentError(message, undefined, rawCode);
        }
        return new LLMRetryableError(message, undefined, rawCode);
    }

    private isPermanentStreamError(signature: string): boolean {
        const permanentIndicators = [
            'invalid_request',
            'bad_request',
            'authentication',
            'auth',
            'permission',
            'forbidden',
            'not_found',
            'unsupported',
            'context_length',
            'content_filter',
            'safety',
            'invalid_parameter_error'
        ];

        return permanentIndicators.some((indicator) => signature.includes(indicator));
    }
}
