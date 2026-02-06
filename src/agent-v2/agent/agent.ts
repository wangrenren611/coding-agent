import { Chunk, FinishReason, isRetryableError, LLMGenerateOptions, LLMResponse, Role, Usage } from "../../providers";
import { Session, SessionConfig } from "../session";
import { ToolRegistry } from "../tool/registry";
import { AgentError, ToolError } from "./errors";
import { AgentOptions, AgentStatus, StreamCallback } from "./types";
import { EventBus, EventType } from "../eventbus";
import { Message } from "../session/types";
import { v4 as uuid } from "uuid";
import { AgentMessageType } from "./stream-types";
import { createDefaultToolRegistry } from "../tool";
import { IMemoryManager } from "../memory/types";

// ==================== 类型定义 ====================

interface StreamToolCall {
    id: string;
    type: string;
    index: number;
    function: {
        name: string;
        arguments: string;
    };
}

interface StreamChunkMetadata {
    id?: string;
    model?: string;
    created?: number;
    finish_reason?: FinishReason;
    usage?: Usage;
}

interface ToolCall {
    id: string;
    type: string;
    index: number;
    function: {
        name: string;
        arguments: string;
    };
}

interface LLMChoice {
    index: number;
    message: {
        role: string;
        content: string;
        tool_calls?: ToolCall[];
    };
    finish_reason?: FinishReason;
}

interface ToolExecutionResult {
    tool_call_id: string;
    result?: {
        success?: boolean;
        [key: string]: unknown;
    };
}

interface TaskFailedEvent {
    timestamp: number;
    error: string;
    totalLoops: number;
    totalRetries: number;
}

/**
 * 时间提供者接口 - 用于提升可测试性
 */
export interface ITimeProvider {
    getCurrentTime(): number;
    sleep(ms: number): Promise<void>;
}

/**
 * 默认时间提供者实现
 */
class DefaultTimeProvider implements ITimeProvider {
    getCurrentTime(): number {
        return Date.now();
    }

    async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * 输入验证结果
 */
interface ValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * 安全的错误信息
 */
interface SafeError {
    userMessage: string;
    internalMessage?: string;
}

export class Agent {
    // ==================== 类型安全：核心依赖 ====================
    private provider: AgentOptions['provider'];
    private session: Session;
    private toolRegistry: ToolRegistry;
    private eventBus: EventBus;
    private memoryManager?: IMemoryManager;

    // ==================== 类型安全：配置 ====================
    private systemPrompt: string;
    private maxRetries: number;
    private stream: boolean;
    private streamCallback?: StreamCallback;
    private maxBufferSize: number;

    // ==================== 可测试性：状态 ====================
    private status: AgentStatus;
    private abortController: AbortController | null = null;

    // ==================== 可测试性：执行追踪（使用注入的 TimeProvider）====================
    private taskStartTime: number = 0;
    private loopCount: number = 0;
    private retryCount: number = 0;
    private currentQuery: string = '';
    private timeProvider: ITimeProvider;

    // ==================== 流式处理缓冲区 ====================
    private streamBuffer: string = '';
    private streamToolCalls: Map<number, StreamToolCall> = new Map();
    private streamLastChunk: StreamChunkMetadata = {};

    constructor(config: AgentOptions) {
        // 配置参数校验
        if (!config.provider) {
            throw new AgentError('Provider is required');
        }


        this.provider = config.provider;
        this.systemPrompt = config.systemPrompt ?? '';
        this.memoryManager = config.memoryManager;

        // 初始化 Session，传入 memoryManager 和 sessionId
        const sessionConfig: SessionConfig = {
            systemPrompt: this.systemPrompt,
            memoryManager: this.memoryManager,
            sessionId: config.sessionId,
        };
        this.session = new Session(sessionConfig);

        this.toolRegistry = config.toolRegistry ?? createDefaultToolRegistry(
            { workingDirectory: process.cwd() },
            this.provider
        );
        this.maxRetries = config.maxRetries ?? 10;
        this.stream = config.stream ?? false;
        this.streamCallback = config.streamCallback;
        this.eventBus = new EventBus();
        this.status = AgentStatus.IDLE;

        // 可测试性：支持注入时间提供者
        this.timeProvider = config.timeProvider ?? new DefaultTimeProvider();

        // 安全性：设置缓冲区大小限制
        this.maxBufferSize = config.maxBufferSize ?? 100000; // 默认 100KB
    }

