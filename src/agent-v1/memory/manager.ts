/**
 * Memory Manager - 记忆管理器
 *
 * 管理执行上下文、对话历史和系统提示词
 */

import type {
    ExecutionContext,
    Thought,
    ToolCallRecord,
    FileChangeRecord,
    Task,
} from '../types';
import { getDefaultSystemPrompt } from '../prompts/system';

/**
 * 记忆管理器配置
 */
export interface MemoryManagerConfig {
    /** 系统提示词 */
    systemPrompt?: string;
    /** 工作目录 */
    workingDirectory: string;
    /** 最大历史记录数 */
    maxHistorySize?: number;
}

/**
 * MemoryManager - 执行上下文和记忆管理
 */
export class MemoryManager {
    private config: MemoryManagerConfig;
    private contexts: Map<string, ExecutionContext> = new Map();

    constructor(config: MemoryManagerConfig) {
        this.config = {
            maxHistorySize: 100,
            ...config,
        };
    }

    // ========================================================================
    // 上下文管理
    // ========================================================================

    /**
     * 创建新的执行上下文
     */
    createContext(id: string): ExecutionContext {
        const envVars: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined) {
                envVars[key] = value;
            }
        }

        const context: ExecutionContext = {
            id,
            workingDirectory: this.config.workingDirectory,
            envVars,
            userInputHistory: [],
            toolCallHistory: [],
            fileChangeHistory: [],
            thoughts: [],
            startTime: Date.now(),
        };

        this.contexts.set(id, context);
        return context;
    }

    /**
     * 获取上下文
     */
    getContext(id: string): ExecutionContext | undefined {
        return this.contexts.get(id);
    }

    /**
     * 更新上下文
     */
    updateContext(id: string, updates: Partial<ExecutionContext>): void {
        const context = this.contexts.get(id);
        if (context) {
            Object.assign(context, updates);
        }
    }

    /**
     * 删除上下文
     */
    deleteContext(id: string): void {
        this.contexts.delete(id);
    }

    /**
     * 清空所有上下文
     */
    clearAll(): void {
        this.contexts.clear();
    }

    // ========================================================================
    // 系统提示词
    // ========================================================================

    /**
     * 构建系统提示词
     */
    buildSystemPrompt(context: ExecutionContext): string {
        const basePrompt = this.config.systemPrompt || getDefaultSystemPrompt();

        // 添加工作目录信息
        const workingDirInfo = `\n\nWorking Directory: ${context.workingDirectory}`;

        // 添加最近的文件变更
        let fileInfo = '';
        if (context.fileChangeHistory.length > 0) {
            fileInfo = '\n\nRecent File Changes:\n';
            for (const change of context.fileChangeHistory.slice(-5)) {
                fileInfo += `  - ${change.path}: ${change.changeType}\n`;
            }
        }

        // 添加当前任务信息
        let taskInfo = '';
        if (context.currentTask) {
            taskInfo = `\n\nCurrent Task: ${context.currentTask.description}`;
            if (context.currentTask.status !== 'pending') {
                taskInfo += ` [${context.currentTask.status}]`;
            }
        }

        return basePrompt + workingDirInfo + fileInfo + taskInfo;
    }

    /**
     * 更新系统提示词
     */
    setSystemPrompt(prompt: string): void {
        this.config.systemPrompt = prompt;
    }

    // ========================================================================
    // 历史记录管理
    // ========================================================================

    /**
     * 添加用户输入
     */
    addUserInput(contextId: string, input: string): void {
        const context = this.contexts.get(contextId);
        if (context) {
            context.userInputHistory.push(input);
            this.trimHistory(context);
        }
    }

    /**
     * 添加工具调用记录
     */
    addToolCall(contextId: string, call: ToolCallRecord): void {
        const context = this.contexts.get(contextId);
        if (context) {
            context.toolCallHistory.push(call);
            this.trimHistory(context);
        }
    }

    /**
     * 添加文件变更记录
     */
    addFileChange(contextId: string, change: FileChangeRecord): void {
        const context = this.contexts.get(contextId);
        if (context) {
            context.fileChangeHistory.push(change);
            this.trimHistory(context);
        }
    }

    /**
     * 添加思考记录
     */
    addThought(contextId: string, thought: Thought): void {
        const context = this.contexts.get(contextId);
        if (context) {
            context.thoughts.push(thought);
            this.trimHistory(context);
        }
    }

    /**
     * 设置当前任务
     */
    setCurrentTask(contextId: string, task: Task): void {
        const context = this.contexts.get(contextId);
        if (context) {
            context.currentTask = task;
        }
    }

    /**
     * 限制历史记录大小
     */
    private trimHistory(context: ExecutionContext): void {
        const maxSize = this.config.maxHistorySize!;

        if (context.userInputHistory.length > maxSize) {
            context.userInputHistory = context.userInputHistory.slice(-maxSize);
        }

        if (context.toolCallHistory.length > maxSize) {
            context.toolCallHistory = context.toolCallHistory.slice(-maxSize);
        }

        if (context.fileChangeHistory.length > maxSize) {
            context.fileChangeHistory = context.fileChangeHistory.slice(-maxSize);
        }

        if (context.thoughts.length > maxSize) {
            context.thoughts = context.thoughts.slice(-maxSize);
        }
    }

    // ========================================================================
    // 消息压缩
    // ========================================================================

    /**
     * 压缩消息列表（用于长对话）
     *
     * 策略：
     * 1. 保留最近的 N 条消息
     * 2. 将更早的消息摘要为上下文
     */
    compressMessages(
        messages: Array<{ role: string; content: string }>,
        options?: {
            keepRecent?: number;
            summarizeOlder?: boolean;
        }
    ): Array<{ role: string; content: string }> {
        const keepRecent = options?.keepRecent ?? 10;
        const summarizeOlder = options?.summarizeOlder ?? true;

        if (messages.length <= keepRecent) {
            return messages;
        }

        const recent = messages.slice(-keepRecent);
        const older = messages.slice(0, -keepRecent);

        if (!summarizeOlder) {
            return recent;
        }

        // 创建摘要
        const summary = this.summarizeMessages(older);

        return [
            { role: 'system', content: summary },
            ...recent,
        ];
    }

    /**
     * 摘要消息列表
     */
    private summarizeMessages(messages: Array<{ role: string; content: string }>): string {
        const parts: string[] = ['[Previous conversation summary:]'];

        // 统计消息类型
        const userMessages = messages.filter(m => m.role === 'user').length;
        const assistantMessages = messages.filter(m => m.role === 'assistant').length;
        const toolMessages = messages.filter(m => m.role === 'tool').length;

        parts.push(`- ${userMessages} user messages`);
        parts.push(`- ${assistantMessages} assistant responses`);
        parts.push(`- ${toolMessages} tool results`);

        // 提取关键信息
        const lastUserMessage = messages.findLast(m => m.role === 'user');
        if (lastUserMessage) {
            const preview = lastUserMessage.content.slice(0, 100);
            parts.push(`- Last user request: "${preview}${lastUserMessage.content.length > 100 ? '...' : ''}"`);
        }

        return parts.join('\n');
    }

    // ========================================================================
    // 上下文查询
    // ========================================================================

    /**
     * 获取上下文统计信息
     */
    getContextStats(contextId: string): {
        inputCount: number;
        toolCallCount: number;
        fileChangeCount: number;
        thoughtCount: number;
        duration: number;
    } | undefined {
        const context = this.contexts.get(contextId);
        if (!context) return undefined;

        return {
            inputCount: context.userInputHistory.length,
            toolCallCount: context.toolCallHistory.length,
            fileChangeCount: context.fileChangeHistory.length,
            thoughtCount: context.thoughts.length,
            duration: Date.now() - context.startTime,
        };
    }

    /**
     * 获取所有上下文
     */
    getAllContexts(): ExecutionContext[] {
        return Array.from(this.contexts.values());
    }

    /**
     * 获取上下文数量
     */
    getCount(): number {
        return this.contexts.size;
    }
}
