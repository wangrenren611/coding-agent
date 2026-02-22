/**
 * Agent 核心 类
 *
 * 职责：
 * 1. 协调 LLM 调用和工具执行
 * 2. 管理对话会话状态
 * 3. 处理流式/非流式响应
 * 4. 错误处理和重试机制
 */

import { v4 as uuid } from "uuid";

import {
    Chunk,
    FinishReason,
    LLMGenerateOptions,
    LLMResponse,
    LLMRetryableError,
    isRetryableError,
    MessageContent,
} from "../../providers";
import { Session } from "../session";
import { ToolRegistry } from "../tool/registry";
import { ToolContext } from "../tool/base";
import { EventBus, EventType } from "../eventbus";
import { Message } from "../session/types";
import { createDefaultToolRegistry } from "../tool";

import { AgentError, CompensationRetryError } from "./errors";
import {
    AgentExecutionResult,
    AgentFailure,
    AgentOptions,
    AgentStatus,
    StreamCallback,
} from "./types";
import { AgentState } from "./core/agent-state";
import { DefaultTimeProvider } from "./time-provider";
import { InputValidator } from "./input-validator";
import { ErrorClassifier } from "./error-classifier";
import { StreamProcessor } from "./stream-processor";
import { MessageBuilder, createToolResultMessage, createUserMessage } from "./message-builder";
import { AgentEmitter } from "./agent-emitter";
import { safeToolResultToString } from "../util";
import type { ResponseValidatorOptions } from "./response-validator";
import {
    ITimeProvider,
    TaskFailedEvent,
    ToolExecutionResult,
    ValidationResult,
    contentToText,
    hasContent,
} from "./core-types";
import {
    getResponseFinishReason,
    getResponseToolCalls,
    responseHasToolCalls,
    isChunkStream,
} from "./types-internal";

// ==================== 常量 ====================

/**
 * Agent 默认配置
 * 可通过 AgentOptions 覆盖
 */
const AGENT_DEFAULTS = {
    /** 最大循环次数 */
    LOOP_MAX: 3000,
    /** 最大重试次数 */
    MAX_RETRIES: 10,
    /** 默认重试延迟（毫秒）- 10 分钟 */
    RETRY_DELAY_MS: 10 * 60 * 1000,
    /** 最大补偿重试次数 */
    MAX_COMPENSATION_RETRIES: 1,
    /** Abort 重试延迟（毫秒） */
    ABORT_RETRY_DELAY_MS: 5000,
    /** 默认流式缓冲区大小（字节） */
    BUFFER_SIZE: 100000,
} as const;

/**
 * 敏感字段列表（用于脱敏）
 */
const SENSITIVE_KEYS = [
    'password', 'token', 'secret', 'apiKey', 'api_key', 'authorization',
    'credential', 'private_key', 'privateKey', 'access_token', 'accessToken',
    'refresh_token', 'refreshToken', 'session_key', 'sessionKey',
    'api_secret', 'apiSecret', 'secret_key', 'secretKey',
] as const;

// ==================== Agent 类 ====================

export class Agent {
    // 外部依赖
    private readonly provider: AgentOptions['provider'];
    private readonly session: Session;
    private readonly toolRegistry: ToolRegistry;
    private readonly eventBus: EventBus;

    // 配置
    private readonly stream: boolean;
    private readonly streamCallback?: StreamCallback;
    private readonly thinking?: boolean;
    private readonly requestTimeoutMs?: number;
    private readonly validationOptions?: Partial<ResponseValidatorOptions>;
    private readonly onValidationViolation?: (result: ValidationResult) => void;

    // 内部组件
    private readonly agentState: AgentState;
    private readonly timeProvider: ITimeProvider;
    private readonly streamProcessor: StreamProcessor;
    private readonly emitter: AgentEmitter;
    private readonly inputValidator: InputValidator;
    private readonly errorClassifier: ErrorClassifier;

