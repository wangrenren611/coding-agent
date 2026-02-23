/**
 * 工具执行器
 * 
 * 封装工具调用执行逻辑。
 * 
 * 职责：
 * 1. 执行工具调用
 * 2. 记录工具结果
 * 3. 敏感信息脱敏
 */

import { v4 as uuid } from 'uuid';
import type { ToolRegistry } from '../../tool/registry';
import type { ToolContext } from '../../tool/base';
import type { ToolCall, ToolExecutionResult } from '../core-types';
import type { Message } from '../../session/types';
import { createToolResultMessage } from '../message-builder';
import { sanitizeToolResult as sanitizeToolResultUtil, toolResultToString } from '../../security';

/**
 * 工具执行器配置
 */
export interface ToolExecutorConfig {
    /** 工具注册表 */
    toolRegistry: ToolRegistry;
    /** 会话 ID */
    sessionId: string;
    /** 记忆管理器（可选） */
    memoryManager?: unknown;

    // 回调
    /** 工具调用创建回调 */
    onToolCallCreated?: (toolCalls: ToolCall[], messageId: string, content?: string) => void;
    /** 工具调用结果回调 */
    onToolCallResult?: (
        toolCallId: string,
        result: unknown,
        status: 'success' | 'error',
        messageId: string
    ) => void;
    /** 消息添加回调 */
    onMessageAdd?: (message: Message) => void;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionOutput {
    /** 是否成功 */
    success: boolean;
    /** 执行的工具数量 */
    toolCount: number;
    /** 工具结果消息 */
    resultMessages: Message[];
}

/**
 * 工具执行器
 */
export class ToolExecutor {
    private readonly config: ToolExecutorConfig;

    constructor(config: ToolExecutorConfig) {
        this.config = config;
    }

    /**
     * 执行工具调用
     */
    async execute(
        toolCalls: ToolCall[],
        messageId: string,
        messageContent?: string
    ): Promise<ToolExecutionOutput> {
        // 触发工具调用创建回调
        this.config.onToolCallCreated?.(toolCalls, messageId, messageContent);

        // 构建工具上下文
        const toolContext = this.buildToolContext();

        // 执行工具
        const results = await this.config.toolRegistry.execute(toolCalls, toolContext as ToolContext);

        // 记录结果
        const resultMessages = this.recordResults(results);

        return {
            success: results.every(r => r.result?.success !== false),
            toolCount: results.length,
            resultMessages,
        };
    }

    /**
     * 构建工具上下文
     */
    private buildToolContext(): { sessionId: string; memoryManager?: unknown } {
        const context: { sessionId: string; memoryManager?: unknown } = {
            sessionId: this.config.sessionId,
        };

        if (this.config.memoryManager) {
            context.memoryManager = this.config.memoryManager;
        }

        return context;
    }

    /**
     * 记录工具执行结果
     */
    private recordResults(results: ToolExecutionResult[]): Message[] {
        const messages: Message[] = [];

        for (const result of results) {
            const resultMessageId = uuid();
            const sanitized = this.sanitizeToolResult(result);

            // 触发回调
            this.config.onToolCallResult?.(
                result.tool_call_id,
                sanitized,
                result.result?.success ? 'success' : 'error',
                resultMessageId
            );

            // 创建工具结果消息
            const message = createToolResultMessage(
                result.tool_call_id,
                this.safeToolResultToString(sanitized),
                resultMessageId
            );

            // 添加到会话
            this.config.onMessageAdd?.(message);
            messages.push(message);
        }

        return messages;
    }

    /**
     * 脱敏工具结果（使用统一的安全模块）
     */
    private sanitizeToolResult(result: ToolExecutionResult): unknown {
        return sanitizeToolResultUtil(result);
    }

    /**
     * 安全地将工具结果转换为字符串（使用统一的安全模块）
     */
    private safeToolResultToString(result: unknown): string {
        return toolResultToString(result);
    }

    /**
     * 获取工具注册表
     */
    getToolRegistry(): ToolRegistry {
        return this.config.toolRegistry;
    }
}
