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

import { v4 as uuid } from 'uuid';

import {
    FinishReason,
    LLMGenerateOptions,
    LLMResponse,
    LLMRetryableError,
    type ToolCall,
    isRetryableError,
    MessageContent,
    Usage,
} from '../../providers';
import { Session } from '../session';
import { ToolRegistry } from '../tool/registry';
import { EventBus, EventType } from '../eventbus';
import { Message } from '../session/types';
import { createDefaultToolRegistry } from '../tool';

import {
    AgentAbortedError,
    AgentBusyError,
    AgentLoopExceededError,
    AgentMaxRetriesExceededError,
    AgentConfigurationError,
    AgentValidationError,
    LLMRequestError,
    LLMResponseInvalidError,
} from './errors';
import { AgentExecutionResult, AgentOptions, AgentStatus, StreamCallback } from './types';
import { AgentState } from './core/agent-state';
import { LLMCaller } from './core/llm-caller';
import { ToolExecutor } from './core/tool-executor';
import { DefaultTimeProvider } from './time-provider';
import { InputValidator } from './input-validator';
import { ErrorClassifier } from './error-classifier';
import { AgentEmitter } from './agent-emitter';
import { ITimeProvider, TaskFailedEvent, contentToText, hasContent } from './core-types';
import { getResponseFinishReason, getResponseToolCalls, responseHasToolCalls } from './types-internal';

// ==================== 常量 ====================

/**
 * Agent 默认配置
 *
 * 超时控制说明：
 * - Agent.requestTimeout 优先使用
 * - 如果未设置，回退到 Provider.getTimeTimeout()（provider 默认通常为 3 分钟）
 */
