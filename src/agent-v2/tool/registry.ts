import { BaseTool, ToolResult, ToolContext } from './base';
import { z } from 'zod';
import { ToolSchema } from './type';
import { ToolCall } from '../../providers';
import { safeParse } from '../util';
import type { TruncationMiddleware, TruncationContext } from '../truncation';

/** 默认工具执行超时时间（毫秒） */
const DEFAULT_TOOL_TIMEOUT = 300000; // 5分钟

interface ExecutionContext {
    sessionId?: string;
    memoryManager?: ToolContext['memoryManager'];
    streamCallback?: ToolContext['streamCallback'];
    onToolStream?: (toolCallId: string, toolName: string, output: string) => void;
}

/**
 * 工具调用校验错误（来自 LLM 返回的 tool_calls 结构非法）
 */
export class ToolCallValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolCallValidationError';
    }
}

/**
 * 工具注册表配置
 */
export interface ToolRegistryConfig {
    /** 工作目录 */
    workingDirectory: string;
    /** 单个工具执行超时时间（毫秒，默认 300000） */
    toolTimeout?: number;
}

/**
 * 工具事件回调
 */
export interface ToolEventCallbacks {
    /** 工具执行开始 */
    onToolStart?: (toolName: string, args: string) => void;
    /** 工具执行成功 */
    onToolSuccess?: (toolName: string, duration: number, result: ToolResult) => void;
    /** 工具执行失败 */
    onToolFailed?: (toolName: string, result: unknown) => void;
}

/**
 * ToolRegistry - 工具注册与管理
 *
 * 提供工具注册、执行、缓存和权限控制等功能
 */
export class ToolRegistry {
    workingDirectory: string;
    private tools: Map<string, BaseTool<z.ZodType>> = new Map();
    private toolTimeout: number;
    private eventCallbacks?: ToolEventCallbacks;
    private truncationMiddleware?: TruncationMiddleware;

    constructor(config: ToolRegistryConfig) {
        this.workingDirectory = config.workingDirectory;
        this.toolTimeout = config.toolTimeout ?? DEFAULT_TOOL_TIMEOUT;
    }

    private buildToolContext(ctx?: ExecutionContext): ToolContext {
        return {
            environment: process.env.NODE_ENV || 'development',
            platform: process.platform,
            time: new Date().toISOString(),
            workingDirectory: this.workingDirectory,
            sessionId: ctx?.sessionId,
            memoryManager: ctx?.memoryManager,
            streamCallback: ctx?.streamCallback,
        };
    }

    /**
     * 设置事件回调
     */
    setEventCallbacks(callbacks: ToolEventCallbacks): void {
        this.eventCallbacks = {
            ...this.eventCallbacks,
            ...callbacks,
        };
    }

    /**
     * 设置截断中间件
     *
     * @param middleware 截断中间件函数
     */
    setTruncationMiddleware(middleware: TruncationMiddleware): void {
        this.truncationMiddleware = middleware;
    }