    // ==================== 公共方法（带返回类型）====================

    /**
     * 执行 Agent 查询
     * @returns 最后一条消息
     * @throws {AgentError} 当 Agent 非空闲状态时
     */
    async execute(query: string): Promise<Message> {
        // 安全性：输入验证
        const validation = this.validateInput(query);
        if (!validation.valid) {
            throw new AgentError(validation.error || 'Invalid input');
        }

        if ([AgentStatus.RUNNING, AgentStatus.THINKING].includes(this.status)) {
            throw new AgentError(`Agent is not idle, current status: ${this.status}`);
        }

        // 初始化 Session（如果需要）
        await this.session.initialize();

        this.initializeTask(query);

        try {
            await this.loop();
            this.completeTask();
            return this.session.getLastMessage();
        } catch (error) {
            if (this.status !== AgentStatus.ABORTED) {
                this.failTask(error);
            }
            throw error;
        }
    }

    /**
     * 注册事件监听器
     */
    on(type: EventType, listener: (data: unknown) => void): void {
        this.eventBus.on(type, listener);
    }

    /**
     * 取消事件监听器
     */
    off(type: EventType, listener: (data: unknown) => void): void {
        this.eventBus.off(type, listener);
    }

    /**
     * 获取当前会话的所有消息
     * @returns 消息列表
     */
    getMessages(): Message[] {
        return this.session.getMessages();
    }

    /**
     * 获取当前会话 ID
     * @returns 会话 ID
     */
    getSessionId(): string {
        return this.session.getSessionId();
    }

    /**
     * 获取 Agent 当前状态
     */
    getStatus(): AgentStatus {
        return this.status;
    }

    /**
     * 取消正在执行的 Agent
     */
    abort(): void {
        this.abortController?.abort();
        this.status = AgentStatus.ABORTED;
        this.emitStatus(AgentStatus.ABORTED, 'Agent aborted by user.');
    }

    // ==================== 安全性：输入验证 ====================

    /**
     * 验证用户输入
     */
    private validateInput(query: string): ValidationResult {
        if (typeof query !== 'string') {
            return { valid: false, error: 'Query must be a string' };
        }

        if (query.length === 0) {
            return { valid: false, error: 'Query cannot be empty' };
        }

        if (query.length > 100000) {
            return { valid: false, error: 'Query exceeds maximum length' };
        }

        // 检测可能的注入攻击
        const dangerousPatterns = [
            /<script[^>]*>.*?<\/script>/gi,
            /javascript:/gi,
            /data:text\/html/gi,
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(query)) {
                return { valid: false, error: 'Query contains potentially malicious content' };
            }
        }

        return { valid: true };
    }

    /**
     * 安全化错误信息 - 避免暴露内部细节
     */
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
            // 不向用户暴露原始错误消息
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

    // ==================== 私有方法 - 任务管理 ====================

    /**
     * 初始化任务状态
     */
    private initializeTask(query: string): void {
        // 可测试性：使用注入的 TimeProvider
        this.taskStartTime = this.timeProvider.getCurrentTime();
        this.loopCount = 0;
        this.retryCount = 0;
        this.currentQuery = query;

        this.session.addMessage({
            role: 'user',
            content: query,
            type: 'text',
            messageId: uuid(),
        });
    }

    /**
     * 标记任务完成
     */
    private completeTask(): void {
        this.status = AgentStatus.COMPLETED;
        this.emitStatus(AgentStatus.COMPLETED, 'Task completed successfully');
    }