const AGENT_DEFAULTS = {
    /** 最大循环次数 */
    LOOP_MAX: 3000,
    /** 最大重试次数 */
    MAX_RETRIES: 10,
    /** 默认重试延迟（毫秒）- 10 秒 */
    RETRY_DELAY_MS: 10 * 1000,
    /** Abort 重试延迟（毫秒） */
    ABORT_RETRY_DELAY_MS: 5000,
    /** 空响应重试延迟（毫秒） */
    EMPTY_RESPONSE_RETRY_DELAY_MS: 100,
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
    private pendingRetryReason: string | null = null;

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

        this.toolRegistry =
            config.toolRegistry ?? createDefaultToolRegistry({ workingDirectory: process.cwd() }, this.provider);
        this.configureToolEventBridge();

        this.agentState = new AgentState({
            maxLoops: config.maxLoops ?? AGENT_DEFAULTS.LOOP_MAX,
            maxRetries: config.maxRetries ?? AGENT_DEFAULTS.MAX_RETRIES,
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
            validatorOptions: config.validationOptions,
            onValidationViolation: config.onValidationViolation,
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
                this.emitter.emitUsageUpdate(usage, msgId);
                this.updateMessageUsage(msgId, usage);
            },
            onStatusChange: (status, message, msgId, meta) => this.emitter.emitStatus(status, message, msgId, meta),
        });

        // 创建工具执行器
        this.toolExecutor = new ToolExecutor({
            toolRegistry: this.toolRegistry,
            sessionId: this.session.getSessionId(),
            memoryManager: this.session.getMemoryManager(),
            streamCallback: this.streamCallback,
            onToolCallCreated: (toolCalls, messageId, content) =>
                this.emitter.emitToolCallCreated(toolCalls, messageId, content),
            onToolCallStream: (toolCallId, output, messageId) =>
                this.emitter.emitToolCallStream(toolCallId, output, messageId),
            onToolCallResult: (toolCallId, result, status, resultMessageId) =>
                this.emitter.emitToolCallResult(toolCallId, result, status, resultMessageId),
            onCodePatch: (filePath, diff, messageId, language) =>
                this.emitter.emitCodePatch(filePath, diff, messageId, language),
            onMessageAdd: (msg) => this.session.addMessage(msg),
        });
    }

    // ==================== 公共 API ====================

    async execute(query: MessageContent, options?: LLMGenerateOptions): Promise<Message> {
        this.validateInput(query);
        this.ensureIdle();
        this.agentState.startTask();
        this.pendingRetryReason = null;

        try {
            await this.session.initialize();
            this.eventBus.emit(EventType.TASK_START, {
                timestamp: this.timeProvider.getCurrentTime(),
                query: contentToText(query),
            });
            this.session.addMessage({ messageId: uuid(), role: 'user', content: query });

            await this.runLoop(options);
            if (this.agentState.isAborted()) {
                throw new AgentAbortedError();
            }
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

    async executeWithResult(query: MessageContent, options?: LLMGenerateOptions): Promise<AgentExecutionResult> {
        try {
            const finalMessage = await this.execute(query, options);
            return {
                status: 'completed',
                finalMessage,
                loopCount: this.agentState.loopCount,
                retryCount: this.agentState.totalRetryCount,
                sessionId: this.session.getSessionId(),
            };
        } catch (error) {
            const failure =
                this.agentState.lastFailure ?? this.errorClassifier.buildFailure(error, this.agentState.status);
            return {
                status: this.agentState.status === AgentStatus.ABORTED ? 'aborted' : 'failed',
                failure,
                loopCount: this.agentState.loopCount,
                retryCount: this.agentState.totalRetryCount,
                sessionId: this.session.getSessionId(),
            };
        }
    }

    abort(): void {
        this.agentState.abort();
        this.llmCaller.abort();
        this.emitter.emitStatus(AgentStatus.ABORTED, 'Agent aborted by user.', undefined, {
            source: 'agent',
            phase: 'failure',
        });
    }

    // ==================== 事件订阅 ====================

    on(type: EventType, listener: (data: unknown) => void): void {
        this.eventBus.on(type, listener);
    }

    off(type: EventType, listener: (data: unknown) => void): void {
        this.eventBus.off(type, listener);
    }

    private configureToolEventBridge(): void {
        this.toolRegistry.setEventCallbacks({
            onToolStart: (toolName, args) => {
                this.eventBus.emit(EventType.TOOL_START, {
                    timestamp: this.timeProvider.getCurrentTime(),
                    toolName,
                    arguments: args,
                });
            },
            onToolSuccess: (toolName, duration, result) => {
                this.eventBus.emit(EventType.TOOL_SUCCESS, {
                    timestamp: this.timeProvider.getCurrentTime(),
                    toolName,
                    duration,
                    resultLength: this.getPayloadLength(result),
                });
            },
            onToolFailed: (toolName, error) => {
                this.eventBus.emit(EventType.TOOL_FAILED, {
                    timestamp: this.timeProvider.getCurrentTime(),
                    toolName,
                    error: this.normalizeToolError(error),
                });
            },
        });
    }

    private getPayloadLength(value: unknown): number {
        if (typeof value === 'string') {
            return value.length;
        }
        try {
            return JSON.stringify(value)?.length ?? 0;
        } catch {
            return 0;
        }
    }

    private normalizeToolError(value: unknown): string {
        if (value instanceof Error) {
            return value.message || value.name;
        }
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value) || String(value);
        } catch {
            return String(value);
        }
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
            throw new AgentConfigurationError('Provider is required');
        }
        return config.provider;
    }

    private validateInput(query: MessageContent): void {
        const result = this.inputValidator.validate(query);
        if (!result.valid) {
            throw new AgentValidationError(result.error || 'Invalid input');
        }
    }

    private ensureIdle(): void {
        if (this.agentState.isBusy()) {
            throw new AgentBusyError(this.agentState.status);
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
        this.emitter.emitStatus(AgentStatus.RUNNING, 'Agent is running...', undefined, {
            source: 'agent',
            phase: 'lifecycle',
        });

        while (true) {
            if (this.agentState.isAborted()) {
                break;
            }

            if (this.checkComplete()) {
                break;
            }

            if (this.agentState.isRetryExceeded()) {
                const reasonSuffix = this.pendingRetryReason ? ` Last error: ${this.pendingRetryReason}` : '';
                throw new AgentMaxRetriesExceededError(reasonSuffix || undefined);
            }

            if (!this.agentState.canContinue()) {
                throw new AgentLoopExceededError(this.agentState.loopCount);
            }

            if (this.agentState.needsRetry()) {
                await this.handleRetry();
                if (this.agentState.isAborted()) {
                    break;
                }
            }

            this.agentState.incrementLoop();
            this.agentState.setStatus(AgentStatus.RUNNING);
            this.eventBus.emit(EventType.TASK_PROGRESS, {
                timestamp: this.timeProvider.getCurrentTime(),
                loopCount: this.agentState.loopCount,
                retryCount: this.agentState.retryCount,
            });

            try {
                this.agentState.setStatus(AgentStatus.THINKING);
                await this.executeLLMCall(options);
                this.agentState.recordSuccess();
            } catch (error) {
                this.handleLoopError(error);
            }
        }
    }

    private handleLoopError(error: unknown): never | void {
        // 可重试错误
        if (isRetryableError(error)) {
            const delay = this.resolveRetryDelay(error);
            this.agentState.recordRetryableError(delay);
            this.pendingRetryReason = this.formatRetryReason(error);
            const stats = this.agentState.getStats();
            this.eventBus.emit(EventType.TASK_RETRY, {
                timestamp: this.timeProvider.getCurrentTime(),
                retryCount: stats.retries,
                maxRetries: stats.maxRetries,
                reason: this.pendingRetryReason,
            });
            return;
        }

        throw error;
    }

    private async handleRetry(): Promise<void> {
        this.agentState.setStatus(AgentStatus.RETRYING);
        await this.sleepWithAbort(this.agentState.nextRetryDelayMs);
        if (this.agentState.isAborted()) {
            return;
        }
        const stats = this.agentState.getStats();
        const retryDelay = this.agentState.nextRetryDelayMs;
        const reasonSuffix = this.pendingRetryReason ? ` - ${this.pendingRetryReason}` : '';
        const retryReason = this.pendingRetryReason ?? undefined;
        this.pendingRetryReason = null;
        this.emitter.emitStatus(
            AgentStatus.RETRYING,
            `Retrying... (${stats.retries}/${stats.maxRetries}) after ${retryDelay}ms${reasonSuffix}`,
            undefined,
            {
                source: 'agent',
                phase: 'retry',
                retry: {
                    type: 'normal',
                    attempt: stats.retries,
                    max: stats.maxRetries,
                    delayMs: retryDelay,
                    nextRetryAt: this.timeProvider.getCurrentTime() + retryDelay,
                    reason: retryReason,
                },
            }
        );
    }

    private resolveRetryDelay(error: unknown): number {
        if (error instanceof LLMRetryableError && typeof error.retryAfter === 'number' && error.retryAfter > 0) {
            return error.retryAfter;
        }
        return this.agentState.nextRetryDelayMs;
    }

    private async sleepWithAbort(ms: number): Promise<void> {
        const controller = this.agentState.abortController;
        if (!controller) {
            await this.timeProvider.sleep(ms);
            return;
        }
        if (controller.signal.aborted) {
            return;
        }

        await Promise.race([
            this.timeProvider.sleep(ms),
            new Promise<void>((resolve) => {
                controller.signal.addEventListener('abort', () => resolve(), { once: true });
            }),
        ]);
    }

    private formatRetryReason(error: unknown): string {
        if (!(error instanceof Error)) {
            return String(error);
        }

        const withMeta = error as Error & { code?: unknown; errorType?: unknown };
        const tags: string[] = [];
        if (typeof withMeta.code === 'string' && withMeta.code) {
            tags.push(withMeta.code);
        }
        if (typeof withMeta.errorType === 'string' && withMeta.errorType && !tags.includes(withMeta.errorType)) {
            tags.push(withMeta.errorType);
        }

        const prefix = tags.length > 0 ? `[${tags.join('/')}] ` : '';
        const message = `${prefix}${error.message}`.trim();
        return message.length > 200 ? `${message.slice(0, 200)}...` : message;
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
                    return this.hasAssistantOutput(message) && !hasTools;
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
        return message.type === 'text' && this.hasAssistantOutput(message) && !hasToolCalls;
    }

    private isEmptyResponse(message: Message): boolean {
        const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
        return message.role === 'assistant' && !hasToolCalls && !this.hasAssistantOutput(message);
    }

    private hasReasoningOutput(reasoning: unknown): reasoning is string {
        return typeof reasoning === 'string' && reasoning.trim().length > 0;
    }

    private hasAssistantOutput(message: Pick<Message, 'content' | 'reasoning_content'>): boolean {
        return hasContent(message.content) 
        //|| this.hasReasoningOutput(message.reasoning_content);
    }

    private resolveAssistantContent(content: MessageContent, reasoning: unknown): MessageContent {
        if (hasContent(content)) {
            return content;
        }
        if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
            return reasoning;
        }
        return typeof content === 'string' ? content : '';
    }

    private isEmptyAssistantChoice(response: LLMResponse): boolean {
        const choice = response.choices?.[0];
        if (!choice) return false;

        const toolCalls = choice.message?.tool_calls;
        const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
        if (hasToolCalls) return false;

        const content = choice.message?.content || '';
        const reasoning = choice.message?.reasoning_content;
        return !hasContent(content) && !this.hasReasoningOutput(reasoning);
    }

    private async removeAssistantMessageFromContext(
        messageId: string,
        reason: 'empty_response' | 'invalid_response'
    ): Promise<void> {
        const target = this.session.getMessageById(messageId);
        if (!target || target.role !== 'assistant') {
            return;
        }
        await this.session.removeMessageById(messageId, reason);
    }

    // ==================== 内部方法：LLM 调用（委托给 LLMCaller） ====================

    private async executeLLMCall(options?: LLMGenerateOptions): Promise<void> {
        await this.session.compactBeforeLLMCall();
        this.agentState.prepareLLMCall();

        const messages = this.getMessagesForLLM();

        // 验证消息列表有效性
        if (messages.length === 0 || messages.every((m) => m.role === 'system')) {
            throw new LLMRequestError('No valid messages to send to LLM');
        }

        const tools = this.toolRegistry.toLLMTools();
        const abortSignal = this.createAbortSignal();

        try {
            // 传递 options 给 llmCaller，允许动态覆盖配置
            const { response, messageId } = await this.llmCaller.execute(messages, tools, abortSignal, options);

            try {
                if (!response) {
                    throw new LLMResponseInvalidError('LLM returned no response');
                }

                await this.handleResponse(response, messageId);

                // 基于原始响应判定空响应，避免依赖 session 中是否已经写入 assistant 消息。
                if (this.isEmptyAssistantChoice(response)) {
                    await this.removeAssistantMessageFromContext(messageId, 'empty_response');
                    throw new LLMRetryableError(
                        'LLM returned empty response',
                        AGENT_DEFAULTS.EMPTY_RESPONSE_RETRY_DELAY_MS,
                        'EMPTY_RESPONSE'
                    );
                }
            } catch (error) {
                if (error instanceof LLMResponseInvalidError) {
                    await this.removeAssistantMessageFromContext(messageId, 'invalid_response');
                }
                throw error;
            }
        } finally {
            // LLMCaller 内部已清理
        }
    }

    private createAbortSignal(): AbortSignal | undefined {
        const controller = this.agentState.abortController;
        return controller?.signal;
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
            throw new LLMResponseInvalidError('LLM response missing choices');
        }

        const finishReason = getResponseFinishReason(response);

        // abort 完成原因触发重试
        if (finishReason === 'abort') {
            throw new LLMRetryableError('LLM request was aborted', AGENT_DEFAULTS.ABORT_RETRY_DELAY_MS, 'LLM_ABORT');
        }

        if (responseHasToolCalls(response)) {
            await this.handleToolCallResponse(response, messageId, response.usage);
        } else {
            this.handleTextResponse(response, messageId, response.usage);
        }
    }

    private handleTextResponse(response: LLMResponse, messageId: string, usage?: Usage): void {
        const rawContent = response.choices?.[0]?.message?.content || '';
        const reasoningContent = response.choices?.[0]?.message?.reasoning_content;
        const resolvedContent = this.resolveAssistantContent(rawContent, reasoningContent);

        if (this.stream) {
            const finishReason = getResponseFinishReason(response);
            const existing = this.session.getMessageById(messageId);

            // 标准流式路径：消息已通过 onMessageUpdate 更新
            if (existing) {
                if (!hasContent(existing.content) && this.hasReasoningOutput(existing.reasoning_content)) {
                    this.session.addMessage({
                        ...existing,
                        content: this.resolveAssistantContent(existing.content, existing.reasoning_content),
                    });
                }
                this.updateMessageFinishReason(messageId, finishReason);
                return;
            }

            // 兜底路径：某些 provider 在 stream=true 时直接返回完整响应（非增量）。
            // 这种情况下需要主动发出文本事件并落库，否则 UI 会只显示 completed 而无正文。
            const hasRawText = hasContent(rawContent);
            if (hasRawText) {
                this.emitter.emitTextStart(messageId);
                this.emitter.emitTextDelta(contentToText(rawContent), messageId);
                this.emitter.emitTextComplete(messageId);
            } else if (this.hasReasoningOutput(reasoningContent)) {
                this.emitter.emitReasoningStart(messageId);
                this.emitter.emitReasoningDelta(reasoningContent, messageId);
                this.emitter.emitReasoningComplete(messageId);
            }
            this.session.addMessage({
                messageId,
                role: 'assistant',
                content: resolvedContent,
                ...(this.hasReasoningOutput(reasoningContent) && { reasoning_content: reasoningContent }),
                finish_reason: finishReason,
                type: 'text',
                ...(usage && { usage }),
            });
            return;
        }
        // 非流式模式需要手动创建消息
        const message: Message = {
            messageId,
            role: 'assistant',
            content: resolvedContent,
            ...(this.hasReasoningOutput(reasoningContent) && { reasoning_content: reasoningContent }),
            finish_reason: getResponseFinishReason(response),
            type: 'text',
            ...(usage && { usage }),
        };
        this.session.addMessage(message);
    }

    private async handleToolCallResponse(response: LLMResponse, messageId: string, usage?: Usage): Promise<void> {
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
            this.emitter.emitStatus(
                AgentStatus.RUNNING,
                `[warn] Tool execution partially or fully failed: ${executionResult.toolCount} tools executed`,
                undefined,
                {
                    source: 'tool-executor',
                    phase: 'tool',
                }
            );
        }
    }

    // ==================== 内部方法：消息处理 ====================

    private getMessagesForLLM(): Message[] {
        const normalizedMessages = this.session
            .getMessages()
            .map((msg) => this.normalizeMessageForLLM(msg))
            .filter((msg): msg is Message => !!msg)
            .filter((msg) => this.shouldSendMessage(msg));

        return this.enforceToolCallProtocol(normalizedMessages);
    }

    private shouldSendMessage(message: Message): boolean {
        switch (message.role) {
            case 'system':
                return true;
            case 'assistant': {
                const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
                return !!(hasTools || this.hasAssistantOutput(message));
            }
            case 'tool':
                return typeof message.tool_call_id === 'string' && message.tool_call_id.trim().length > 0;
            default:
                return hasContent(message.content);
        }
    }

    private normalizeMessageForLLM(message: Message): Message | null {
        if (message.role === 'assistant') {
            const rawToolCalls = message.tool_calls;
            if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
                const validToolCalls = this.getValidToolCalls(rawToolCalls);
                if (validToolCalls.length === 0) {
                    if (!this.hasAssistantOutput(message)) {
                        return null;
                    }
                    const rest = { ...message };
                    delete rest.tool_calls;
                    return { ...rest, type: rest.type === 'tool-call' ? 'text' : rest.type };
                }

                if (validToolCalls.length !== rawToolCalls.length) {
                    return { ...message, tool_calls: validToolCalls, type: 'tool-call' };
                }
            }
            return message;
        }

        if (message.role === 'tool') {
            if (typeof message.tool_call_id !== 'string' || message.tool_call_id.trim().length === 0) {
                return null;
            }
            return message;
        }

        return message;
    }

    private getValidToolCalls(toolCalls: ToolCall[]): ToolCall[] {
        return toolCalls.filter((toolCall) => {
            if (!toolCall || typeof toolCall !== 'object') return false;
            const hasValidId = typeof toolCall.id === 'string' && toolCall.id.trim().length > 0;
            const hasValidType = toolCall.type === 'function';
            const hasValidFunction =
                !!toolCall.function &&
                typeof toolCall.function.name === 'string' &&
                toolCall.function.name.trim().length > 0 &&
                typeof toolCall.function.arguments === 'string';
            return hasValidId && hasValidType && hasValidFunction;
        });
    }

    /**
     * 发送前修复/约束 tool call 协议：
     * assistant(tool_calls) 后必须紧跟对应的 tool(result) 消息。
     * - 缺失的 tool 结果会注入中断占位，避免 provider 400
     * - 游离/不匹配的 tool 消息会被丢弃
     */
    private enforceToolCallProtocol(messages: Message[]): Message[] {
        const fixed: Message[] = [];

        for (let index = 0; index < messages.length; ) {
            const message = messages[index];

            if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
                const validToolCalls = this.getValidToolCalls(message.tool_calls);
                if (validToolCalls.length === 0) {
                    if (this.hasAssistantOutput(message)) {
                        const rest = { ...message };
                        delete rest.tool_calls;
                        fixed.push({ ...rest, type: rest.type === 'tool-call' ? 'text' : rest.type });
                    }
                    index += 1;
                    continue;
                }

                const assistantWithTools: Message =
                    validToolCalls.length === message.tool_calls.length
                        ? message
                        : { ...message, tool_calls: validToolCalls, type: 'tool-call' };
                fixed.push(assistantWithTools);

                const expectedIds = new Set(validToolCalls.map((call) => call.id));
                const respondedIds = new Set<string>();
                let cursor = index + 1;

                while (cursor < messages.length && messages[cursor].role === 'tool') {
                    const toolMessage = messages[cursor];
                    const toolCallId =
                        typeof toolMessage.tool_call_id === 'string' ? toolMessage.tool_call_id.trim() : '';

                    if (expectedIds.has(toolCallId) && !respondedIds.has(toolCallId)) {
                        fixed.push(toolMessage);
                        respondedIds.add(toolCallId);
                    }
                    cursor += 1;
                }

                for (const call of validToolCalls) {
                    if (!respondedIds.has(call.id)) {
                        fixed.push(this.createInterruptedToolResult(call.id));
                    }
                }

                index = cursor;
                continue;
            }

            if (message.role === 'tool') {
                // 游离 tool 消息（未紧跟在 assistant tool_calls 后）直接丢弃
                index += 1;
                continue;
            }

            fixed.push(message);
            index += 1;
        }

        return fixed;
    }

    private createInterruptedToolResult(toolCallId: string): Message {
        return {
            messageId: uuid(),
            role: 'tool',
            type: 'tool-result',
            tool_call_id: toolCallId,
            content: JSON.stringify({
                success: false,
                error: 'TOOL_CALL_INTERRUPTED',
                interrupted: true,
                message: 'Tool execution was interrupted before a result was produced.',
            }),
        };
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
                type: message.tool_calls || toolCalls ? 'tool-call' : message.type,
            });
        }
    }

    // ==================== 内部方法：任务状态 ====================

    private completeTask(): void {
        this.agentState.completeTask();
        const stats = this.agentState.getStats();
        this.eventBus.emit(EventType.TASK_SUCCESS, {
            timestamp: this.timeProvider.getCurrentTime(),
            totalLoops: stats.loops,
            totalRetries: stats.totalRetries,
            duration: stats.duration,
        });
        this.emitter.emitStatus(AgentStatus.COMPLETED, 'Task completed successfully', undefined, {
            source: 'agent',
            phase: 'completion',
        });
    }

    private failTask(error: unknown): void {
        const safeError = this.errorClassifier.sanitizeError(error);
        const failure = this.errorClassifier.buildFailure(error, this.agentState.status);
        this.agentState.failTask(failure);

        const event: TaskFailedEvent = {
            timestamp: this.timeProvider.getCurrentTime(),
            error: safeError.internalMessage || safeError.userMessage,
            totalLoops: this.agentState.loopCount,
            totalRetries: this.agentState.totalRetryCount,
        };
        this.eventBus.emit(EventType.TASK_FAILED, event);

        this.emitter.emitError(safeError.internalMessage || safeError.userMessage, 'task-failed');
        this.emitter.emitStatus(AgentStatus.FAILED, safeError.userMessage, undefined, {
            source: 'agent',
            phase: 'failure',
        });
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
            const reason = error instanceof Error ? error.message : String(error);
            this.emitter.emitError(`Failed to sync session: ${reason}`, 'session-sync');
        }
    }

    // ==================== 测试辅助方法 ====================

    getLoopCount(): number {
        return this.agentState.loopCount;
    }

    getRetryCount(): number {
        return this.agentState.totalRetryCount;
    }

    getTaskStartTime(): number {
        return this.agentState.taskStartTime;
    }

    getTokenInfo() {
        return this.session.getTokenInfo();
    }
}
