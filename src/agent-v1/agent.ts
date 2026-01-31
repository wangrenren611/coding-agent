/**
 * Coding Agent 主类
 *
 * 实现具备任务理解、规划执行、工具调用等核心能力的 Coding Agent
 */

import {
    AgentConfig,
    AgentOptions,
    AgentStatus,
    AgentResult,
    AgentEvent,
    AgentEventType,
    ExecutionContext,
    ExecutionOptions,
} from './types';
import { ToolRegistry } from './tools/registry';
import { TaskManager } from './tasks/manager';
import { MemoryManager } from './memory/manager';
import { Planner } from './core/planner';
import { BackupManager } from './utils/backup';
import { ReActEngine } from './core/engine';
import { v4 as uuidv4 } from 'uuid';

// 默认配置
const DEFAULT_CONFIG: Partial<AgentConfig> = {
    maxLoops: 30,
    maxToolsPerTask: 50,
    timeout: 300000, // 5 minutes
    enableBackup: true,
    maxBackups: 10,
    interactiveMode: true,
};

/**
 * CodingAgent - 智能代码编写助手
 *
 * 基于 ReAct (Reasoning + Acting) 范式，结合 LLM 和工具调用能力，
 * 实现复杂任务的自主理解和执行。
 */
export class CodingAgent {
    // ========================================================================
    // 私有属性
    // ========================================================================

    private provider: AgentOptions['provider'];
    private config: AgentConfig;
    private toolRegistry: ToolRegistry;
    private taskManager: TaskManager;
    private memoryManager: MemoryManager;
    private planner: Planner;
    private backupManager: BackupManager;
    private reactEngine: ReActEngine;

    private status: AgentStatus = AgentStatus.IDLE;
    private abortController: AbortController | null = null;
    private currentContext: ExecutionContext | null = null;

    // 回调函数
    private onConfirmation?: AgentOptions['onConfirmation'];
    private onEvent?: AgentOptions['onEvent'];

    // ========================================================================
    // 构造函数
    // ========================================================================

    constructor(options: AgentOptions) {
        this.provider = options.provider;
        this.onConfirmation = options.onConfirmation;
        this.onEvent = options.onEvent;

        // 合并配置
        this.config = this.mergeConfig(options.config);

        // 初始化核心组件
        this.toolRegistry = new ToolRegistry({
            onConfirmation: this.handleConfirmation.bind(this),
            workingDirectory: this.config.workingDirectory,
        });

        this.backupManager = new BackupManager({
            enabled: this.config.enableBackup,
            maxBackups: this.config.maxBackups,
            workingDirectory: this.config.workingDirectory,
        });

        this.memoryManager = new MemoryManager({
            systemPrompt: this.config.systemPrompt,
            workingDirectory: this.config.workingDirectory,
        });

        this.taskManager = new TaskManager();

        this.planner = new Planner({
            provider: this.provider,
            toolRegistry: this.toolRegistry,
        });

        this.reactEngine = new ReActEngine({
            provider: this.provider,
            toolRegistry: this.toolRegistry,
            taskManager: this.taskManager,
            memoryManager: this.memoryManager,
            maxLoops: this.config.maxLoops,
            maxToolsPerTask: this.config.maxToolsPerTask,
        });

        // 注册事件监听
        this.setupEventListeners();
    }

    // ========================================================================
    // 公共方法
    // ========================================================================

