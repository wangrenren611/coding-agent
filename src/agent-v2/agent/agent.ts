import {
    Chunk,
    InputContentPart,
    LLMError,
    LLMRetryableError,
    isAbortedError,
    isRetryableError,
    LLMGenerateOptions,
    LLMResponse,
    MessageContent,
    LLMRequest,
    Usage
} from "../../providers";
import { Session } from "../session";
import { ToolRegistry } from "../tool/registry";
import { AgentError, CompensationRetryError, ToolError } from "./errors";
import {
    AgentExecutionResult,
    AgentFailure,
    AgentFailureCode,
    AgentOptions,
    AgentStatus,
    StreamCallback
} from "./types";
import { EventBus, EventType } from "../eventbus";
import { Message } from "../session/types";
import { v4 as uuid } from "uuid";
import { createDefaultToolRegistry } from "../tool";
import { StreamProcessor } from "./stream-processor";
import { MessageBuilder } from "./message-builder";
import {
    createToolResultMessage,
    createUserMessage,
} from "./message-builder";
import {
    ITimeProvider,
    SafeError,
    TaskFailedEvent,
    ToolCall,
    ToolExecutionResult,
    ValidationResult,
    getResponseFinishReason,
    getResponseToolCalls,
    responseHasToolCalls,
} from "./types-internal";
import { AgentMessageType } from "./stream-types";
import { ToolContext } from "../tool/base";

// ==================== 默认实现 ====================

class DefaultTimeProvider implements ITimeProvider {
    getCurrentTime(): number {
        return Date.now();
    }

    async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== Agent 类 ====================

export class Agent {
    // 依赖
    private provider: AgentOptions['provider'];
    private session: Session;
    private toolRegistry: ToolRegistry;
    private eventBus: EventBus;

    // 配置
    private systemPrompt: string;
    private maxRetries: number;
    private stream: boolean;
    private streamCallback?: StreamCallback;
    private maxBufferSize: number;
 private thinking?: boolean;

    // 状态
    private status: AgentStatus;
    private abortController: AbortController | null = null;
    private lastFailure?: AgentFailure;

    // 执行追踪
    private taskStartTime = 0;
    private loopCount = 0;
    private retryCount = 0;
    private compensationRetryCount = 0;
    private timeProvider: ITimeProvider;
    private loopMax: number;
    private maxCompensationRetries: number;
    private readonly defaultRetryDelayMs: number;
    private readonly requestTimeoutMs?: number;
    private nextRetryDelayMs: number;

    // 流式处理
    private streamProcessor: StreamProcessor;
    private cumulativeUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    constructor(config: AgentOptions) {
        this.validateConfig(config);

        this.provider = config.provider;
        this.systemPrompt = config.systemPrompt ?? '';
        this.session = new Session({
            systemPrompt: this.systemPrompt,
            memoryManager: config.memoryManager,
            sessionId: config.sessionId,
            enableCompaction: config.enableCompaction,
            compactionConfig: config.compactionConfig,
            provider: this.provider,
        });

        this.toolRegistry = config.toolRegistry ?? createDefaultToolRegistry(
            { workingDirectory: process.cwd() },
            this.provider
        );
        this.maxRetries = config.maxRetries ?? 10;
        this.stream = config.stream ?? false;
        this.streamCallback = config.streamCallback;
        this.eventBus = new EventBus();
        this.status = AgentStatus.IDLE;
        this.timeProvider = config.timeProvider ?? new DefaultTimeProvider();
        this.maxBufferSize = config.maxBufferSize ?? 100000;
 this.thinking = config.thinking;
        this.loopMax = 3000;
        this.maxCompensationRetries = 1;
        this.defaultRetryDelayMs = this.normalizePositiveMs(config.retryDelayMs, 1000 * 60 * 10);
        this.requestTimeoutMs = this.normalizeOptionalPositiveMs(config.requestTimeout);
        this.nextRetryDelayMs = this.defaultRetryDelayMs;

        // 初始化流式处理器
        this.streamProcessor = new StreamProcessor({
            maxBufferSize: this.maxBufferSize,
            onMessageCreate: (msg) => this.session.addMessage(msg as Message),
            onMessageUpdate: (msg) => this.session.addMessage(msg as Message),
            onTextDelta: (content, msgId) => this.emitTextDelta(content, msgId),
            onTextStart: (msgId) => this.emitTextStart(msgId),
            onTextComplete: (msgId) => this.emitTextComplete(msgId),
            // 推理内容回调 (thinking 模式)
            onReasoningDelta: (content, msgId) => this.emitReasoningDelta(content, msgId),
            onReasoningStart: (msgId) => this.emitReasoningStart(msgId),
            onReasoningComplete: (msgId) => this.emitReasoningComplete(msgId),
            // Token 使用量回调
            onUsageUpdate: (usage) => this.emitUsageUpdate(usage),
        });
    }

