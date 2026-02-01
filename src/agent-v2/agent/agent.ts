import { Chunk, FinishReason, LLMGenerateOptions, LLMResponse } from "../../providers";
import { Session } from "../session";
import { ToolRegistry } from "../tool/registry";
import { AgentError, ToolError } from "./errors";
import { AgentOptions, AgentStatus, StreamCallback } from "./types";
import { EventBus } from "../eventbus";
import { EventType } from "../eventbus";
import { Message } from "../session/types";
import { uuid } from "uuidv4";
import { AgentMessageType } from "./stream-types";

export class Agent {
    /** Agent 状态 */
    private status: AgentStatus;
    private provider: AgentOptions['provider'];
    private systemPrompt: string;
    private session: Session;
    private toolRegistry: ToolRegistry;
    private maxRetries: number;
    private stream: boolean;
    private streamCallback?: StreamCallback;
    private abortController: AbortController | null = null;
    /** 事件总线 */
    private eventBus: EventBus;
    /** 任务开始时间戳 */
    private taskStartTime: number = 0;
    /** 当前循环次数 */
    private loopCount: number = 0;
    /** 重试次数 */
    private retryCount: number = 0;
    /** 任务 ID */
    private taskId: string = '';
    /** 当前查询 */
    private currentQuery: string = '';
    /** 流式输出累积内容 */
    private streamBuffer: string = '';
    /** 流式工具调用累积 Map<index, ToolCall> */
    private streamToolCalls: Map<number, any> = new Map();
    /** 流式最后一个 chunk 的元数据（用于构建 LLMResponse） */
    private streamLastChunk: {
        id?: string;
        model?: string;
        created?: number;
        finish_reason?: FinishReason;
    } = {};
 
    constructor(config: AgentOptions) {
        // 配置参数校验
        if (!config.provider) {
            throw new Error('Provider is required');
        }
        if (!config.toolRegistry) {
            throw new Error('ToolRegistry is required');
        }

        this.status = AgentStatus.IDLE;
        this.provider = config.provider;
        this.systemPrompt = config.systemPrompt ?? '';
        this.session = new Session({
            systemPrompt: this.systemPrompt,
        });
        this.toolRegistry = config.toolRegistry;
        this.maxRetries = config.maxRetries ?? 10;
        this.stream = config.stream ?? false;
        this.streamCallback = config.streamCallback;
        this.eventBus = new EventBus();

        // 设置工具事件回调，转发到事件总线
        this.toolRegistry.setEventCallbacks({
            onToolStart: (toolName, args) => {
                this.eventBus.emit(EventType.TOOL_START, {
                    timestamp: Date.now(),
                    toolName,
                    arguments: args,
                });
            },
            onToolSuccess: (toolName, duration, resultLength) => {
                this.eventBus.emit(EventType.TOOL_SUCCESS, {
                    timestamp: Date.now(),
                    toolName,
                    duration,
                    resultLength,
                });
            },
            onToolFailed: (toolName, error) => {
                this.eventBus.emit(EventType.TOOL_FAILED, {
                    timestamp: Date.now(),
                    toolName,
                    error,
                });
            },
        });
    }