    constructor(config: AgentOptions) {
        this.provider = this.validateAndGetProvider(config);
        this.stream = config.stream ?? false;
        this.streamCallback = config.streamCallback;
        this.thinking = config.thinking;
        this.requestTimeoutMs = this.normalizeMs(config.requestTimeout);
        this.validationOptions = config.validationOptions;
        this.onValidationViolation = config.onValidationViolation;

        this.timeProvider = config.timeProvider ?? new DefaultTimeProvider();
        this.eventBus = new EventBus();
        this.inputValidator = new InputValidator();
        this.errorClassifier = new ErrorClassifier();

        this.session = new Session({
            systemPrompt: config.systemPrompt ?? '',
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

        this.agentState = new AgentState({
            maxLoops: config.maxLoops ?? AGENT_DEFAULTS.LOOP_MAX,
            maxRetries: config.maxRetries ?? AGENT_DEFAULTS.MAX_RETRIES,
            maxCompensationRetries: config.maxCompensationRetries ?? AGENT_DEFAULTS.MAX_COMPENSATION_RETRIES,
            defaultRetryDelayMs: config.retryDelayMs ?? AGENT_DEFAULTS.RETRY_DELAY_MS,
            timeProvider: this.timeProvider,
        });

        this.emitter = new AgentEmitter({
            streamCallback: this.streamCallback,
            sessionId: this.session.getSessionId(),
            getTimestamp: () => this.timeProvider.getCurrentTime(),
        });

        this.streamProcessor = new StreamProcessor({
            maxBufferSize: config.maxBufferSize ?? AGENT_DEFAULTS.BUFFER_SIZE,
            onMessageCreate: (msg) => this.session.addMessage(msg as Message),
            onMessageUpdate: (msg) => this.session.addMessage(msg as Message),
            onTextDelta: (content, msgId) => this.emitter.emitTextDelta(content, msgId),
            onTextStart: (msgId) => this.emitter.emitTextStart(msgId),
            onTextComplete: (msgId) => this.emitter.emitTextComplete(msgId),
            onReasoningDelta: (content, msgId) => this.emitter.emitReasoningDelta(content, msgId),
            onReasoningStart: (msgId) => this.emitter.emitReasoningStart(msgId),
            onReasoningComplete: (msgId) => this.emitter.emitReasoningComplete(msgId),
            onUsageUpdate: (usage) => this.emitter.emitUsageUpdate(usage),
            validatorOptions: this.validationOptions,
            onValidationViolation: this.onValidationViolation,
        });
    }

    // ==================== 公共 API ====================

    async execute(query: MessageContent, options?: LLMGenerateOptions): Promise<Message> {
        this.validateInput(query);
        this.ensureIdle();

        await this.session.initialize();
        this.agentState.startTask();
        this.session.addMessage(createUserMessage(query));

        try {
            await this.runLoop(options);
            this.completeTask();
            return this.getFinalMessage();
        } catch (error) {
            if (!this.agentState.isAborted()) {
                this.failTask(error);
            }
            throw error;
        } finally {
            await this.flushSession();
        }
    }

    async executeWithResult(
        query: MessageContent,
        options?: LLMGenerateOptions
    ): Promise<AgentExecutionResult> {
        try {
            const finalMessage = await this.execute(query, options);
            return {
                status: 'completed',
                finalMessage,
                loopCount: this.agentState.loopCount,
                retryCount: this.agentState.retryCount,
                sessionId: this.session.getSessionId(),
            };
        } catch (error) {
            const failure = this.agentState.lastFailure
                ?? this.errorClassifier.buildFailure(error, this.agentState.status);
            return {
                status: this.agentState.status === AgentStatus.ABORTED ? 'aborted' : 'failed',
                failure,
                loopCount: this.agentState.loopCount,
                retryCount: this.agentState.retryCount,
                sessionId: this.session.getSessionId(),
            };
        }
    }

    abort(): void {
        this.agentState.abort();
        this.emitter.emitStatus(AgentStatus.ABORTED, 'Agent aborted by user.');
    }

    // ==================== 事件订阅 ====================

    on(type: EventType, listener: (data: unknown) => void): void {
        this.eventBus.on(type, listener);
    }

    off(type: EventType, listener: (data: unknown) => void): void {
        this.eventBus.off(type, listener);
    }

    // ==================== 状态查询 ====================

    getStatus(): AgentStatus {
        return this.agentState.status;
    }

    getMessages(): Message[] {
        return this.session.getMessages();
    }

    getSessionId(): string {
        return this.session.getSessionId();
    }

    // ==================== 内部方法：初始化与验证 ====================

    private validateAndGetProvider(config: AgentOptions): AgentOptions['provider'] {
        if (!config.provider) {
            throw new AgentError('Provider is required');
        }
        return config.provider;
    }

    private validateInput(query: MessageContent): void {
        const result = this.inputValidator.validate(query);
        if (!result.valid) {
            throw new AgentError(result.error || 'Invalid input');
        }
    }

    private ensureIdle(): void {
        if (this.agentState.isBusy()) {
            throw new AgentError(`Agent is not idle, current status: ${this.agentState.status}`);
        }
    }

    private normalizeMs(value: number | undefined): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return undefined;
        }
        return value;
    }