    // ==================== 公共 API ====================

    async execute(query: MessageContent, options?: LLMGenerateOptions): Promise<Message> {
        const validation = this.validateInput(query);
        if (!validation.valid) {
            throw new AgentError(validation.error || 'Invalid input');
        }

        if (this.isBusy()) {
            throw new AgentError(`Agent is not idle, current status: ${this.status}`);
        }

        await this.session.initialize();
        this.initializeTask(query);

        try {
            await this.runLoop(options);
            this.completeTask();
            const lastMessage = this.session.getLastMessage();
            if (!lastMessage) {
                throw new Error('No message after execution');
            }
            return lastMessage;
        } catch (error) {
            if (this.status !== AgentStatus.ABORTED) {
                this.failTask(error);
            }
            throw error;
        } finally {
            await this.flushSessionPersistence();
        }
    }

    async executeWithResult(query: MessageContent): Promise<AgentExecutionResult> {
        try {
            const finalMessage = await this.execute(query);
            return {
                status: 'completed',
                finalMessage,
                loopCount: this.loopCount,
                retryCount: this.retryCount,
                sessionId: this.session.getSessionId(),
            };
        } catch (error) {
            const failure = this.lastFailure ?? this.buildFailure(error, this.sanitizeError(error));
            const status = this.status === AgentStatus.ABORTED ? 'aborted' : 'failed';
            return {
                status,
                failure,
                loopCount: this.loopCount,
                retryCount: this.retryCount,
                sessionId: this.session.getSessionId(),
            };
        }
    }

    on(type: EventType, listener: (data: unknown) => void): void {
        this.eventBus.on(type, listener);
    }

    off(type: EventType, listener: (data: unknown) => void): void {
        this.eventBus.off(type, listener);
    }

    getMessages(): Message[] {
        return this.session.getMessages();
    }

    getSessionId(): string {
        return this.session.getSessionId();
    }

    getStatus(): AgentStatus {
        return this.status;
    }

    abort(): void {
        this.abortController?.abort();
        this.status = AgentStatus.ABORTED;
        this.lastFailure = {
            code: 'AGENT_ABORTED',
            userMessage: 'Task was aborted.',
            internalMessage: 'Agent aborted by user.',
        };
        this.emitStatus(AgentStatus.ABORTED, 'Agent aborted by user.');
    }

    // ==================== 状态检查 ====================

    private isBusy(): boolean {
        return [AgentStatus.RUNNING, AgentStatus.THINKING].includes(this.status);
    }

    private checkComplete(): boolean {
        const lastMessage = this.session.getLastMessage();
        if (!lastMessage) return false;

        // 用户消息：未开始处理
        if (lastMessage.role === 'user') return false;

        // 助手消息：检查是否有完成标记
        if (lastMessage.role === 'assistant') {
            // 有 finish_reason 表示响应完成
            if (lastMessage.finish_reason) {
                // 如果是工具调用，需要继续获取最终响应
                if (lastMessage.finish_reason === 'tool_calls' || lastMessage.tool_calls) {
                    return false;
                }
                if (this.isCompensationRetryCandidate(lastMessage)) {
                    return false;
                }
                return true;
            }
            // 文本消息但没有工具调用，且有内容，也视为完成
            if (
                lastMessage.type === 'text' &&
                this.hasMessageContent(lastMessage.content) &&
                !lastMessage.tool_calls
            ) {
                return true;
            }
        }

        // 工具消息：需要等待助手响应
        if (lastMessage.role === 'tool') return false;

        return false;
    }

    // ==================== 验证 ====================

    private validateConfig(config: AgentOptions): void {
        if (!config.provider) {
            throw new AgentError('Provider is required');
        }
    }

    private validateInput(query: MessageContent): ValidationResult {
        if (typeof query === 'string') {
            return this.validateTextInput(query);
        }

        if (!Array.isArray(query) || query.length === 0) {
            return { valid: false, error: 'Query content parts cannot be empty' };
        }

        for (const part of query) {
            const partValidation = this.validateContentPart(part);
            if (!partValidation.valid) {
                return partValidation;
            }
        }

        return { valid: true };
    }