    /**
     * 标记任务失败 - 安全性：使用安全化的错误信息
     */
    private failTask(error: unknown): void {
        this.status = AgentStatus.FAILED;
        const safeError = this.sanitizeError(error);

        // 内部事件包含详细信息（用于日志）
        this.eventBus.emit(EventType.TASK_FAILED, {
            timestamp: this.timeProvider.getCurrentTime(),
            error: safeError.internalMessage || safeError.userMessage,
            totalLoops: this.loopCount,
            totalRetries: this.retryCount,
        } as TaskFailedEvent);

        // 用户只看到友好消息
        this.emitStatus(AgentStatus.FAILED, safeError.userMessage);
    }

    // ==================== 私有方法 - 主循环 ====================

    /**
     * Agent 主循环
     */
    async loop(): Promise<void> {
        this.emitStatus(AgentStatus.RUNNING, 'Agent is running...');

        while (true) {
            if (this.retryCount > this.maxRetries) {
                this.handleMaxRetriesExceeded();
            }

            if (this.checkComplete()) {
                this.status = AgentStatus.COMPLETED;
                this.emitStatus(AgentStatus.COMPLETED, 'Agent completed the task.');
                break;
            }

            if (this.retryCount > 0) {
                this.status = AgentStatus.RETRYING;
                await this.sleep();
                this.emitStatus(AgentStatus.RETRYING, `Agent is retrying... (${this.retryCount}/${this.maxRetries})`);
            }

            this.loopCount++;
            this.status = AgentStatus.RUNNING;

            try {
                await this.executeLLMCall();
                this.retryCount = 0;
            } catch (error) {
                if (!this.handleError(error)) {
                    throw error;
                }
            }
        }
    }

    /**
     * 执行 LLM 调用
     */
    private async executeLLMCall(): Promise<void> {
        this.abortController = new AbortController();
        this.resetStreamBuffers();

        const messageId = uuid();
        const timeoutSignal = AbortSignal.any([
            this.abortController.signal,
            AbortSignal.timeout(this.provider.getTimeTimeout()),
        ]);

        const messages = this.session.getMessages();
        const llmOptions: LLMGenerateOptions = {
            tools: this.toolRegistry.toLLMTools(),
            signal: timeoutSignal,
        };

        try {
            const response = this.stream
                ? await this.executeStreamCall(messages, llmOptions, messageId)
                : await this.executeNormalCall(messages, llmOptions);

            if (!response) {
                throw new AgentError('LLM returned no response');
            }

            await this.handleResponse(response, messageId);
        } finally {
            // 防止上一次的 AbortController 污染下一轮调用
            this.abortController = null;
        }
    }

    /**
     * 执行流式调用
     */
    private async executeStreamCall(
        messages: Message[],
        llmOptions: LLMGenerateOptions,
        messageId: string
    ): Promise<LLMResponse> {
        this.emitStatus(AgentStatus.THINKING, 'Agent is thinking...', messageId);

        llmOptions.stream = true;
        const streamResult = await this.provider.generate(messages, llmOptions);
        const streamGenerator = streamResult as unknown as AsyncGenerator<Chunk>;

        for await (const chunk of streamGenerator) {
            this.handleStreamChunk(chunk, messageId);
        }

        // 流结束后，确保最后一条消息包含 usage（某些 provider 的 usage 在 finish_reason 之后发送）
        this.updateSessionMessageWithUsage(messageId);

        return this.buildStreamResponse();
    }

    /**
     * 执行非流式调用
     */
    private async executeNormalCall(
        messages: Message[],
        llmOptions: LLMGenerateOptions
    ): Promise<LLMResponse> {
        const response = await this.provider.generate(messages, llmOptions);
        return response as LLMResponse;
    }

    /**
     * 重置流式缓冲区
     */
    private resetStreamBuffers(): void {
        this.streamBuffer = '';
        this.streamToolCalls.clear();
        this.streamLastChunk = {};
    }