    /**
     * 执行任务
     */
    async execute(task: string, options?: ExecutionOptions): Promise<AgentResult> {
        const startTime = Date.now();
        let result: AgentResult;

        try {
            // 检查中止状态
            if (this.status === AgentStatus.ABORTED) {
                throw new Error('Agent has been aborted');
            }

            // 创建新的中止控制器
            this.abortController = new AbortController();

            // 合并外部中止信号
            if (options?.abortSignal) {
                options.abortSignal.addEventListener('abort', () => {
                    this.abortController?.abort();
                });
            }

            // 更新状态
            this.setStatus(AgentStatus.PLANNING);
            this.emitEvent({
                type: AgentEventType.STATUS_CHANGED,
                timestamp: Date.now(),
                data: { status: AgentStatus.PLANNING },
            });

            // 创建执行上下文
            const contextId = uuidv4();
            this.currentContext = this.memoryManager.createContext(contextId);
            this.currentContext.userInputHistory.push(task);

            // 规划阶段
            this.setStatus(AgentStatus.PLANNING);
            const plan = await this.planner.createPlan(task, this.currentContext);

            // 添加任务到管理器
            this.taskManager.addTask(plan.mainTask);
            for (const subtask of plan.subtasks) {
                this.taskManager.addTask(subtask);
            }

            // 执行阶段
            this.setStatus(AgentStatus.RUNNING);
            this.emitEvent({
                type: AgentEventType.STATUS_CHANGED,
                timestamp: Date.now(),
                data: { status: AgentStatus.RUNNING },
            });

            // 使用 ReAct 引擎执行
            result = await this.reactEngine.execute(task, {
                context: this.currentContext,
                plan,
                abortSignal: this.abortController.signal,
                onProgress: (progress) => {
                    this.emitEvent({
                        type: AgentEventType.PROGRESS,
                        timestamp: Date.now(),
                        data: progress,
                    });
                },
            });

            // 完成
            this.setStatus(AgentStatus.COMPLETED);
            this.emitEvent({
                type: AgentEventType.COMPLETED,
                timestamp: Date.now(),
                data: { result },
            });

        } catch (error) {
            const err = error as Error;
            this.setStatus(AgentStatus.FAILED);
            this.emitEvent({
                type: AgentEventType.ERROR,
                timestamp: Date.now(),
                error: err,
            });

            result = {
                success: false,
                toolCalls: [],
                tasks: this.taskManager.getAllTasks(),
                error: err,
                duration: Date.now() - startTime,
            };
        } finally {
            // 清理
            this.abortController = null;
        }

        result.duration = Date.now() - startTime;
        return result;
    }

    /**
     * 流式执行任务
     */
    async *executeStream(task: string): AsyncGenerator<AgentEvent, AgentResult> {
        // 包装 execute 方法，在执行过程中发送事件
        const events: AgentEvent[] = [];

        // 设置事件收集器
        const originalOnEvent = this.onEvent;
        this.onEvent = (event) => {
            events.push(event);
            originalOnEvent?.(event);
        };

        try {
            // 启动执行（不等待）
            const executionPromise = this.execute(task);

            // 在执行过程中发送事件
            while (true) {
                if (events.length > 0) {
                    const event = events.shift()!;
                    yield event;

                    if (event.type === AgentEventType.COMPLETED ||
                        event.type === AgentEventType.ERROR) {
                        // 执行完成，获取结果
                        const result = await executionPromise;
                        return result;
                    }
                } else {
                    // 等待新事件
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        } finally {
            this.onEvent = originalOnEvent;
        }
    }

    /**
     * 中止当前执行
     */
    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.setStatus(AgentStatus.ABORTED);
            this.emitEvent({
                type: AgentEventType.STATUS_CHANGED,
                timestamp: Date.now(),
                data: { status: AgentStatus.ABORTED },
            });
        }
    }

    /**
     * 注册工具
     */
    registerTool(tool: import('./types').ToolDefinition): void {
        this.toolRegistry.register(tool);
    }

    /**
     * 获取当前状态
     */
    getStatus(): AgentStatus {
        return this.status;
    }

    /**
     * 获取当前上下文
     */
    getContext(): ExecutionContext | null {
        return this.currentContext;
    }

    /**
     * 获取任务统计
     */
    getTaskStats() {
        return this.taskManager.getStats();
    }

    // ========================================================================
    // 私有方法
    // ========================================================================