    /**
     * 执行 Agent 查询
     * @param query 用户输入的查询内容
     * @returns 最后一条消息
     */
    async execute(query: string) {
        if (this.status !== AgentStatus.IDLE) {
            throw new Error(`Agent is not idle, current status: ${this.status}`);
        }

        // 初始化任务状态
        this.taskStartTime = Date.now();
        this.loopCount = 0;
        this.retryCount = 0;
        this.taskId = `task-${this.taskStartTime}`;
        this.currentQuery = query;

        

   
          this.session.addMessage({
            role: 'user',
            content: query,
            type: 'text',
            messageId: uuid(),
          });

        try {
            await this.loop();

            // 任务成功
            this.status = AgentStatus.COMPLETED;
            this.eventBus.emit(EventType.TASK_SUCCESS, {
                timestamp: Date.now(),
                totalLoops: this.loopCount,
                totalRetries: this.retryCount,
                duration: Date.now() - this.taskStartTime,
            });

            

            return this.session.getLastMessage();
        } catch (error) {
            // 任务失败
            this.status = AgentStatus.FAILED;
            const errorMessage = (error as Error).message;
            this.eventBus.emit(EventType.TASK_FAILED, {
                timestamp: Date.now(),
                error: errorMessage,
                totalLoops: this.loopCount,
                totalRetries: this.retryCount,
            });

        

            throw error;
        }
    }

 
    /**
     * 注册事件监听器
     * @param type 事件类型
     * @param listener 监听器函数
     */
    on(type: EventType, listener: (data: any) => void): void {
        this.eventBus.on(type as any, listener);
    }

    /**
     * 取消事件监听器
     * @param type 事件类型
     * @param listener 监听器函数
     */
    off(type: EventType, listener: (data: any) => void): void {
        this.eventBus.off(type as any, listener);
    }

  





    /** 处理流式输出数据块 */
    private handleStreamChunk(chunk: Chunk,messageId:string) {
        if (!this.stream) return;

        const delta = chunk.choices?.[0].delta;
        const finishReason = chunk.choices?.[0].finish_reason;
        const id = chunk.id;

        if (!delta) return;

        // 处理文本内容
        const content = delta.content || '';

        if (content) {
            this.streamBuffer += content;
         
            this.streamCallback?.({
                type: AgentMessageType.TEXT,
                payload: {
                    content,
                },
                msgId: messageId,
                sessionId: this.session.getSessionId(),
                timestamp: Date.now(),
            });
            // 实时更新 session 中的消息
            const lastMessage: Message = this.session.getLastMessage();
           
            if (lastMessage.messageId === messageId) {
                // 更新最后一条消息的内容
                lastMessage.content = this.streamBuffer;
                messageId=this.session.addMessage({
                    ...lastMessage,
                    content: this.streamBuffer,
                    id,
                    finish_reason: finishReason || (lastMessage.finishReason as FinishReason),
                    type: 'text',
                });
            } else {
                // 创建新的流式消息
                messageId=this.session.addMessage({
                    role: 'assistant',
                    content: this.streamBuffer,
                    messageId,
                    finish_reason: finishReason,
                    type: 'text',
                });
            }

        }

        // 处理工具调用流式数据
        const toolCalls = delta.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
            // 实时更新 session 中的消息
            for (const toolCall of toolCalls) {
                const index = toolCall.index;
                if (!this.streamToolCalls.has(index)) {
                    // 初始化工具调用
                    this.streamToolCalls.set(index, {
                        id: toolCall.id,
                        type: toolCall.type,
                        index,
                        function: {
                            name: toolCall.function?.name || '',
                            arguments: toolCall.function?.arguments || '',
                        },
                    });
                } else {
                    // 累积工具调用数据
                    const existing = this.streamToolCalls.get(index)!;
                    if (toolCall.function?.name) {
                        existing.function.name = toolCall.function.name;
                    }
                    if (toolCall.function?.arguments) {
                        existing.function.arguments += toolCall.function.arguments;
                    }
                }
            }

            const lastMessage = this.session.getLastMessage();
           const streamToolCalls= Array.from(this.streamToolCalls.values()) 
  
            if (lastMessage.messageId ! == messageId) {
               this.session.addMessage({
                    role: 'assistant',
                    content: '',
                    messageId,
                    tool_calls:streamToolCalls,
                    type: 'tool-call',
                    id,
                    finish_reason: finishReason,
                });
            } else {
             this.session.addMessage({
                    ...lastMessage,
                    tool_calls: streamToolCalls,
                    messageId,
                    finish_reason: finishReason || (lastMessage.finishReason as FinishReason),
                    type: 'tool-call',
                });
            }

            this.streamCallback?.({
                type: AgentMessageType.TOOL_CALL_CREATED,
                payload: {
                    tool_calls: Array.from(this.streamToolCalls.values()).map((item) => ({
                        callId: item.id ,
                        toolName: item.function.name,
                        args: item.function.arguments,
                    })),
                },
                msgId: messageId,
                sessionId: this.session.getSessionId(),
                timestamp: Date.now(),
            });
        
        }

