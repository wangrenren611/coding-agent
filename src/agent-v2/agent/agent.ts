/**
 * Agent 核心 类 (重构版)
 *
 * 职责：
 * 1. 协调各组件工作（协调器模式）
 * 2. 管理对话会话状态
 * 3. 处理错误和重试机制
 *
 * 组件委托：
 * - LLM调用 -> LLMCaller
 * - 工具执行 -> ToolExecutor
 * - 状态管理 -> AgentState
 * - 事件发射 -> AgentEmitter
 */

import { v4 as uuid } from "uuid";

import {
    FinishReason,
    LLMGenerateOptions,
    LLMResponse,
    LLMRetryableError,
    isRetryableError,
    MessageContent,
    Usage,
} from "../../providers";
import { Session } from "../session";
import { ToolRegistry } from "../tool/registry";
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
import { LLMCaller } from "./core/llm-caller";
import { ToolExecutor } from "./core/tool-executor";
import { DefaultTimeProvider } from "./time-provider";
import { InputValidator } from "./input-validator";
import { ErrorClassifier } from "./error-classifier";
import { AgentEmitter } from "./agent-emitter";
import type { ResponseValidatorOptions } from "./response-validator";
import {
    ITimeProvider,
    TaskFailedEvent,
    ValidationResult,
    contentToText,
    hasContent,
} from "./core-types";
import {
    getResponseFinishReason,
    getResponseToolCalls,
    responseHasToolCalls,
} from "./types-internal";

// ==================== 常量 ====================