    /**
     * 处理最大重试次数超限
     */
    private handleMaxRetriesExceeded(): never {
        this.status = AgentStatus.FAILED;
        const error = new AgentError(`Agent failed after maximum retries (${this.maxRetries}).`);
        this.emitStatus(AgentStatus.FAILED, error.message);
        throw error;
    }

    /**
     * 处理错误
     */
    private handleError(error: unknown): boolean {
        if (error instanceof AgentError || !isRetryableError(error)) {
            console.error('Agent error:', error);
            return false;
        }
       
        this.retryCount++;
        return true;
    }

    /**
     * 确保流式内容不会突破缓冲上限；超限时立即中止当前调用
     */
    private appendToStreamBuffer(content: string): void {
        const projectedSize = this.streamBuffer.length + content.length;
        if (projectedSize > this.maxBufferSize) {
            const remaining = this.maxBufferSize - this.streamBuffer.length;
            if (remaining > 0) {
                this.streamBuffer += content.slice(0, remaining);
            }
            this.abortController?.abort();
            throw new AgentError('Response size exceeded limit');
        }

        this.streamBuffer += content;
    }

    // ==================== 私有方法 - 流式处理 ====================

    /**
     * 处理流式输出数据块
     */
    private handleStreamChunk(chunk: Chunk, messageId: string): void {
        if (!this.stream) return;

        const delta = chunk.choices?.[0].delta;
        const finishReason = chunk.choices?.[0].finish_reason;

        if (!delta) return;
        this.processStreamContent(delta.content || '', messageId, chunk.id, finishReason);
        this.processStreamToolCalls(delta.tool_calls, messageId, chunk.id, finishReason);
        this.updateStreamMetadata(chunk, finishReason);
        this.updateSessionWithFinishReason(finishReason, messageId);
    }

    /**
     * 处理流式文本内容 - 安全性：缓冲区大小限制
     */
    private processStreamContent(
        content: string,
        messageId: string,
        chunkId: string | undefined,
        finishReason: FinishReason | undefined
    ): void {
        if (content === '') return;

        // 先检查并累积缓冲，避免后续状态更新后才抛错
        this.appendToStreamBuffer(content);

        const lastMessage = this.session.getLastMessage();

        if (lastMessage.messageId === messageId) {
            this.session.addMessage({
                ...lastMessage,
                content: lastMessage.content + content,
                id: chunkId,
                finish_reason: finishReason || (lastMessage.finishReason as FinishReason),
                type: 'text',
            });
        } else {
            this.session.addMessage({
                role: 'assistant',
                content,
                messageId,
                id: chunkId,
                finish_reason: finishReason,
                type: 'text',
            });

            this.streamCallback?.({
                type: AgentMessageType.TEXT_START,
                payload: { content: '' },
                msgId: messageId,
                sessionId: this.session.getSessionId(),
                timestamp: this.timeProvider.getCurrentTime(),
            });
        }

        this.streamCallback?.({
            type: AgentMessageType.TEXT_DELTA,
            payload: { content },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });

        if (finishReason) {
            this.streamCallback?.({
                type: AgentMessageType.TEXT_COMPLETE,
                payload: { content: '' },
                msgId: messageId,
                sessionId: this.session.getSessionId(),
                timestamp: this.timeProvider.getCurrentTime(),
            });
        }
    }