    private validateTextInput(query: string): ValidationResult {
        if (query.length === 0) {
            return { valid: false, error: 'Query cannot be empty' };
        }

        if (query.length > 100000) {
            return { valid: false, error: 'Query exceeds maximum length' };
        }

        return { valid: true };
    }

    private validateContentPart(part: InputContentPart): ValidationResult {
        if (!part || typeof part !== 'object' || !('type' in part)) {
            return { valid: false, error: 'Invalid content part structure' };
        }

        switch (part.type) {
            case 'text':
                return this.validateTextInput(part.text || '');
            case 'image_url':
                if (!part.image_url?.url) {
                    return { valid: false, error: 'image_url part must include a valid url' };
                }
                return { valid: true };
            case 'file':
                if (!part.file?.file_id && !part.file?.file_data) {
                    return { valid: false, error: 'file part must include file_id or file_data' };
                }
                return { valid: true };
            case 'input_audio':
                if (!part.input_audio?.data || !part.input_audio?.format) {
                    return { valid: false, error: 'input_audio part must include data and format' };
                }
                return { valid: true };
            case 'input_video':
                if (!part.input_video?.url && !part.input_video?.file_id && !part.input_video?.data) {
                    return { valid: false, error: 'input_video part must include url, file_id, or data' };
                }
                return { valid: true };
            default:
                return { valid: false, error: `Unsupported content part type: ${(part as { type?: string }).type}` };
        }
    }

