import { BaseTool, ToolResult, ToolContext } from "./base";
import { z } from 'zod';
import { ToolSchema } from "./type";
import { ToolCall } from "../../providers";
import { safeParse } from "../util";

/** 默认工具执行超时时间（毫秒） */
const DEFAULT_TOOL_TIMEOUT = 300000; // 5分钟

interface ExecutionContext {
    sessionId?: string;
    memoryManager?: ToolContext['memoryManager'];
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
    onToolSuccess?: (toolName: string, duration: number, result: any) => void;
    /** 工具执行失败 */
    onToolFailed?: (toolName: string, result: any) => void;
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

    constructor(config: ToolRegistryConfig) {
        this.workingDirectory = config.workingDirectory;
        this.toolTimeout = config.toolTimeout ?? DEFAULT_TOOL_TIMEOUT;
    }

    private buildToolContext(ctx?: ExecutionContext): ToolContext {
        return {
            environment: this.workingDirectory,
            platform: process.platform,
            time: new Date().toISOString(),
            sessionId: ctx?.sessionId,
            memoryManager: ctx?.memoryManager,
        };
    }

    /**
     * 设置事件回调
     */
    setEventCallbacks(callbacks: ToolEventCallbacks): void {
        this.eventCallbacks = callbacks;
    }

    register(tools: BaseTool<z.ZodType>[]): void {
        tools.forEach(tool => {
            if (this.tools.has(tool.name)) {
                throw new Error(`Tool "${tool.name}" is already registered`);
            }

            // 验证工具定义
            this.validateTool(tool);

            this.tools.set(tool.name, tool);
        });
    }

    /**
     * 执行工具
     */
    async execute(
      toolCalls: ToolCall[],
      context?: ExecutionContext,
    ): Promise<{tool_call_id: string, name: string, arguments: string, result: any}[]> {
      const toolContext = this.buildToolContext(context);

      const results = await Promise.all(toolCalls.map(async toolCall => {
          const { name, arguments: paramsStr } = toolCall.function;
          const tool = this.tools.get(name);

          if (!tool) {
            const error = `Tool "${name}" not found`;
            this.eventCallbacks?.onToolFailed?.(name, error);
            return {
                tool_call_id: toolCall.id,
                name,
                arguments:paramsStr,
                result:{
                    success: false,
                    error,
                }
            };
        }

       const params = safeParse(paramsStr || '');

        if(!params){
            const error = `Invalid arguments format: ${paramsStr}`;
            this.eventCallbacks?.onToolFailed?.(name, error);
            return {
               tool_call_id: toolCall.id,
                name,
                arguments:paramsStr,
                result:{
                    success: false,
                    error,
                }
            };
        }
           // 验证参数
        const schema = tool.schema;

        const resultSchema: any= schema.safeParse(params);

        if (!resultSchema.success) {
            const error = resultSchema.error.issues.map((issue: any)  => issue.message).join(', ');
            this.eventCallbacks?.onToolFailed?.(name, error);
            return {
                tool_call_id: toolCall.id,
                name,
                arguments:paramsStr,
                result:{
                    success: false,
                    error,
                }
            };
        }

          // 执行工具（带超时控制）
        const startTime = Date.now();
        this.eventCallbacks?.onToolStart?.(name, paramsStr || '');
        
        try {
          const timeoutMs = tool.executionTimeoutMs === undefined
            ? this.toolTimeout
            : tool.executionTimeoutMs;
          const result = timeoutMs === null || timeoutMs <= 0
            ? await tool.execute(resultSchema.data, toolContext)
            : await Promise.race([
                tool.execute(resultSchema.data, toolContext),
                new Promise((_, reject) => {
                    const timeoutSignal = AbortSignal.timeout(timeoutMs);
                    timeoutSignal.addEventListener('abort', () => {
                        reject(new Error(`Tool "${name}" execution timeout (${timeoutMs}ms)`));
                    });
                }),
              ]);

           

          const duration = Date.now() - startTime;
        

          if((result as ToolResult).success === true){
            this.eventCallbacks?.onToolSuccess?.(name, duration , result);
          }else{
             this.eventCallbacks?.onToolFailed?.(name, result);
          }
         
           return {
                tool_call_id: toolCall.id,
                name,
                arguments:paramsStr,
                result,
            };

        } catch (error) {
          const err = error as Error;
          const errorMessage = err.message || `${name} Tool execution failed: ${err}`;
          this.eventCallbacks?.onToolFailed?.(name, errorMessage);

            return {
                tool_call_id: toolCall.id,
                name,
                arguments:paramsStr,
                result:{
                    success: false,
                    error: errorMessage,
                }
            };
        }
      }))


      return results as {tool_call_id: string, name: string, arguments: string, result: any}[];
    }
 


  /**
     * 转换为 LLM 工具格式
     */
    toLLMTools(): Array<ToolSchema> {
        return Array.from(this.tools.values()).map(tool =>({
            type: 'function',
            function:{
                name: tool.name,
                description: tool.description,
                parameters: z.toJSONSchema(tool.schema),
            },
        }));
    } 

    /**
     * 验证工具定义
     */
    private validateTool(tool:  BaseTool<z.ZodType>): void {
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