    /**
     * 带超时控制的工具执行
     * 使用 setTimeout/clearTimeout 确保超时定时器被正确清理，防止内存泄漏
     */
    private async executeWithTimeout<T>(toolName: string, executeFn: () => Promise<T>, timeoutMs: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Tool "${toolName}" execution timeout (${timeoutMs}ms)`));
            }, timeoutMs);

            executeFn()
                .then((result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    register(tools: BaseTool<z.ZodType>[]): void {
        tools.forEach((tool) => {
            if (this.tools.has(tool.name)) {
                throw new Error(`Tool "${tool.name}" is already registered`);
            }

            // 验证工具定义
            this.validateTool(tool);

            this.tools.set(tool.name, tool);
        });
    }

    /**
     * 验证 tool_calls 的基础结构
     */
    validateToolCalls(toolCalls: ToolCall[]): void {
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
            throw new ToolCallValidationError('LLM response contains empty tool_calls');
        }

        for (let i = 0; i < toolCalls.length; i += 1) {
            const toolCall = toolCalls[i] as ToolCall | undefined;
            if (!toolCall || typeof toolCall !== 'object') {
                throw new ToolCallValidationError(`LLM response tool_calls[${i}] is invalid`);
            }

            if (typeof toolCall.id !== 'string' || toolCall.id.trim() === '') {
                throw new ToolCallValidationError(`LLM response tool_calls[${i}].id is missing`);
            }

            if (toolCall.type !== 'function') {
                throw new ToolCallValidationError(`LLM response tool_calls[${i}].type must be "function"`);
            }

            if (!toolCall.function || typeof toolCall.function !== 'object') {
                throw new ToolCallValidationError(`LLM response tool_calls[${i}].function is missing`);
            }

            if (typeof toolCall.function.name !== 'string' || toolCall.function.name.trim() === '') {
                throw new ToolCallValidationError(`LLM response tool_calls[${i}].function.name is missing`);
            }

            if (typeof toolCall.function.arguments !== 'string') {
                throw new ToolCallValidationError(`LLM response tool_calls[${i}].function.arguments is invalid`);
            }
        }
    }

    /**
     * 执行工具
     */
    async execute(
        toolCalls: ToolCall[],
        context?: ExecutionContext
    ): Promise<{ tool_call_id: string; name: string; arguments: string; result: ToolResult }[]> {
        const toolContext = this.buildToolContext(context);

        const results = await Promise.all(
            toolCalls.map(async (toolCall) => {
                const { name, arguments: paramsStr } = toolCall.function;
                const tool = this.tools.get(name);

                if (!tool) {
                    const error = `Tool "${name}" not found`;
                    this.eventCallbacks?.onToolFailed?.(name, error);
                    return {
                        tool_call_id: toolCall.id,
                        name,
                        arguments: paramsStr,
                        result: {
                            success: false,
                            error,
                        },
                    };
                }

                const params = safeParse(paramsStr || '');

                if (!params) {
                    const error = `Invalid arguments format: ${paramsStr}`;
                    this.eventCallbacks?.onToolFailed?.(name, error);
                    return {
                        tool_call_id: toolCall.id,
                        name,
                        arguments: paramsStr,
                        result: {
                            success: false,
                            error,
                        },
                    };
                }
                // 验证参数
                const schema = tool.schema;

                const resultSchema = schema.safeParse(params);

                if (!resultSchema.success) {
                    const error = resultSchema.error.issues.map((issue) => issue.message).join(', ');
                    this.eventCallbacks?.onToolFailed?.(name, error);
                    return {
                        tool_call_id: toolCall.id,
                        name,
                        arguments: paramsStr,
                        result: {
                            success: false,
                            error,
                        },
                    };
                }

                // 执行工具（task 工具可通过 executionTimeoutMs=null 显式关闭超时）
                const startTime = Date.now();
                this.eventCallbacks?.onToolStart?.(name, paramsStr || '');

                try {
                    const timeoutMs =
                        tool.executionTimeoutMs === undefined ? this.toolTimeout : tool.executionTimeoutMs;

                    const result =
                        timeoutMs === null || timeoutMs <= 0
                            ? await Promise.resolve(
                                  tool.execute(resultSchema.data, {
                                      ...toolContext,
                                      emitOutput: (chunk: string) => context?.onToolStream?.(toolCall.id, name, chunk),
                                  })
                              )
                            : await this.executeWithTimeout(
                                  name,
                                  () =>
                                      Promise.resolve(
                                          tool.execute(resultSchema.data, {
                                              ...toolContext,
                                              emitOutput: (chunk: string) =>
                                                  context?.onToolStream?.(toolCall.id, name, chunk),
                                          })
                                      ),
                                  timeoutMs
                              );

                    const duration = Date.now() - startTime;

                    // 应用截断中间件
                    if (this.truncationMiddleware && result.output) {
                        const truncationContext: TruncationContext = {
                            toolName: name,
                            sessionId: context?.sessionId,
                        };
                        try {
                            const truncatedResult = await this.truncationMiddleware(name, result, truncationContext);
                            result.output = truncatedResult.output;
                            result.metadata = truncatedResult.metadata;
                        } catch (truncationError) {
                            // 截断失败不影响工具执行结果，仅记录日志
                            console.error('[Truncation] Middleware error:', truncationError);
                        }
                    }

                    if ((result as ToolResult).success === true) {
                        this.eventCallbacks?.onToolSuccess?.(name, duration, result);
                    } else {
                        this.eventCallbacks?.onToolFailed?.(name, result);
                    }

                    return {
                        tool_call_id: toolCall.id,
                        name,
                        arguments: paramsStr,
                        result,
                    };
                } catch (error) {
                    const err = error as Error;
                    const errorMessage = err.message || `${name} Tool execution failed: ${err}`;
                    this.eventCallbacks?.onToolFailed?.(name, errorMessage);

                    return {
                        tool_call_id: toolCall.id,
                        name,
                        arguments: paramsStr,
                        result: {
                            success: false,
                            error: errorMessage,
                        },
                    };
                }
            })
        );

        return results;
    }

    /**
     * 转换为 LLM 工具格式
     */
    toLLMTools(): Array<ToolSchema> {
        return Array.from(this.tools.values()).map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: z.toJSONSchema(tool.schema),
            },
        }));
    }

    /**
     * 验证工具定义
     */
    private validateTool(tool: BaseTool<z.ZodType>): void {
        if (!tool.name || typeof tool.name !== 'string') {
            throw new Error('Tool name is required and must be a string');
        }

        if (!tool.description || typeof tool.description !== 'string') {
            throw new Error('Tool description is required and must be a string');
        }

        if (!tool.schema || typeof tool.schema !== 'object') {
            throw new Error('Tool parameters are required and must be an object');
        }

        if (typeof tool.execute !== 'function') {
            throw new Error('Tool execute must be a function');
        }

        // 验证 JSON Schema
        if (tool.schema.type === 'function') {
            throw new Error('Tool parameters must be of type function');
        }
    }
}