    /**
     * 处理流式工具调用 - 类型安全：使用精确类型
     */
    private processStreamToolCalls(
        toolCalls: ToolCall[] | undefined,
        messageId: string,
        chunkId: string | undefined,
        finishReason: FinishReason | undefined
    ): void {
        if (!toolCalls || toolCalls.length === 0) return;
          
         this.streamCallback?.({
            type: AgentMessageType.TEXT_COMPLETE,
            payload: { content: '' },
            msgId: messageId,
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
        
        for (const toolCall of toolCalls) {
            this.updateStreamToolCall(toolCall);
        }

        const lastMessage = this.session.getLastMessage();
        const streamToolCalls = Array.from(this.streamToolCalls.values());

        const messageData = {
            role: 'assistant' as const,
            messageId,
            tool_calls: streamToolCalls,
            type: 'tool-call' as const,
            id: chunkId,
            finish_reason: finishReason,
        };

        if (lastMessage.messageId === messageId) {
            this.session.addMessage({
                content: lastMessage.content,
                ...messageData,

            });
        } else {
            this.session.addMessage({
                ...messageData,
                content: '',
            });
        }

    }

    /**
     * 更新流式工具调用数据 - 类型安全：使用精确类型
     */
    private updateStreamToolCall(toolCall: ToolCall): void {
        const index = toolCall.index ?? 0;

        if (!this.streamToolCalls.has(index)) {
            this.streamToolCalls.set(index, {
                id: toolCall.id || '',
                type: toolCall.type || 'function',
                index,
                function: {
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                },
            });
        } else {
            const existing = this.streamToolCalls.get(index)!;
            if (toolCall.function?.name) {
                existing.function.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
                existing.function.arguments += toolCall.function.arguments;
            }
        }
    }

    /**
     * 更新流式元数据
     */
    private updateStreamMetadata(chunk: Chunk, finishReason: FinishReason | undefined): void {
        if (chunk.id) this.streamLastChunk.id = chunk.id;
        if (chunk.model) this.streamLastChunk.model = chunk.model;
        if (chunk.created) this.streamLastChunk.created = chunk.created;
        if (finishReason) this.streamLastChunk.finish_reason = finishReason;
        if (chunk.usage) this.streamLastChunk.usage = chunk.usage;
    }

    /**
     * 更新会话消息的完成原因
     */
    private updateSessionWithFinishReason(finishReason: FinishReason | undefined, messageId: string): void {
        if (!finishReason) return;

        const lastMessage = this.session.getLastMessage();
        if (lastMessage && lastMessage.messageId === messageId) {
            this.session.addMessage({
                ...lastMessage,
                messageId,
                finish_reason: finishReason,
                usage: this.streamLastChunk.usage,
            });
        }
    }

    /**
     * 流结束后更新消息 usage（某些 provider 的 usage 在 finish_reason 之后发送）
     */
    private updateSessionMessageWithUsage(messageId: string): void {
        if (!this.streamLastChunk.usage) return;

        const lastMessage = this.session.getLastMessage();
        if (lastMessage && lastMessage.messageId === messageId && !lastMessage.usage) {
            this.session.addMessage({
                ...lastMessage,
                messageId,
                usage: this.streamLastChunk.usage,
            });
        }
    }

    /**
     * 从流式累积的数据构建 LLMResponse
     */
    private buildStreamResponse(): LLMResponse {
        const toolCalls = Array.from(this.streamToolCalls.values());

        return {
            id: this.streamLastChunk.id || '',
            object: 'chat.completion',
            created: this.streamLastChunk.created || this.timeProvider.getCurrentTime(),
            model: this.streamLastChunk.model || '',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: this.streamBuffer,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    },
                    finish_reason: this.streamLastChunk.finish_reason || undefined,
                },
            ],
            usage: this.streamLastChunk.usage || undefined,
        };
    }

    // ==================== 私有方法 - 响应处理 ====================

    /**
     * 处理 LLM 响应 - 类型安全：使用精确类型
     */
    async handleResponse(response: LLMResponse, messageId: string): Promise<void> {
        const choice = response.choices?.[0];

        if (!choice) {
            throw new AgentError('LLM response missing choices');
        }

        const toolCalls = choice.message?.tool_calls;


        if (toolCalls && toolCalls.length > 0) {

            if (!this.stream) {
            this.session.addMessage({
                role: 'assistant',
                content: choice?.message?.content || '',
                tool_calls: toolCalls,
                messageId,
                finish_reason: choice?.finish_reason || undefined,
                type: 'tool-call',
                usage: response.usage,
            });
            }

            this.streamCallback?.({
                type: AgentMessageType.TOOL_CALL_CREATED,
                payload: {
                    tool_calls: toolCalls.map((item) => ({
                        callId: item.id,
                        toolName: item.function.name,
                        args: item.function.arguments,
                    })),
                    // 携带本条消息的文本内容（非流式模式下用于 UI 展示）
                    content: choice?.message?.content || '',
                },
                msgId: messageId,
                sessionId: this.session.getSessionId(),
                timestamp: this.timeProvider.getCurrentTime(),
            });

            try {
                const results = await this.toolRegistry.execute(toolCalls);
                this.recordToolResults(results, messageId);
            } catch (error) {
                // 安全性：不直接暴露原始错误信息
                const safeError = this.sanitizeError(error);
                throw new ToolError(safeError.userMessage);
            }
        } else {
            if (!this.stream) {
                this.session.addMessage({
                    role: (choice.message?.role || 'assistant') as Role,
                    content: choice.message?.content || '',
                    messageId,
                    finish_reason: choice.finish_reason,
                    type: 'text',
                    usage: response.usage,
                });
            }
        }
    }

    /**
     * 记录工具执行结果 - 类型安全：使用精确类型
     */
    private recordToolResults(results: ToolExecutionResult[], messageId: string): void {
        results.forEach(result => {
            // 安全性：过滤敏感信息
            const sanitizedResult = result;//this.sanitizeToolResult(result);
              const _uuid = uuid();       
      
            this.streamCallback?.({
                type: AgentMessageType.TOOL_CALL_RESULT,
                payload: {
                    callId: result.tool_call_id,
                    result: JSON.stringify(sanitizedResult) || '',
                    status: result.result?.success ? 'success' : 'error',
                },
                msgId: _uuid,
                sessionId: this.session.getSessionId(),
                timestamp: this.timeProvider.getCurrentTime(),
            });
          
            this.session.addMessage({
                role: 'tool',
                tool_call_id: result.tool_call_id,
                content: JSON.stringify(sanitizedResult) || '',
                messageId: _uuid,
                type: 'tool-result',
            });
        });
    }

    /**
     * 安全性：过滤工具执行结果中的敏感信息
     */
    private sanitizeToolResult(result: ToolExecutionResult): unknown {
        if (!result.result) {
            return result;
        }

        const sanitized = { ...result.result };
        const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization'];

        for (const key of sensitiveKeys) {
            if (key in sanitized) {
                sanitized[key] = '[REDACTED]';
            }
        }

        return sanitized;
    }



    // ==================== 私有方法 - 完成检查 ====================

    /**
     * 检查 Agent 是否已完成
     */
    private checkComplete(): boolean {
        const lastMessage = this.session.getLastMessage();

        if (!lastMessage) {
            return false;
        }

        const hasFinishReason = lastMessage.type === 'text' && lastMessage.finish_reason;
        const isEmptyText = lastMessage.type === 'text' && !lastMessage.content;

        return !!(hasFinishReason || isEmptyText);
    }

    // ==================== 私有方法 - 事件发射 ====================

    /**
     * 发射状态消息 - 类型安全：使用精确类型
     */
    private emitStatus(state: AgentStatus, message: string, msgId?: string): void {
        this.streamCallback?.({
            type: AgentMessageType.STATUS,
            payload: { state, message },
            ...(msgId && { msgId }),
            sessionId: this.session.getSessionId(),
            timestamp: this.timeProvider.getCurrentTime(),
        });
    }

    // ==================== 可测试性：公共方法 ====================

    /**
     * 获取当前循环次数 - 用于测试
     */
    getLoopCount(): number {
        return this.loopCount;
    }

    /**
     * 获取当前重试次数 - 用于测试
     */
    getRetryCount(): number {
        return this.retryCount;
    }

    /**
     * 获取任务开始时间 - 用于测试
     */
    getTaskStartTime(): number {
        return this.taskStartTime;
    }

     /**
     * 休眠指定时长
     */
    private sleep(ms=1000*3): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
