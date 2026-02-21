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
import { ToolContext } from "../tool/base";
import { AgentEmitter } from "./agent-emitter";
import { safeToolResultToString } from "../util";
import type { ResponseValidatorOptions } from "./response-validator";
import { DefaultTimeProvider } from "./time-provider";
import { contentToText, hasContent } from "./core-types";
import { InputValidator } from "./input-validator";
import { ErrorClassifier } from "./error-classifier";
import { AgentState } from "./core/agent-state";

// ==================== Agent 常量 ====================

/** 最大循环次数 */
const LOOP_MAX = 3000;

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 10;

/** 默认重试延迟（毫秒）- 10 分钟 */
const DEFAULT_RETRY_DELAY_MS = 1000 * 60 * 10;

/** 最大补偿重试次数 */
const MAX_COMPENSATION_RETRIES = 1;

// ==================== Agent 类 ====================

export class Agent {
    // 依赖
    private provider: AgentOptions['provider'];
    private session: Session;
    private toolRegistry: ToolRegistry;
    private eventBus: EventBus;

    // 配置
    private systemPrompt: string;
    private stream: boolean;
    private streamCallback?: StreamCallback;
    private maxBufferSize: number;
    private thinking?: boolean;
    private validationOptions?: Partial<ResponseValidatorOptions>;
    private onValidationViolation?: (result: ValidationResult) => void;

    // 请求超时
    private readonly requestTimeoutMs?: number;

    // 状态管理器
    private agentState: AgentState;

    // 时间提供者（用于 sleep）
    private timeProvider: ITimeProvider;

    // 流式处理
    private streamProcessor: StreamProcessor;
    private emitter: AgentEmitter;

    // 验证器
    private inputValidator: InputValidator;

    // 错误分类器
    private errorClassifier: ErrorClassifier;

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
        this.stream = config.stream ?? false;
        this.streamCallback = config.streamCallback;
        this.eventBus = new EventBus();
        this.timeProvider = config.timeProvider ?? new DefaultTimeProvider();
        this.maxBufferSize = config.maxBufferSize ?? 100000;
        this.thinking = config.thinking;
        this.validationOptions = config.validationOptions;
        this.onValidationViolation = config.onValidationViolation;
        this.requestTimeoutMs = this.normalizeOptionalPositiveMs(config.requestTimeout);

        // 初始化状态管理器
        this.agentState = new AgentState({
            maxLoops: LOOP_MAX,
            maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
            maxCompensationRetries: MAX_COMPENSATION_RETRIES,
            defaultRetryDelayMs: this.normalizePositiveMs(config.retryDelayMs, DEFAULT_RETRY_DELAY_MS),
            timeProvider: this.timeProvider,
        });

        // 初始化事件发射器
        this.emitter = new AgentEmitter({
            streamCallback: this.streamCallback,
            sessionId: this.session.getSessionId(),
            getTimestamp: () => this.timeProvider.getCurrentTime(),
        });

        // 初始化流式处理器
        this.streamProcessor = new StreamProcessor({
            maxBufferSize: this.maxBufferSize,
            onMessageCreate: (msg) => this.session.addMessage(msg as Message),
            onMessageUpdate: (msg) => this.session.addMessage(msg as Message),
            onTextDelta: (content, msgId) => this.emitter.emitTextDelta(content, msgId),
            onTextStart: (msgId) => this.emitter.emitTextStart(msgId),
            onTextComplete: (msgId) => this.emitter.emitTextComplete(msgId),
            // 推理内容回调 (thinking 模式)
            onReasoningDelta: (content, msgId) => this.emitter.emitReasoningDelta(content, msgId),
            onReasoningStart: (msgId) => this.emitter.emitReasoningStart(msgId),
            onReasoningComplete: (msgId) => this.emitter.emitReasoningComplete(msgId),
            // Token 使用量回调
            onUsageUpdate: (usage) => this.emitter.emitUsageUpdate(usage),
            // 响应验证配置
            validatorOptions: this.validationOptions,
            onValidationViolation: this.onValidationViolation,
        });

        // 初始化输入验证器
        this.inputValidator = new InputValidator();