    private sanitizeError(error: unknown): SafeError {
        if (error instanceof AgentError) {
            return {
                userMessage: error.message,
                internalMessage: error.stack,
            };
        }

        if (error instanceof ToolError) {
            return {
                userMessage: 'Tool execution failed. Please try again.',
                internalMessage: error.message,
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

    // ==================== 任务生命周期 ====================

    private initializeTask(query: MessageContent): void {
        this.taskStartTime = this.timeProvider.getCurrentTime();
        this.loopCount = 0;
        this.retryCount = 0;
        this.compensationRetryCount = 0;
        this.nextRetryDelayMs = this.defaultRetryDelayMs;
        this.lastFailure = undefined;

        this.session.addMessage(createUserMessage(query));
    }

    private contentToText(content: MessageContent): string {
        if (typeof content === 'string') {
            return content;
        }

        return content
            .map((part) => {
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
            })
            .filter(Boolean)
            .join('\n');
    }

    private hasMessageContent(content: MessageContent): boolean {
        if (typeof content === 'string') {
            return content.length > 0;
        }
        return content.length > 0;
    }

    private isCompensationRetryCandidate(message: Message): boolean {
        if (message.role !== 'assistant') return false;
        if (message.finish_reason !== 'stop') return false;
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return false;
        return !this.hasMessageContent(message.content);
    }

    private shouldSendMessageToLLM(message: Message): boolean {
        if (message.role === 'system') return true;
        if (message.role === 'assistant') {
            if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
            return this.hasMessageContent(message.content);
        }
        if (message.role === 'tool') {
            const hasToolCallId = typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0;
            return hasToolCallId || this.hasMessageContent(message.content);
        }
        return this.hasMessageContent(message.content);
    }

    private getMessagesForLLM(): Message[] {
        return this.session.getMessages().filter((message) => this.shouldSendMessageToLLM(message));
    }

    private throwIfCompensationRetryNeeded(): void {
        const lastMessage = this.session.getLastMessage();
        if (!lastMessage) return;
        if (!this.isCompensationRetryCandidate(lastMessage)) return;
        throw new CompensationRetryError('Assistant returned an empty stop response.');
    }

    private completeTask(): void {
        this.status = AgentStatus.COMPLETED;
        this.emitStatus(AgentStatus.COMPLETED, 'Task completed successfully');
    }

    private failTask(error: unknown): void {
        this.status = AgentStatus.FAILED;
        const safeError = this.sanitizeError(error);
        this.lastFailure = this.buildFailure(error, safeError);

        this.eventBus.emit(EventType.TASK_FAILED, {
            timestamp: this.timeProvider.getCurrentTime(),
            error: safeError.internalMessage || safeError.userMessage,
            totalLoops: this.loopCount,
            totalRetries: this.retryCount,
        } as TaskFailedEvent);

        this.emitStatus(AgentStatus.FAILED, safeError.userMessage);
    }

    private buildFailure(error: unknown, safeError: SafeError): AgentFailure {
        return {
            code: this.classifyFailureCode(error),
            userMessage: safeError.userMessage,
            internalMessage: safeError.internalMessage,
        };
    }

    private classifyFailureCode(error: unknown): AgentFailureCode {
        if (this.status === AgentStatus.ABORTED || isAbortedError(error) || this.isAbortLikeError(error)) {
            return 'AGENT_ABORTED';
        }
        if (error instanceof AgentError && /maximum retries/i.test(error.message)) {
            return 'AGENT_MAX_RETRIES_EXCEEDED';
        }
        if (error instanceof ToolError) {
            return 'TOOL_EXECUTION_FAILED';
        }
        if (this.isTimeoutLikeError(error)) {
            return 'LLM_TIMEOUT';
        }
        if (error instanceof LLMError) {
            return 'LLM_REQUEST_FAILED';
        }
        return 'AGENT_RUNTIME_ERROR';
    }

    private isAbortLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return message.includes('abort') || message.includes('aborted');
    }

    private isTimeoutLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return (
            message.includes('timeout')
            || message.includes('timed out')
            || message.includes('time out')
            || message.includes('signal timed out')
        );
    }

    // ==================== 主循环 ====================

    private async runLoop(options?: LLMGenerateOptions): Promise<void> {
        this.emitStatus(AgentStatus.RUNNING, 'Agent is running...');

        while (this.loopCount < this.loopMax) {
            if (this.retryCount > this.maxRetries) {
                throw new AgentError(`Agent failed after maximum retries (${this.maxRetries}).`);
            }

            if (this.checkComplete()) {
                this.emitStatus(AgentStatus.COMPLETED, 'Agent completed the task.');
                break;
            }

            if (this.retryCount > 0) {
                await this.handleRetry();
            }

            this.loopCount++;
            this.status = AgentStatus.RUNNING;

            try {
                await this.executeLLMCall(options);
                this.retryCount = 0;
                this.compensationRetryCount = 0;
                this.nextRetryDelayMs = this.defaultRetryDelayMs;
            } catch (error) {
                if (error instanceof CompensationRetryError) {
                    if (this.compensationRetryCount >= this.maxCompensationRetries) {
                        throw new AgentError(
                            `Agent failed after maximum compensation retries (${this.maxCompensationRetries}).`
                        );
                    }
                    this.compensationRetryCount++;
                    this.status = AgentStatus.RETRYING;
                    this.emitStatus(
                        AgentStatus.RETRYING,
                        `Agent is retrying immediately... (${this.compensationRetryCount}/${this.maxCompensationRetries})`
                    );
                    continue;
                }
             
                if (!isRetryableError(error)) {
                    throw error;
                }
                this.retryCount++;
                this.nextRetryDelayMs = this.resolveRetryDelay(error);
            }
        }
    }

    private async handleRetry(): Promise<void> {
        this.status = AgentStatus.RETRYING;
        await this.timeProvider.sleep(this.nextRetryDelayMs);
        this.emitStatus(
            AgentStatus.RETRYING,
            `Agent is retrying... (${this.retryCount}/${this.maxRetries})`
        );
    }

  

    private resolveRetryDelay(error: unknown): number {
        if (error instanceof LLMRetryableError && typeof error.retryAfter === 'number' && error.retryAfter > 0) {
            return error.retryAfter;
        }
        return this.defaultRetryDelayMs;
    }

    private normalizeOptionalPositiveMs(value: number | undefined): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return undefined;
        }
        return value;
    }

    private normalizePositiveMs(value: number | undefined, fallback: number): number {
        return this.normalizeOptionalPositiveMs(value) ?? fallback;
    }

    // ==================== LLM 调用 ====================

    private async executeLLMCall(options?: LLMGenerateOptions): Promise<void> {
        await this.session.compactBeforeLLMCall();

        this.abortController = new AbortController();
        this.streamProcessor.reset();

        const messageId = uuid();
        const requestTimeout = this.requestTimeoutMs ?? this.provider.getTimeTimeout();
        const timeoutSignal = AbortSignal.any([
            this.abortController.signal,
            AbortSignal.timeout(requestTimeout),
        ]);

        const messages = this.getMessagesForLLM();
        const llmOptions: LLMGenerateOptions = {
            tools: this.toolRegistry.toLLMTools(),
            abortSignal: timeoutSignal,
 thinking: this.thinking,
            ...options,
        };

        try {
            const response = this.stream
                ? await this.executeStreamCall(messages, llmOptions, messageId)
                : await this.executeNormalCall(messages, llmOptions);

            if (!response) {
                throw new AgentError('LLM returned no response');
            }

            await this.handleResponse(response, messageId);
            this.throwIfCompensationRetryNeeded();
        } finally {
            this.cleanup();
        }
    }