    // ==================== 内部方法：主循环 ====================

    private async runLoop(options?: LLMGenerateOptions): Promise<void> {
        this.emitter.emitStatus(AgentStatus.RUNNING, 'Agent is running...');

        while (this.agentState.canContinue()) {
            if (this.agentState.isRetryExceeded()) {
                throw new AgentError('Agent failed after maximum retries.');
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
                this.handleLoopError(error);
            }
        }
    }

    private handleLoopError(error: unknown): never | void {
        // 补偿重试：空响应
        if (error instanceof CompensationRetryError) {
            if (this.agentState.isCompensationRetryExceeded()) {
                throw new AgentError('Agent failed after maximum compensation retries.');
            }
            this.session.removeLastMessage();
            this.agentState.recordCompensationRetry();
            this.agentState.setStatus(AgentStatus.RETRYING);
            this.emitter.emitStatus(
                AgentStatus.RETRYING,
                `Compensation retry (${this.agentState.compensationRetryCount})`
            );
            return;
        }

        // 可重试错误
        if (isRetryableError(error)) {
            const delay = this.resolveRetryDelay(error);
            this.agentState.recordRetryableError(delay);
            return;
        }

        throw error;
    }

    private async handleRetry(): Promise<void> {
        this.agentState.setStatus(AgentStatus.RETRYING);
        await this.timeProvider.sleep(this.agentState.nextRetryDelayMs);
        const stats = this.agentState.getStats();
        this.emitter.emitStatus(
            AgentStatus.RETRYING,
            `Retrying... (${stats.retries}/${stats.loops})`
        );
    }

    private resolveRetryDelay(error: unknown): number {
        if (error instanceof LLMRetryableError && typeof error.retryAfter === 'number' && error.retryAfter > 0) {
            return error.retryAfter;
        }
        return this.agentState.nextRetryDelayMs;
    }

    // ==================== 内部方法：完成检测 ====================

    private checkComplete(): boolean {
        const lastMessage = this.session.getLastMessage();
        if (!lastMessage) return false;

        switch (lastMessage.role) {
            case 'user':
                return false;

            case 'tool':
                return false;

            case 'assistant':
                return this.checkAssistantComplete(lastMessage);

            default:
                return false;
        }
    }

    private checkAssistantComplete(message: Message): boolean {
        // 有 finish_reason 时根据原因判断
        if (message.finish_reason) {
            switch (message.finish_reason) {
                case 'abort':
                    return false; // 需要重试
                case 'length':
                    return hasContent(message.content); // 有内容则完成
                case 'tool_calls':
                    return false; // 需要执行工具
            }

            // 检查工具调用
            if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
                return false;
            }

            // 检查空响应（补偿重试候选）
            if (this.isEmptyResponse(message)) {
                return false;
            }

            return true; // stop 或其他正常原因
        }

