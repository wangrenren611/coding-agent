import { ExecutionContext } from "../agent/types";
import { ToolResult } from "./base";
import { ToolDefinition } from "./type";

/**
 * 工具注册表配置
 */
export interface ToolRegistryConfig {
    /** 工作目录 */
    workingDirectory: string;
}

/**
 * ToolRegistry - 工具注册与管理
 *
 * 提供工具注册、执行、缓存和权限控制等功能
 */
export class ToolRegistry {
    workingDirectory: string;
    private tools: Map<string, ToolDefinition> = new Map();

    constructor(config: ToolRegistryConfig) {
        this.workingDirectory = config.workingDirectory;
         
    }

    register(tool: ToolDefinition): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered`);
        }

        // 验证工具定义
        this.validateTool(tool);

        this.tools.set(tool.name, tool);
    }

    /**
     * 执行工具
     */
    async execute(
        name: string,
        params: unknown,
        context: ExecutionContext
    ): Promise<ToolResult> {

        const tool = this.tools.get(name);

        if (!tool) {
            return {
                success: false,
                error: `Tool "${name}" not found`,  
            };
        }

        // 执行工具
        try {
          const result = await tool.execute(params, context);

           return {
                success: true,
                metadata: result,
                output: result.output,
            };
            
        } catch (error) {
            
          const err = error as Error;

            return {
                success: false,
                error: err.message || `${name} Tool execution failed: ${err}`,
            };
        }
    }

  /**
     * 转换为 LLM 工具格式
     */
    toLLMTools(): Array<{
        type: string;
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }> {
        return Array.from(this.tools.values()).map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));
    } 

    /**
     * 验证工具定义
     */
    private validateTool(tool: ToolDefinition): void {
        if (!tool.name || typeof tool.name !== 'string') {
            throw new Error('Tool name is required and must be a string');
        }

        if (!tool.description || typeof tool.description !== 'string') {
            throw new Error('Tool description is required and must be a string');
        }

        if (!tool.parameters || typeof tool.parameters !== 'object') {
            throw new Error('Tool parameters are required and must be an object');
        }

        if (typeof tool.execute !== 'function') {
            throw new Error('Tool execute must be a function');
        }

        // 验证 JSON Schema
        if (tool.parameters.type !== 'object') {
            throw new Error('Tool parameters must be of type object');
        }
    }
}
