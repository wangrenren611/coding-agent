/**
 * Tool Executor - 工具执行器
 *
 * 负责安全地执行工具调用，包含超时控制、结果验证等功能
 */

import type {
    ToolDefinition,
    ToolResult,
    ExecutionContext,
} from '../types';

/**
 * 工具执行器配置
 */
export interface ToolExecutorConfig {
    /** 工作目录 */
    workingDirectory: string;
    /** 默认超时时间（毫秒） */
    defaultTimeout?: number;
}

/**
 * ToolExecutor - 安全执行工具调用
 */
export class ToolExecutor {
    private config: ToolExecutorConfig;

    constructor(config: ToolExecutorConfig) {
        this.config = {
            defaultTimeout: 30000, // 30 seconds
            ...config,
        };
    }

    /**
     * 执行工具
     */
    async execute(
        tool: ToolDefinition,
        params: unknown,
        context: ExecutionContext
    ): Promise<ToolResult> {
        const timeout = this.config.defaultTimeout!;

        try {
            // 参数验证
            const validatedParams = this.validateParameters(tool, params);

            // 执行工具（带超时控制）
            const result = await this.withTimeout(
                tool.execute(validatedParams, context),
                timeout
            );

            // 结果验证
            return this.validateResult(result);
        } catch (error) {
            return this.handleError(error as Error, tool);
        }
    }

    /**
     * 验证参数
     */
    private validateParameters(tool: ToolDefinition, params: unknown): unknown {
        if (params === null || params === undefined) {
            // 检查是否有必需参数
            const required = tool.parameters.required || [];
            if (required.length > 0) {
                throw new Error(
                    `Missing required parameters: ${required.join(', ')}`
                );
            }
            return {};
        }

        if (typeof params !== 'object') {
            throw new Error('Parameters must be an object');
        }

        const paramsObj = params as Record<string, unknown>;

        // 检查必需参数
        const required = tool.parameters.required || [];
        for (const key of required) {
            if (!(key in paramsObj)) {
                throw new Error(`Missing required parameter: ${key}`);
            }
        }

        // 检查参数类型
        const properties = tool.parameters.properties || {};
        for (const [key, schema] of Object.entries(properties)) {
            if (key in paramsObj) {
                const value = paramsObj[key];
                const schemaType = (schema as { type?: string }).type;

                if (schemaType && !this.validateType(value, schemaType)) {
                    throw new Error(
                        `Parameter "${key}" must be of type ${schemaType}`
                    );
                }
            }
        }

        return params;
    }

    /**
     * 验证类型
     */
    private validateType(value: unknown, type: string): boolean {
        switch (type) {
            case 'string':
                return typeof value === 'string';
            case 'number':
                return typeof value === 'number';
            case 'boolean':
                return typeof value === 'boolean';
            case 'array':
                return Array.isArray(value);
            case 'object':
                return typeof value === 'object' && value !== null;
            default:
                return true;
        }
    }

    /**
     * 验证结果
     */
    private validateResult(result: unknown): ToolResult {
        // 如果返回的是 ToolResult 格式，直接返回
        if (
            result !== null &&
            typeof result === 'object' &&
            'success' in result
        ) {
            return result as ToolResult;
        }

        // 否则包装为成功结果
        return {
            success: true,
            data: result,
        };
    }

    /**
     * 处理错误
     */
    private handleError(error: Error, tool: ToolDefinition): ToolResult {
        // 检查是否是超时错误
        if (error.name === 'TimeoutError') {
            return {
                success: false,
                error: `Tool "${tool.name}" execution timeout`,
                retryable: true,
            };
        }

        // 检查是否是取消错误
        if (error.name === 'AbortError') {
            return {
                success: false,
                error: `Tool "${tool.name}" execution cancelled`,
            };
        }

        // 其他错误
        return {
            success: false,
            error: error.message,
            retryable: this.isRetryableError(error),
        };
    }

    /**
     * 判断错误是否可重试
     */
    private isRetryableError(error: Error): boolean {
        const retryablePatterns = [
            /timeout/i,
            /network/i,
            /connection/i,
            /ECONNRESET/i,
            /ETIMEDOUT/i,
            /temporarily/i,
            /rate limit/i,
        ];

        return retryablePatterns.some(pattern =>
            pattern.test(error.message)
        );
    }

    /**
     * 带超时的执行
     */
    private async withTimeout<T>(
        promise: Promise<T>,
        timeout: number
    ): Promise<T> {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                const error = new Error('Operation timeout') as Error & {
                    name: string;
                };
                error.name = 'TimeoutError';
                reject(error);
            }, timeout);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }
}