    private async executeStreamCall(
        messages: Message[],
        llmOptions: LLMGenerateOptions,
        messageId: string
    ): Promise<LLMResponse> {
        this.emitStatus(AgentStatus.THINKING, 'Agent is thinking...', messageId);

        this.streamProcessor.setMessageId(messageId);

        llmOptions.stream = true;
        const streamResult = await this.provider.generate(messages, llmOptions);
        const streamGenerator = streamResult as unknown as AsyncGenerator<Chunk>;

        for await (const chunk of streamGenerator) {
            this.streamProcessor.processChunk(chunk);
        }

        // 流结束后确保消息包含 usage
        this.ensureMessageHasUsage(messageId);

        return this.streamProcessor.buildResponse();
    }

    private async executeNormalCall(
        messages: Message[],
        llmOptions: LLMGenerateOptions
    ): Promise<LLMResponse> {
        const response = await this.provider.generate(messages, llmOptions);
        return response as LLMResponse;
    }

    private cleanup(): void {
        this.abortController = null;
        this.streamProcessor.reset();
    }

    private async flushSessionPersistence(): Promise<void> {
        try {
            await this.session.sync();
        } catch (error) {
            // 持久化失败不应中断主流程，但要保留诊断信息
            console.error('[Agent] Failed to sync session persistence:', error);
        }
    }

    // ==================== 响应处理 ====================

    private async handleResponse(response: LLMResponse, messageId: string): Promise<void> {
        const choice = response.choices?.[0];

        if (!choice) {
            throw new AgentError('LLM response missing choices');
        }

        if (responseHasToolCalls(response)) {
            await this.handleToolCallResponse(response, messageId);
        } else {
            this.handleTextResponse(response, messageId);
        }
    }

    private handleTextResponse(response: LLMResponse, messageId: string): void {
        const finishReason = getResponseFinishReason(response);

        if (this.stream) {
            // 流式模式下，确保消息的 finish_reason 被设置
            if (finishReason) {
                const lastMessage = this.session.getLastMessage();
                if (lastMessage?.messageId === messageId && !lastMessage.finish_reason) {
                    this.session.addMessage({
                        ...lastMessage,
                        finish_reason: finishReason,
                    });
                }
            }
            return;
        }

        const message = MessageBuilder.fromLLMResponse(response, messageId);
        this.session.addMessage(message);
    }

    private async handleToolCallResponse(
        response: LLMResponse,
        messageId: string
    ): Promise<void> {
        const toolCalls = getResponseToolCalls(response);
        const finishReason = getResponseFinishReason(response);

        // 保存 assistant 的工具调用消息（确保有 finish_reason）
        if (!this.stream) {
            const message = MessageBuilder.fromLLMResponse(response, messageId);
            this.session.addMessage(message);
        } else {
            // 流式模式下，更新消息添加 finish_reason 和 tool_calls（如果还没有）
            const lastMessage = this.session.getLastMessage();
            if (lastMessage?.messageId === messageId && !lastMessage.finish_reason) {
                this.session.addMessage({
                    ...lastMessage,
                    finish_reason: finishReason || 'tool_calls',
                    // 如果消息还没有 tool_calls，从响应中添加
                    tool_calls: lastMessage.tool_calls || toolCalls,
                    type: lastMessage.tool_calls || toolCalls ? 'tool-call' : lastMessage.type,
                });
            }
        }

        // 触发工具调用回调 - 传递当前消息的 content
        const currentMessage = this.session.getLastMessage();
        const messageContent = currentMessage?.messageId === messageId
            ? this.contentToText(currentMessage.content)
            : '';
        this.emitToolCallCreated(toolCalls, messageId, messageContent);

        // 在执行工具前注入最新会话上下文，确保工具可读取 session 级数据
        const toolContext = this.injectToolContext();

        // 执行工具
        const results = await this.toolRegistry.execute(toolCalls, toolContext as ToolContext);
        this.recordToolResults(results);
    }

