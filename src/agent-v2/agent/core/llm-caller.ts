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
import type { LLMProvider, LLMGenerateOptions, LLMResponse, Chunk } from '../../../providers';
import type { Message } from '../../session/types';
import { StreamProcessor } from '../stream-processor';
import { AgentStatus } from '../types';
import type { ITimeProvider } from '../core-types';
import { DefaultTimeProvider } from '../time-provider';
import { AgentError } from '../errors';

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
    onUsageUpdate?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
    /** 状态变更回调 */
    onStatusChange?: (status: AgentStatus, message: string, messageId?: string) => void;
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
        tools: unknown[],
        abortSignal?: AbortSignal
    ): Promise<LLMCallResult> {
        const messageId = uuid();
        this.abortController = new AbortController();
        this.streamProcessor.reset();
        this.streamProcessor.setMessageId(messageId);

        // 合并超时信号
        const requestTimeout = this.config.requestTimeoutMs ?? this.config.provider.getTimeTimeout();
        const timeoutSignal = AbortSignal.any([
            this.abortController.signal,
            AbortSignal.timeout(requestTimeout),
            ...(abortSignal ? [abortSignal] : []),
        ]);

        const llmOptions: LLMGenerateOptions = {
            tools,
            abortSignal: timeoutSignal,
            thinking: this.config.thinking,
            stream: this.config.stream,
        };

        let response: LLMResponse;

        if (this.config.stream) {
            response = await this.executeStream(messages, llmOptions, messageId);
        } else {
            response = await this.executeNormal(messages, llmOptions);
        }

        this.cleanup();
        return { response, messageId };
    }

    /**
     * 执行流式调用
     */
    private async executeStream(
        messages: Message[],
        options: LLMGenerateOptions,
        messageId: string
    ): Promise<LLMResponse> {
        this.config.onStatusChange?.(AgentStatus.THINKING, 'Agent is thinking...', messageId);

        options.stream = true;
        const streamResult = await this.config.provider.generate(messages, options);
        const streamGenerator = streamResult as unknown as AsyncGenerator<Chunk>;

        for await (const chunk of streamGenerator) {
            this.streamProcessor.processChunk(chunk);
        }

        return this.streamProcessor.buildResponse();
    }

    /**
     * 执行非流式调用
     */
    private async executeNormal(
        messages: Message[],
        options: LLMGenerateOptions
    ): Promise<LLMResponse> {
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
            onUsageUpdate: (usage) => this.config.onUsageUpdate?.(usage),
        });
    }

    /**
     * 获取当前 AbortController
     */
    getAbortController(): AbortController | null {
        return this.abortController;
    }
}