        // 初始化错误分类器
        this.errorClassifier = new ErrorClassifier();
    }

    // ==================== 公共 API ====================

    async execute(query: MessageContent, options?: LLMGenerateOptions): Promise<Message> {
        const validation = this.inputValidator.validate(query);
        if (!validation.valid) {
            throw new AgentError(validation.error || 'Invalid input');
        }

        if (this.agentState.isBusy()) {
            throw new AgentError(`Agent is not idle, current status: ${this.agentState.status}`);
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
            if (!this.agentState.isAborted()) {
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
                loopCount: this.agentState.loopCount,
                retryCount: this.agentState.retryCount,
                sessionId: this.session.getSessionId(),
            };
        } catch (error) {
            const failure = this.agentState.lastFailure ?? this.errorClassifier.buildFailure(error, this.agentState.status);
            const status = this.agentState.status === AgentStatus.ABORTED ? 'aborted' : 'failed';
            return {
                status,
                failure,
                loopCount: this.agentState.loopCount,
                retryCount: this.agentState.retryCount,
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
        return this.agentState.status;
    }

    abort(): void {
        this.agentState.abort();
        this.emitter.emitStatus(AgentStatus.ABORTED, 'Agent aborted by user.');
    }

    // ==================== 状态检查 ====================

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
                hasContent(lastMessage.content) &&
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

    // ==================== 任务生命周期 ====================

    private initializeTask(query: MessageContent): void {
        this.agentState.startTask();
        this.session.addMessage(createUserMessage(query));
    }

    private isCompensationRetryCandidate(message: Message): boolean {
        if (message.role !== 'assistant') return false;
        if (message.finish_reason !== 'stop') return false;
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return false;
        return !hasContent(message.content);
    }

    private shouldSendMessageToLLM(message: Message): boolean {
        if (message.role === 'system') return true;
        if (message.role === 'assistant') {
            if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
            return hasContent(message.content);
        }
        if (message.role === 'tool') {
            const hasToolCallId = typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0;
            return hasToolCallId || hasContent(message.content);
        }
        return hasContent(message.content);
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
        this.agentState.completeTask();
        this.emitter.emitStatus(AgentStatus.COMPLETED, 'Task completed successfully');
    }

    private failTask(error: unknown): void {
        const safeError = this.errorClassifier.sanitizeError(error);
        const failure = this.errorClassifier.buildFailure(error, this.agentState.status);
        this.agentState.failTask(failure);

        this.eventBus.emit(EventType.TASK_FAILED, {
            timestamp: this.timeProvider.getCurrentTime(),
            error: safeError.internalMessage || safeError.userMessage,
            totalLoops: this.agentState.loopCount,
            totalRetries: this.agentState.retryCount,
        } as TaskFailedEvent);

        this.emitter.emitStatus(AgentStatus.FAILED, safeError.userMessage);
    }

    // ==================== 主循环 ====================

    private async runLoop(options?: LLMGenerateOptions): Promise<void> {
        this.emitter.emitStatus(AgentStatus.RUNNING, 'Agent is running...');

        while (this.agentState.canContinue()) {
            if (this.agentState.isRetryExceeded()) {
                throw new AgentError(`Agent failed after maximum retries.`);
            }

            if (this.checkComplete()) {
                break;
            }

            if (this.agentState.needsRetry()) {
                await this.handleRetry();
            }

            this.agentState.incrementLoop();
            this.agentState.setStatus(AgentStatus.RUNNING);

            try {
                await this.executeLLMCall(options);
                this.agentState.recordSuccess();
            } catch (error) {
                if (error instanceof CompensationRetryError) {
                    if (this.agentState.isCompensationRetryExceeded()) {
                        throw new AgentError(`Agent failed after maximum compensation retries.`);
                    }
                    this.agentState.recordCompensationRetry();
                    this.agentState.setStatus(AgentStatus.RETRYING);
                    this.emitter.emitStatus(
                        AgentStatus.RETRYING,
                        `Agent is retrying immediately... (${this.agentState.compensationRetryCount}/${this.agentState.getSnapshot().lastFailure})`
                    );
                    continue;
                }
             
                if (!isRetryableError(error)) {
                    throw error;
                }
                this.agentState.recordRetryableError(this.resolveRetryDelay(error));
            }
        }
    }

    private async handleRetry(): Promise<void> {
        this.agentState.setStatus(AgentStatus.RETRYING);
        await this.timeProvider.sleep(this.agentState.nextRetryDelayMs);
        const snapshot = this.agentState.getSnapshot();
        this.emitter.emitStatus(
            AgentStatus.RETRYING,
            `Agent is retrying... (${snapshot.retryCount}/${snapshot.loopCount})`
        );
    }

  

    private resolveRetryDelay(error: unknown): number {
        if (error instanceof LLMRetryableError && typeof error.retryAfter === 'number' && error.retryAfter > 0) {
            return error.retryAfter;
        }
        return this.agentState.nextRetryDelayMs;
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

        // 为每次 LLM 调用创建新的 AbortController
        this.agentState.prepareLLMCall();
        this.streamProcessor.reset();

        const messageId = uuid();
        const requestTimeout = this.requestTimeoutMs ?? this.provider.getTimeTimeout();
        const timeoutSignal = AbortSignal.any([
            this.agentState.abortController!.signal,
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
        this.emitter.emitStatus(AgentStatus.THINKING, 'Agent is thinking...', messageId);

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
            ? contentToText(currentMessage.content)
            : '';
        this.emitter.emitToolCallCreated(toolCalls, messageId, messageContent);

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

            this.emitter.emitToolCallResult(result.tool_call_id, sanitized, result.result?.success ? 'success' : 'error', messageId);

            this.session.addMessage(
                createToolResultMessage(
                    result.tool_call_id,
                    safeToolResultToString(sanitized),
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


    // ==================== 测试方法 ====================

    getLoopCount(): number {
        return this.agentState.loopCount;
    }

    getRetryCount(): number {
        return this.agentState.retryCount;
    }

    getTaskStartTime(): number {
        return this.agentState.taskStartTime;
    }

    getTokenInfo() {
        return this.session.getTokenInfo();
    }
}