        // 存储最后一个 chunk 的元数据（用于构建 LLMResponse）
        if (chunk.id) this.streamLastChunk.id = chunk.id;
        if (chunk.model) this.streamLastChunk.model = chunk.model;
        if (chunk.created) this.streamLastChunk.created = chunk.created;
        if (finishReason) this.streamLastChunk.finish_reason = finishReason;
       
        // 当收到 finish_reason 时，确保它被设置到最后一条 session 消息
        // 这处理了最后一个 chunk 只有 finish_reason 而没有 content 或 tool_calls 的情况
        if (finishReason) {
            const lastMessage = this.session.getLastMessage();
            if (lastMessage && lastMessage.messageId === messageId) {
                this.session.addMessage({
                    ...lastMessage,
                    messageId,
                    finish_reason: finishReason,
                });
            }
        }
    }

    /**
     * Agent 主循环：持续调用 LLM 直到完成或失败
     */
    async loop() {
        let retries = 0;

        while (true) {
          
            try {
                // 检查重试次数
                if (retries > this.maxRetries) {
                    this.status = AgentStatus.FAILED;
                    break;
                }

                // 检查是否已完成
                if (this.checkComplete()) {
                    this.status = AgentStatus.COMPLETED;
                    break;
                }

                this.loopCount++;
                this.status = AgentStatus.RUNNING;
                this.abortController = new AbortController();
                // 重置流式缓冲区
                this.streamBuffer = '';
                this.streamToolCalls.clear();
                this.streamLastChunk = {};

                
                const messageId=uuid();
                // 创建超时信号
                const timeoutSignal = AbortSignal.any([
                    this.abortController.signal,
                    AbortSignal.timeout(this.provider.getTimeTimeout()),
                ]);

                const messages = this.session.getMessages();

                const llmOptions: LLMGenerateOptions = {
                    tools: this.toolRegistry.toLLMTools(),
                    signal: timeoutSignal,
                };

                let response: LLMResponse | null = null;

            

                if (this.stream) {
                //   this.streamCallback?.({
                //     type: AgentMessageType.STATUS,
                //         payload: {
                //             state: 'thinking',
                //             message: 'Agent is thinking...',
                //         },
                //         msgId: messageId,
                //         sessionId: this.session.getSessionId(),
                //         timestamp: Date.now(),
                //    });
                    llmOptions.stream = true;
                    const streamResult = await this.provider.generate(messages, llmOptions);
                    const streamGenerator = streamResult as unknown as AsyncGenerator<Chunk>;
                    for await (const chunk of streamGenerator) {
                        this.handleStreamChunk(chunk,messageId);
                    }
                    // 从累积的数据构建 LLMResponse
                    response = this.buildStreamResponse();
                } else {
                    response = await this.provider.generate(messages, llmOptions) as LLMResponse | null;
                }

                if (!response) {
                    throw new AgentError('LLM returned no response');
                }

                await this.handleResponse(response,messageId);

                // 成功执行一次，重置重试计数
                retries = 0;
            } catch (error) {
                console.log(error);
                // 工具错误：记录并重试
                if (error instanceof ToolError) {
                    retries++;
                    this.retryCount = retries;

                    // 发送重试事件（EventBus）
                    this.eventBus.emit(EventType.TASK_RETRY, {
                        timestamp: Date.now(),
                        retryCount: retries,
                        maxRetries: this.maxRetries,
                        reason: (error as Error).message,
                    });


                    continue;
                }

                // Agent 错误：直接抛出
                if (error instanceof AgentError) {
                    throw error;
                }

                // 其他异常：LLM 调用失败等
                const errorMessage = (error as Error).message;
                this.session.addMessage({
                    role: 'assistant',
                    messageId:uuid(),
                    content: `Execution failed: ${errorMessage}`,
                    type: 'text',
                });
                retries++;
                this.status = AgentStatus.FAILED;
            } finally {
                this.abortController?.abort();
                this.abortController = null;
            }
        }
    }

    /**
     * 从流式累积的数据构建 LLMResponse
     */
    private buildStreamResponse(): LLMResponse {
        const toolCalls = Array.from(this.streamToolCalls.values());
        const finishReason = this.streamLastChunk.finish_reason;

        return {
            id: this.streamLastChunk.id || '',
            object: 'chat.completion',
            created: this.streamLastChunk.created || Date.now(),
            model: this.streamLastChunk.model || '',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: this.streamBuffer,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    },
                    finish_reason: finishReason || undefined,
                },
            ],
        };
    }

    async handleResponse(response: LLMResponse,messageId:string) {
        const choice = response.choices?.[0];

        if (!choice) {
            throw new AgentError('LLM response missing choices');
        }

        const finishReason = choice.finish_reason;
        const toolCalls = choice.message?.tool_calls;

        // 处理工具调用
        if (toolCalls && toolCalls.length > 0) {
            if (!this.stream) {
                // 非流式模式：创建新的工具调用消息
                this.session.addMessage({
                    role: 'assistant',
                    content: choice.message?.content || '',
                    tool_calls: toolCalls,
                    messageId,
                    finish_reason: finishReason,
                    type: 'tool-call',
                });
            }

            try {
                const results = await this.toolRegistry.execute(toolCalls);
                results.forEach(result => {

                    this.streamCallback?.({
                        type: AgentMessageType.TOOL_CALL_RESULT,
                        payload: {
                            callId: result.tool_call_id,
                            result: JSON.stringify(result.result) || '',
                            status: result.result?.success? 'success' : 'error',
                        },
                        msgId: messageId,
                        sessionId: this.session.getSessionId(),
                        timestamp: Date.now(),
                    });
                    
                    this.session.addMessage({
                        role: 'tool',
                        tool_call_id: result.tool_call_id,
                        content: JSON.stringify(result.result) || '',
                        messageId:uuid(),
                        type: 'tool-result',
                    });

                });

            
            } catch (error) {
                const errorMessage = (error as Error).message;

                // 工具执行失败，将错误信息反馈给 LLM 重试
                this.session.addMessage({
                    role: 'assistant',
                    messageId,
                    content: `Tool execution error: ${errorMessage}`,
                    type: 'text',
                });

                throw new ToolError(errorMessage || 'Tool execution error');
            }
        } else {
            // 文本响应
            if (!this.stream) {
                // 非流式模式：添加完整消息
                this.session.addMessage({
                    ...choice.message,
                    messageId,
                    finish_reason: finishReason,
                    type: 'text',
                });
            }
            // 流式模式的消息已经在 handleStreamChunk 中处理
        }
    }

    /**
     * 检查 Agent 是否已完成
     * 完成条件：
     * 1. 最后一条消息是文本类型
     * 2. 有 finish_reason（LLM 正常结束）或 content 为空（异常情况）
     */
    private checkComplete(): boolean {
        const lastMessage = this.session.getLastMessage();
          console.log(lastMessage);
       
        if (!lastMessage) {
            return false;
        }

        // LLM 正常结束
        const hasFinishReason = lastMessage.type === 'text' && lastMessage.finish_reason;
        // 空响应（异常情况下的终止）
        const isEmptyText = lastMessage.type === 'text' && !lastMessage.content;

        return !!(hasFinishReason || isEmptyText);
    }

    /**
     * 获取当前会话的所有消息
     */
    getMessages() {
        return this.session.getMessages();
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
    }
}