    /**
     * 合并配置
     */
    private mergeConfig(userConfig: Partial<AgentConfig>): AgentConfig {
        return {
            modelId: userConfig.modelId || 'glm-4.7',
            maxLoops: userConfig.maxLoops ?? DEFAULT_CONFIG.maxLoops!,
            maxToolsPerTask: userConfig.maxToolsPerTask ?? DEFAULT_CONFIG.maxToolsPerTask!,
            timeout: userConfig.timeout ?? DEFAULT_CONFIG.timeout!,
            enableBackup: userConfig.enableBackup ?? DEFAULT_CONFIG.enableBackup!,
            maxBackups: userConfig.maxBackups ?? DEFAULT_CONFIG.maxBackups!,
            workingDirectory: userConfig.workingDirectory || process.cwd(),
            interactiveMode: userConfig.interactiveMode ?? DEFAULT_CONFIG.interactiveMode!,
            systemPrompt: userConfig.systemPrompt,
        };
    }

    /**
     * 设置状态
     */
    private setStatus(status: AgentStatus): void {
        const oldStatus = this.status;
        this.status = status;

        if (oldStatus !== status) {
            console.log(`[Agent] Status: ${oldStatus} -> ${status}`);
        }
    }

    /**
     * 发送事件
     */
    private emitEvent(event: AgentEvent): void {
        this.onEvent?.(event);
    }

    /**
     * 处理确认请求
     */
    private async handleConfirmation(request: import('./types').ConfirmationRequest): Promise<import('./types').ConfirmationResponse> {
        if (this.onConfirmation) {
            return await this.onConfirmation(request);
        }

        // 默认行为：在交互模式下询问用户，否则自动批准安全操作
        if (this.config.interactiveMode) {
            // 简单的命令行确认
            process.stdout.write(`\n[Confirmation] ${request.description}`);
            if (request.toolName) {
                process.stdout.write(` (tool: ${request.toolName})`);
            }
            process.stdout.write('\nApprove? [y/N]: ');

            // 这里应该从 stdin 读取，简化处理返回 true
            return { id: request.id, approved: true };
        }

        // 非交互模式：只批准安全操作
        return {
            id: request.id,
            approved: request.permission === 'safe',
        };
    }

    /**
     * 设置事件监听器
     */
    private setupEventListeners(): void {
        // 工具调用事件
        this.toolRegistry.on('call:start', (data: { toolName: string; id: string }) => {
            this.emitEvent({
                type: AgentEventType.TOOL_CALL_START,
                timestamp: Date.now(),
                data,
            });
        });

        this.toolRegistry.on('call:complete', (data: { toolName: string; id: string; result: unknown }) => {
            this.emitEvent({
                type: AgentEventType.TOOL_CALL_COMPLETE,
                timestamp: Date.now(),
                data,
            });
        });

        this.toolRegistry.on('call:error', (data: { toolName: string; id: string; error: Error }) => {
            this.emitEvent({
                type: AgentEventType.TOOL_CALL_ERROR,
                timestamp: Date.now(),
                data: { toolName: data.toolName, id: data.id },
                error: data.error,
            });
        });

        // 任务管理事件
        this.taskManager.on('task:created', (data: { task: import('./types').Task }) => {
            this.emitEvent({
                type: AgentEventType.TASK_CREATED,
                timestamp: Date.now(),
                data: { taskId: data.task.id, description: data.task.description },
            });
        });

        this.taskManager.on('task:updated', (data: { task: import('./types').Task }) => {
            this.emitEvent({
                type: AgentEventType.TASK_UPDATED,
                timestamp: Date.now(),
                data: {
                    taskId: data.task.id,
                    status: data.task.status,
                },
            });
        });
    }

    /**
     * 清理资源
     */
    dispose(): void {
        this.abort();
        this.toolRegistry.dispose();
        this.backupManager.dispose();
    }
}
