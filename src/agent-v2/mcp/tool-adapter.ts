/**
 * MCP 工具适配器
 *
 * 将 MCP 服务器的工具适配为本地 BaseTool 接口
 */

import { z } from 'zod';
import { BaseTool, ToolResult, ToolContext } from '../tool/base';
import { McpClient } from './client';
import type { McpTool, McpToolMetadata, ToolContent } from './types';
import { jsonSchemaToZod } from './json-schema-to-zod';
import { getLogger } from '../logger';

/**
 * MCP 工具适配器
 *
 * 将 MCP 工具包装为 BaseTool，使其可以在 Agent 中使用
 */
export class McpToolAdapter extends BaseTool<z.ZodType> {
    /** MCP 客户端 */
    private readonly client: McpClient;

    /** 原始工具定义 */
    private readonly toolDefinition: McpTool;

    /** 服务器名称 */
    private readonly serverName: string;

    /** 清理后的工具名称（用于注册） */
    private readonly sanitizedName: string;

    /** 元数据 */
    private readonly mcpMetadata: McpToolMetadata;

    /** 日志器 */
    private readonly logger = getLogger();

    /** 声明 schema 类型 */
    declare schema: z.ZodType;

    constructor(client: McpClient, toolDefinition: McpTool, serverName: string) {
        super();
        this.client = client;
        this.toolDefinition = toolDefinition;
        this.serverName = serverName;

        // 清理工具名称
        this.sanitizedName = this.sanitizeName(toolDefinition.name);

        // 转换 schema
        this.schema = jsonSchemaToZod(toolDefinition.inputSchema || {});

        // 设置元数据
        this.mcpMetadata = {
            originalName: toolDefinition.name,
            serverName,
            serverConfig: client.config,
        };
    }

    /**
     * 工具名称（带命名空间前缀）
     */
    get name(): string {
        return this.sanitizedName;
    }

    /**
     * 工具描述（添加服务器标识）
     */
    get description(): string {
        const originalDesc = this.toolDefinition.description || 'MCP tool';
        return `[MCP:${this.serverName}] ${originalDesc}`;
    }

    /**
     * 执行工具
     */
    async execute(args?: z.infer<z.ZodType>, _context?: ToolContext): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            this.logger.debug('[MCP] Executing tool', {
                server: this.serverName,
                tool: this.toolDefinition.name,
            });

            // 调用 MCP 工具
            const response = await this.client.callTool({
                name: this.toolDefinition.name,
                arguments: args as Record<string, unknown> | undefined,
            });

            // 格式化响应
            const result = this.formatToolResponse(response);

            this.logger.debug('[MCP] Tool execution completed', {
                server: this.serverName,
                tool: this.toolDefinition.name,
                duration: Date.now() - startTime,
                success: result.success,
            });

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.logger.error('[MCP] Tool execution failed', error as Error, {
                server: this.serverName,
                tool: this.toolDefinition.name,
                duration: Date.now() - startTime,
            });

            return {
                success: false,
                error: `MCP tool execution error: ${errorMessage}`,
                metadata: this.mcpMetadata,
            };
        }
    }

    // ==================== 私有方法 ====================

    /**
     * 格式化工具响应
     */
    private formatToolResponse(response: { content: ToolContent[]; isError?: boolean }): ToolResult {
        // 提取文本内容
        const textContent = this.extractTextContent(response.content);

        if (response.isError) {
            return {
                success: false,
                error: textContent || 'MCP tool returned an error',
                metadata: this.mcpMetadata,
            };
        }

        return {
            success: true,
            output: textContent,
            metadata: this.mcpMetadata,
        };
    }

    /**
     * 提取文本内容
     */
    private extractTextContent(content: ToolContent[]): string {
        const textParts: string[] = [];

        for (const item of content) {
            if (item.type === 'text') {
                textParts.push(item.text);
            } else if (item.type === 'resource' && item.resource.text) {
                textParts.push(item.resource.text);
            }
        }

        return textParts.join('\n');
    }

    /**
     * 清理工具名称
     *
     * - 移除不安全字符
     * - 添加服务器名称前缀（避免冲突）
     */
    private sanitizeName(name: string): string {
        // 移除不安全字符（只保留字母、数字、下划线、连字符）
        const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        // 清理服务器名称
        const serverPrefix = this.serverName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        // 组合名称：server_tool
        return `${serverPrefix}_${cleaned}`;
    }
}

/**
 * 创建工具适配器列表
 *
 * @param client MCP 客户端
 * @param tools 工具列表
 * @param serverName 服务器名称
 * @returns 工具适配器数组
 */
export function createToolAdapters(client: McpClient, tools: McpTool[], serverName: string): McpToolAdapter[] {
    return tools.map((tool) => new McpToolAdapter(client, tool, serverName));
}