        // 无 finish_reason：检查是否为有内容的文本消息
        const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
        return message.type === 'text'
            && hasContent(message.content)
            && !hasToolCalls;
    }

    private isEmptyResponse(message: Message): boolean {
        const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
        return message.role === 'assistant'
            && message.finish_reason === 'stop'
            && !hasToolCalls
            && !hasContent(message.content);
    }

    // ==================== 内部方法：LLM 调用 ====================

    private async executeLLMCall(options?: LLMGenerateOptions): Promise<void> {
        await this.session.compactBeforeLLMCall();
        this.agentState.prepareLLMCall();
        this.streamProcessor.reset();

        const messageId = uuid();
        const timeout = this.requestTimeoutMs ?? this.provider.getTimeTimeout();
        const abortSignal = this.createAbortSignal(timeout);

        const messages = this.getMessagesForLLM();
        const llmOptions: LLMGenerateOptions = {
            tools: this.toolRegistry.toLLMTools(),
            abortSignal,
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

            // 检查是否需要补偿重试
            if (this.isEmptyResponse(this.session.getLastMessage()!)) {
                throw new CompensationRetryError('Empty response');
            }
        } finally {
            this.streamProcessor.reset();
        }
    }

    private createAbortSignal(timeoutMs: number): AbortSignal {
        const controller = this.agentState.abortController;
        if (!controller) {
            return AbortSignal.timeout(timeoutMs);
        }
        return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    }

    private async executeStreamCall(
        messages: Message[],
        options: LLMGenerateOptions,
        messageId: string
    ): Promise<LLMResponse> {
        this.emitter.emitStatus(AgentStatus.THINKING, 'Agent is thinking...', messageId);
        this.streamProcessor.setMessageId(messageId);

        options.stream = true;
        const streamResult = await this.provider.generate(messages, options);
        
        // 使用类型守卫替代不安全断言
        if (!isChunkStream(streamResult)) {
            throw new AgentError('Provider returned non-stream result for stream request');
        }
        const stream = streamResult;

        for await (const chunk of stream) {
            this.streamProcessor.processChunk(chunk);
        }

        this.updateMessageUsage(messageId);
        return this.streamProcessor.buildResponse();
    }

    private async executeNormalCall(
        messages: Message[],
        options: LLMGenerateOptions
    ): Promise<LLMResponse> {
        return this.provider.generate(messages, options);
    }

    // ==================== 内部方法：响应处理 ====================

    private async handleResponse(response: LLMResponse, messageId: string): Promise<void> {
        const choice = response.choices?.[0];
        if (!choice) {
            throw new AgentError('LLM response missing choices');
        }

        const finishReason = getResponseFinishReason(response);

        // abort 完成原因触发重试
        if (finishReason === 'abort') {
            throw new LLMRetryableError(
                'LLM request was aborted',
                AGENT_DEFAULTS.ABORT_RETRY_DELAY_MS,
                'LLM_ABORT'
            );
        }

        if (responseHasToolCalls(response)) {
            await this.handleToolCallResponse(response, messageId);
        } else {
            this.handleTextResponse(response, messageId);
        }
    }

    private handleTextResponse(response: LLMResponse, messageId: string): void {
        if (this.stream) {
            this.updateMessageFinishReason(messageId, getResponseFinishReason(response));
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

        if (this.stream) {
            this.updateMessageToolCalls(messageId, toolCalls, finishReason);
        } else {
            const message = MessageBuilder.fromLLMResponse(response, messageId);
            this.session.addMessage(message);
        }

        // 触发工具调用事件
        const currentMessage = this.session.getMessageById(messageId);
        const content = currentMessage ? contentToText(currentMessage.content) : '';
        this.emitter.emitToolCallCreated(toolCalls, messageId, content);

        // 执行工具
        const context = this.createToolContext();
        const results = await this.toolRegistry.execute(toolCalls, context as ToolContext);
        this.recordToolResults(results);
    }

    private createToolContext(): { sessionId: string; memoryManager?: unknown } {
        const memoryManager = this.session.getMemoryManager();
        return {
            sessionId: this.session.getSessionId(),
            ...(memoryManager && { memoryManager }),
        };
    }

    private recordToolResults(results: ToolExecutionResult[]): void {
        for (const result of results) {
            const messageId = uuid();
            const sanitized = this.sanitizeResult(result);

            this.emitter.emitToolCallResult(
                result.tool_call_id,
                sanitized,
                result.result?.success ? 'success' : 'error',
                messageId
            );

            this.session.addMessage(
                createToolResultMessage(
                    result.tool_call_id,
                    safeToolResultToString(sanitized),
                    messageId
                )
            );
        }
    }

    // ==================== 内部方法：消息处理 ====================

    private getMessagesForLLM(): Message[] {
        return this.session.getMessages().filter(msg => this.shouldSendMessage(msg));
    }

    private shouldSendMessage(message: Message): boolean {
        switch (message.role) {
            case 'system':
                return true;
            case 'assistant': {
                const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
                return !!(hasTools || hasContent(message.content));
            }
            case 'tool':
                return !!(message.tool_call_id || hasContent(message.content));
            default:
                return hasContent(message.content);
        }
    }

    private updateMessageFinishReason(messageId: string, finishReason?: FinishReason): void {
        if (!finishReason) return;
        const message = this.session.getMessageById(messageId);
        if (message && !message.finish_reason) {
            this.session.addMessage({ ...message, finish_reason: finishReason });
        }
    }

    private updateMessageToolCalls(
        messageId: string,
        toolCalls: ReturnType<typeof getResponseToolCalls>,
        finishReason?: FinishReason
    ): void {
        const message = this.session.getMessageById(messageId);
        if (message && !message.finish_reason) {
            this.session.addMessage({
                ...message,
                finish_reason: finishReason || 'tool_calls',
                tool_calls: message.tool_calls || toolCalls,
                type: (message.tool_calls || toolCalls) ? 'tool-call' : message.type,
            });
        }
    }

    private updateMessageUsage(messageId: string): void {
        const metadata = this.streamProcessor.getMetadata();
        if (!metadata.usage) return;

        const message = this.session.getMessageById(messageId);
        if (message && !message.usage) {
            this.session.addMessage({ ...message, usage: metadata.usage });
        }
    }

    // ==================== 内部方法：工具函数 ====================

    private sanitizeResult(result: ToolExecutionResult): unknown {
        if (!result.result) return result;

        const sanitized = { ...result.result };
        for (const key of SENSITIVE_KEYS) {
            if (key in sanitized) {
                sanitized[key] = '[REDACTED]';
            }
        }
        return sanitized;
    }

    private completeTask(): void {
        this.agentState.completeTask();
        this.emitter.emitStatus(AgentStatus.COMPLETED, 'Task completed successfully');
    }

    private failTask(error: unknown): void {
        const safeError = this.errorClassifier.sanitizeError(error);
        const failure = this.errorClassifier.buildFailure(error, this.agentState.status);
        this.agentState.failTask(failure);

        const event: TaskFailedEvent = {
            timestamp: this.timeProvider.getCurrentTime(),
            error: safeError.internalMessage || safeError.userMessage,
            totalLoops: this.agentState.loopCount,
            totalRetries: this.agentState.retryCount,
        };
        this.eventBus.emit(EventType.TASK_FAILED, event);

        this.emitter.emitStatus(AgentStatus.FAILED, safeError.userMessage);
    }

    private getFinalMessage(): Message {
        const lastMessage = this.session.getLastMessage();
        if (!lastMessage) {
            throw new Error('No message after execution');
        }
        return lastMessage;
    }

    private async flushSession(): Promise<void> {
        try {
            await this.session.sync();
        } catch (error) {
            console.error('[Agent] Failed to sync session:', error);
        }
    }

    // ==================== 测试辅助方法 ====================

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
