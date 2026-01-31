/**
 * Tool Registry - 工具注册表
 *
 * 管理所有可用工具的注册、发现、执行和权限控制
 */

import { EventEmitter } from 'events';
import type {
    ToolDefinition,
    ToolResult,
    PermissionLevel,
    ToolCallRecord,
    ConfirmationRequest,
    ConfirmationResponse,
    ExecutionContext,
} from '../types';
import { ToolCategory } from '../types';
import { ToolExecutor } from './executor';
import { ToolCache } from './cache';
import { v4 as uuidv4 } from 'uuid';

/**
 * 工具注册表配置
 */
export interface ToolRegistryConfig {
    /** 确认回调 */
    onConfirmation?: (request: ConfirmationRequest) => Promise<ConfirmationResponse>;
    /** 工作目录 */
    workingDirectory: string;
    /** 是否启用缓存 */
    enableCache?: boolean;
    /** 缓存大小限制 */
    cacheSize?: number;
}

/**
 * ToolRegistry - 工具注册与管理
 *
 * 提供工具注册、执行、缓存和权限控制等功能
 */
export class ToolRegistry extends EventEmitter {
    private tools: Map<string, ToolDefinition> = new Map();
    private executor: ToolExecutor;
    private cache: ToolCache;
    private config: ToolRegistryConfig;

    // 工具调用历史
    private callHistory: ToolCallRecord[] = [];

    constructor(config: ToolRegistryConfig) {
        super();
        this.config = config;
        this.executor = new ToolExecutor({
            workingDirectory: config.workingDirectory,
        });
        this.cache = new ToolCache({
            enabled: config.enableCache ?? true,
            maxSize: config.cacheSize ?? 100,
        });
    }

    // ========================================================================
    // 工具注册
    // ========================================================================

    /**
     * 注册工具
     */
    register(tool: ToolDefinition): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered`);
        }

        // 验证工具定义
        this.validateTool(tool);

        this.tools.set(tool.name, tool);
    }

    /**
     * 批量注册工具
     */
    registerBatch(tools: ToolDefinition[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    /**
     * 注销工具
     */
    unregister(name: string): boolean {
        this.cache.invalidate(name);
        return this.tools.delete(name);
    }

    /**
     * 检查工具是否已注册
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * 获取工具定义
     */
    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    /**
     * 获取所有工具
     */
    getAll(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /**
     * 按分类获取工具
     */
    getByCategory(category: ToolCategory): ToolDefinition[] {
        return Array.from(this.tools.values()).filter(
            tool => tool.category === category
        );
    }

    // ========================================================================
    // 工具执行
    // ========================================================================

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

        const callId = uuidv4();
        const startTime = Date.now();

        // 发送开始事件
        this.emit('call:start', { toolName: name, id: callId });

        // 检查缓存
        if (this.cache.isEnabled()) {
            const cached = this.cache.get(name, params);
            if (cached) {
                return cached;
            }
        }

        // 权限检查
        const permission = tool.permission ?? 'safe';
        if (permission !== 'safe') {
            const approved = await this.requestConfirmation({
                id: callId,
                description: tool.description,
                toolName: name,
                parameters: params,
                permission,
            });

            if (!approved.approved) {
                const result: ToolResult = {
                    success: false,
                    error: approved.message || 'Operation cancelled by user',
                };
                this.recordCall(callId, name, params, result, startTime);
                this.emit('call:error', { toolName: name, id: callId, error: new Error(result.error) });
                return result;
            }
        }

        try {
            // 执行工具
            const result = await this.executor.execute(tool, params, context);

            // 记录调用
            this.recordCall(callId, name, params, result, startTime);

            // 缓存结果
            if (result.success && this.cache.isEnabled()) {
                this.cache.set(name, params, result);
            }

            // 发送完成事件
            this.emit('call:complete', { toolName: name, id: callId, result });

            return result;
        } catch (error) {
            const err = error as Error;
            const result: ToolResult = {
                success: false,
                error: err.message,
                retryable: this.isRetryableError(err),
            };

            this.recordCall(callId, name, params, result, startTime);

            // 发送错误事件
            this.emit('call:error', { toolName: name, id: callId, error: err });

            return result;
        }
    }

    /**
     * 批量执行工具（并行）
     */
    async executeBatch(
        calls: Array<{ name: string; params: unknown }>,
        context: ExecutionContext
    ): Promise<ToolResult[]> {
        return Promise.all(
            calls.map(call => this.execute(call.name, call.params, context))
        );
    }

    // ========================================================================
    // LLM 工具转换
    // ========================================================================

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
     * 获取工具描述（用于系统提示词）
     */
    getToolDescriptions(): string {
        const lines: string[] = ['Available Tools:'];

        const grouped = new Map<ToolCategory, ToolDefinition[]>();
        for (const tool of this.tools.values()) {
            const category: ToolCategory = (tool.category as ToolCategory) || ToolCategory.SYSTEM;
            if (!grouped.has(category)) {
                grouped.set(category, []);
            }
            grouped.get(category)!.push(tool);
        }

        for (const [category, tools] of grouped) {
            lines.push(`\n${category.toUpperCase()}:`);
            for (const tool of tools) {
                const required = tool.parameters.required?.join(', ') || 'none';
                lines.push(`  - ${tool.name}: ${tool.description}`);
                lines.push(`    Required params: ${required}`);
            }
        }

        return lines.join('\n');
    }

    // ========================================================================
    // 历史记录
    // ========================================================================

    /**
     * 获取调用历史
     */
    getCallHistory(): ToolCallRecord[] {
        return [...this.callHistory];
    }

    /**
     * 获取特定工具的调用历史
     */
    getCallHistoryForTool(toolName: string): ToolCallRecord[] {
        return this.callHistory.filter(record => record.toolName === toolName);
    }

    /**
     * 清空历史记录
     */
    clearHistory(): void {
        this.callHistory = [];
    }

    // ========================================================================
    // 缓存管理
    // ========================================================================

    /**
     * 清空缓存
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * 获取缓存统计
     */
    getCacheStats() {
        return this.cache.getStats();
    }

    // ========================================================================
    // 私有方法
    // ========================================================================

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

    /**
     * 请求确认
     */
    private async requestConfirmation(
        request: ConfirmationRequest
    ): Promise<ConfirmationResponse> {
        if (this.config.onConfirmation) {
            return await this.config.onConfirmation(request);
        }

        // 默认批准
        return { id: request.id, approved: true };
    }

    /**
     * 记录工具调用
     */
    private recordCall(
        id: string,
        toolName: string,
        parameters: unknown,
        result: ToolResult,
        startTime: number
    ): void {
        const record: ToolCallRecord = {
            id,
            toolName,
            parameters,
            result,
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
            success: result.success,
        };

        this.callHistory.push(record);

        // 限制历史记录大小
        if (this.callHistory.length > 1000) {
            this.callHistory = this.callHistory.slice(-500);
        }
    }

    /**
     * 判断错误是否可重试
     */
    private isRetryableError(error: Error): boolean {
        const retryablePatterns = [
            /timeout/i,
            /network/i,
            /connection/i,
            /temporarily/i,
            /rate limit/i,
        ];

        return retryablePatterns.some(pattern => pattern.test(error.message));
    }

    // ========================================================================
    // 清理
    // ========================================================================

    /**
     * 清理资源
     */
    dispose(): void {
        this.cache.clear();
        this.callHistory = [];
        this.tools.clear();
        this.removeAllListeners();
    }
}