    private injectToolContext(): { sessionId: string; memoryManager?: unknown } {
        const sessionId = this.session.getSessionId();
        const memoryManager = this.session.getMemoryManager();
        const context = {
            sessionId,
            ...(memoryManager ? { memoryManager } : {}),
        };
        return context;
    }

    private recordToolResults(results: ToolExecutionResult[]): void {
        for (const result of results) {
            const messageId = uuid();
            const sanitized = this.sanitizeToolResult(result);

            this.emitToolCallResult(result, sanitized, messageId);

            this.session.addMessage(
                createToolResultMessage(
                    result.tool_call_id,
                    JSON.stringify(sanitized),
                    messageId
                )
            );
        }
    }

    private sanitizeToolResult(result: ToolExecutionResult): unknown {
        if (!result.result) return result;

        const sanitized = { ...result.result };
        const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization'];

        for (const key of sensitiveKeys) {
            if (key in sanitized) {
                sanitized[key] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    private ensureMessageHasUsage(messageId: string): void {
        const metadata = this.streamProcessor.getMetadata();
        if (!metadata.usage) return;

        const lastMessage = this.session.getLastMessage();
        if (lastMessage?.messageId === messageId && !lastMessage.usage) {
            this.session.addMessage({
                ...lastMessage,
                usage: metadata.usage,
            });
        }
    }

    // ==================== 事件发射 ====================

    private emitStatus(state: AgentStatus, message: string, msgId?: string): void {
        this.streamCallback?.({
            type: AgentMessageType.STATUS,
            payload: { state, message },
            ...(msgId && { msgId }),
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    private emitTextStart(messageId: string): void {
        this.streamCallback?.({
            type: AgentMessageType.TEXT_START,
            payload: { content: '' },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    private emitTextDelta(content: string, messageId: string): void {
        this.streamCallback?.({
            type: AgentMessageType.TEXT_DELTA,
            payload: { content },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    private emitTextComplete(messageId: string): void {
        this.streamCallback?.({
            type: AgentMessageType.TEXT_COMPLETE,
            payload: { content: '' },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

        // ==================== 推理内容发射方法 (thinking 模式) ====================

    private emitReasoningStart(messageId: string): void {
        this.streamCallback?.({
            type: AgentMessageType.REASONING_START,
            payload: { content: '' },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    private emitReasoningDelta(content: string, messageId: string): void {
        this.streamCallback?.({
            type: AgentMessageType.REASONING_DELTA,
            payload: { content },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    private emitReasoningComplete(messageId: string): void {
        this.streamCallback?.({
            type: AgentMessageType.REASONING_COMPLETE,
            payload: { content: '' },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    // ==================== Usage 更新发射方法 ====================

    private emitUsageUpdate(usage: Usage): void {
        // 累加使用量
        this.cumulativeUsage.prompt_tokens += usage.prompt_tokens;
        this.cumulativeUsage.completion_tokens += usage.completion_tokens;
        // total_tokens 用累加后的值计算，确保一致性
        this.cumulativeUsage.total_tokens = 
            this.cumulativeUsage.prompt_tokens + this.cumulativeUsage.completion_tokens;

        this.streamCallback?.({
            type: AgentMessageType.USAGE_UPDATE,
            payload: {
                usage,
                cumulative: { ...this.cumulativeUsage },
            },
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

        private emitToolCallCreated(toolCalls: ToolCall[], messageId: string, content?: string): void {
        this.streamCallback?.({
            type: AgentMessageType.TOOL_CALL_CREATED,
            payload: {
                tool_calls: toolCalls.map((item) => ({
                    callId: item.id,
                    toolName: item.function.name,
                    args: item.function.arguments,
                })),
                content: content || '',
            },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    private emitToolCallResult(
        result: ToolExecutionResult,
        sanitizedResult: unknown,
        messageId: string
    ): void {
        this.streamCallback?.({
            type: AgentMessageType.TOOL_CALL_RESULT,
            payload: {
                callId: result.tool_call_id,
                result: JSON.stringify(sanitizedResult),
                status: result.result?.success ? 'success' : 'error',
            },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    // ==================== 测试方法 ====================

    getLoopCount(): number {
        return this.loopCount;
    }

    getRetryCount(): number {
        return this.retryCount;
    }

    getTaskStartTime(): number {
        return this.taskStartTime;
    }

    getTokenInfo() {
        return this.session.getTokenInfo();
    }
}