/**
 * Agent 默认配置
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
    private readonly llmCaller: LLMCaller;
    private readonly toolExecutor: ToolExecutor;
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

        // 创建 LLM 调用器
        this.llmCaller = new LLMCaller({
            provider: this.provider,
            stream: this.stream,
            maxBufferSize: config.maxBufferSize ?? AGENT_DEFAULTS.BUFFER_SIZE,
            requestTimeoutMs: this.requestTimeoutMs,
            thinking: this.thinking,
            timeProvider: this.timeProvider,
            // 流式处理回调
            onMessageCreate: (msg) => this.session.addMessage(msg as Message),
            onMessageUpdate: (msg) => this.session.addMessage(msg as Message),
            onTextStart: (msgId) => this.emitter.emitTextStart(msgId),
            onTextDelta: (content, msgId) => this.emitter.emitTextDelta(content, msgId),
            onTextComplete: (msgId) => this.emitter.emitTextComplete(msgId),
            onReasoningStart: (msgId) => this.emitter.emitReasoningStart(msgId),
            onReasoningDelta: (content, msgId) => this.emitter.emitReasoningDelta(content, msgId),
            onReasoningComplete: (msgId) => this.emitter.emitReasoningComplete(msgId),
            onUsageUpdate: (usage, msgId) => {
                this.emitter.emitUsageUpdate(usage);
                this.updateMessageUsage(msgId, usage);
            },
            onStatusChange: (status, message, msgId) => this.emitter.emitStatus(status, message, msgId),
        });

        // 创建工具执行器
        this.toolExecutor = new ToolExecutor({
            toolRegistry: this.toolRegistry,
            sessionId: this.session.getSessionId(),
            memoryManager: this.session.getMemoryManager(),
            onToolCallCreated: (toolCalls, messageId, content) => 
                this.emitter.emitToolCallCreated(toolCalls, messageId, content),
            onToolCallResult: (toolCallId, result, status, resultMessageId) =>
                this.emitter.emitToolCallResult(toolCallId, result, status, resultMessageId),
            onMessageAdd: (msg) => this.session.addMessage(msg),
        });
    }

    // ==================== 公共 API ====================

    async execute(query: MessageContent, options?: LLMGenerateOptions): Promise<Message> {
        this.validateInput(query);
        this.ensureIdle();

        await this.session.initialize();
        this.agentState.startTask();
        this.session.addMessage({ messageId: uuid(), role: 'user', content: query });

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
        this.llmCaller.abort();
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
        if (message.finish_reason) {
            switch (message.finish_reason) {
                case 'abort':
                    return false;
                case 'length': {
                    // finish_reason=length 时，检查是否有未完成的内容或工具调用
                    const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
                    return hasContent(message.content) && !hasTools;
                }
                case 'tool_calls':
                    return false;
            }

            if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
                return false;
            }

            if (this.isEmptyResponse(message)) {
                return false;
            }

            return true;
        }

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

    // ==================== 内部方法：LLM 调用（委托给 LLMCaller） ====================

    private async executeLLMCall(options?: LLMGenerateOptions): Promise<void> {
        await this.session.compactBeforeLLMCall();
        this.agentState.prepareLLMCall();

        const messages = this.getMessagesForLLM();
        
        // 验证消息列表有效性
        if (messages.length === 0 || messages.every(m => m.role === 'system')) {
            throw new AgentError('No valid messages to send to LLM');
        }
        
        const tools = this.toolRegistry.toLLMTools();
        const abortSignal = this.createAbortSignal();

        try {
            // 传递 options 给 llmCaller，允许动态覆盖配置
            const { response, messageId } = await this.llmCaller.execute(
                messages,
                tools,
                abortSignal,
                options
            );

            if (!response) {
                throw new AgentError('LLM returned no response');
            }

            await this.handleResponse(response, messageId);

            // 检查是否为空响应（在 session 添加消息后检查）
            const lastMessage = this.session.getLastMessage();
            if (lastMessage && this.isEmptyResponse(lastMessage)) {
                throw new CompensationRetryError('Empty response');
            }
        } finally {
            // LLMCaller 内部已清理
        }
    }

    private createAbortSignal(): AbortSignal {
        const controller = this.agentState.abortController;
        const timeout = this.requestTimeoutMs ?? this.provider.getTimeTimeout();
        
        if (!controller) {
            return AbortSignal.timeout(timeout);
        }
        return AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    }

    private updateMessageUsage(messageId: string, usage: Usage): void {
        const message = this.session.getMessageById(messageId);
        if (message && !message.usage) {
            this.session.addMessage({ ...message, usage });
        }
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
            await this.handleToolCallResponse(response, messageId, response.usage);
        } else {
            this.handleTextResponse(response, messageId, response.usage);
        }
    }

    private handleTextResponse(response: LLMResponse, messageId: string, usage?: Usage): void {
        if (this.stream) {
            // 流式模式下消息已通过 onMessageUpdate 更新
            this.updateMessageFinishReason(messageId, getResponseFinishReason(response));
            return;
        }
        // 非流式模式需要手动创建消息
        const message: Message = {
            messageId,
            role: 'assistant',
            content: response.choices?.[0]?.message?.content || '',
            finish_reason: getResponseFinishReason(response),
            type: 'text',
            ...(usage && { usage }),
        };
        this.session.addMessage(message);
    }

    private async handleToolCallResponse(
        response: LLMResponse,
        messageId: string,
        usage?: Usage
    ): Promise<void> {
        const toolCalls = getResponseToolCalls(response);
        const finishReason = getResponseFinishReason(response);

        if (this.stream) {
            // 流式模式下消息已通过 onMessageCreate 创建
            this.updateMessageToolCalls(messageId, toolCalls, finishReason);
        } else {
            // 非流式模式需要手动创建消息
            const message: Message = {
                messageId,
                role: 'assistant',
                content: response.choices?.[0]?.message?.content || '',
                tool_calls: toolCalls,
                finish_reason: finishReason || 'tool_calls',
                type: 'tool-call',
                ...(usage && { usage }),
            };
            this.session.addMessage(message);
        }

        // 获取消息内容，传递给 ToolExecutor（内部会触发 onToolCallCreated 回调）
        const currentMessage = this.session.getMessageById(messageId);
        const content = currentMessage ? contentToText(currentMessage.content) : '';

        // 委托给 ToolExecutor 执行工具
        const executionResult = await this.toolExecutor.execute(toolCalls, messageId, content);
        
        // 检查工具执行结果
        if (!executionResult.success) {
            console.warn(`[Agent] Tool execution partially or fully failed: ${executionResult.toolCount} tools executed`);
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

    // ==================== 内部方法：任务状态 ====================

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
