/**
 * 子代理任务恢复模块
 *
 * 功能：
 * 1. 检测程序异常退出后未完成的子任务
 * 2. 提供恢复这些任务的接口
 * 3. 支持查询中断状态
 *
 * 使用场景：
 * - 程序启动时检查是否有未完成任务
 * - 用户手动请求恢复中断的任务
 */

import { Agent } from '../../agent/agent';
import type { LLMProvider } from '../../../providers';
import type { IMemoryManager } from '../../memory/types';
import { AGENT_CONFIGS } from './subagent-config';
import { SubagentType, BackgroundTaskStatus } from './shared';
import { ToolRegistry } from '../registry';
import type { ToolRegistryConfig } from '../registry';


/**
 * 中断的任务信息
 */
export interface InterruptedTask {
    runId: string;
    parentSessionId: string;
    childSessionId: string;
    description: string;
    prompt: string;
    subagentType: SubagentType;
    status: BackgroundTaskStatus;
    startedAt: number;
    lastActivityAt?: number;
    messageCount?: number;
    error?: string;
}

/**
 * 恢复选项
 */
export interface RecoveryOptions {
    /** LLM Provider */
    provider: LLMProvider;
    /** Memory Manager */
    memoryManager?: IMemoryManager;
    /** 工作目录 */
    workingDirectory?: string;
    /** 父会话的 streamCallback（用于事件冒泡） */
    streamCallback?: (message: unknown) => void;
    /** 是否重新执行（true）还是从断点继续（false，默认） */
    restart?: boolean;
}

/**
 * 恢复结果
 */
export interface RecoveryResult {
    success: boolean;
    taskId: string;
    childSessionId: string;
    status: 'resumed' | 'restarted' | 'failed';
    output?: string;
    error?: string;
}

/**
 * 查询中断的任务
 *
 * @param memoryManager Memory Manager 实例
 * @param parentSessionId 可选，限定父会话 ID
 * @returns 中断的任务列表
 */
export async function findInterruptedTasks(
    memoryManager: IMemoryManager | undefined,
    parentSessionId?: string
): Promise<InterruptedTask[]> {
    if (!memoryManager) {
        console.warn('[Recovery] No memory manager provided, cannot find interrupted tasks');
        return [];
    }

    // 等待初始化
    if (memoryManager.waitForInitialization) {
        await memoryManager.waitForInitialization();
    }

    // 查询所有子任务运行记录
    const allRuns = await memoryManager.querySubTaskRuns({
        parentSessionId,
    });

    // 筛选出中断的任务（状态为 queued 或 running）
    const interruptedStatuses: BackgroundTaskStatus[] = ['queued', 'running'];

    const interrupted: InterruptedTask[] = allRuns
        .filter((run) => interruptedStatuses.includes(run.status))
        .map((run) => ({
            runId: run.runId,
            parentSessionId: run.parentSessionId,
            childSessionId: run.childSessionId,
            description: run.description,
            prompt: run.prompt,
            subagentType: run.subagentType as SubagentType,
            status: run.status,
            startedAt: run.startedAt,
            lastActivityAt: run.lastActivityAt,
            messageCount: run.messageCount,
            error: run.error,
        }));

    return interrupted;
}

/**
 * 恢复单个中断的任务
 *
 * @param task 中断的任务信息
 * @param options 恢复选项
 * @returns 恢复结果
 */
export async function recoverTask(
    task: InterruptedTask,
    options: RecoveryOptions
): Promise<RecoveryResult> {
    const { provider, memoryManager, workingDirectory = process.cwd(), streamCallback, restart = false } = options;

    const config = AGENT_CONFIGS[task.subagentType];
    if (!config) {
        return {
            success: false,
            taskId: task.runId,
            childSessionId: task.childSessionId,
            status: 'failed',
            error: `Unknown subagent type: ${task.subagentType}`,
        };
    }

    try {
        // 创建工具注册表
        const registryConfig: ToolRegistryConfig = {
            workingDirectory,
        };
        const registry = new ToolRegistry(registryConfig);
        registry.register(config.tools.map((ToolClass) => new ToolClass()));

        // 决定 sessionId：重启用新的，继续用原来的
        const sessionId = restart ? undefined : task.childSessionId;

        // 创建子代理
        const subagent = new Agent({
            provider,
            systemPrompt: buildSubagentSystemPrompt(config.systemPrompt, workingDirectory),
            toolRegistry: registry,
            maxRetries: config.maxRetries || 10,
            idleTimeout: config.idleTimeoutMs,
            stream: !!streamCallback,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            streamCallback: streamCallback as any,
            memoryManager,
            sessionId,
        });

        // 执行任务
        const result = await subagent.executeWithResult(task.prompt);

        // 获取实际使用的 sessionId（重启时可能是新的）
        const actualSessionId = subagent.getSessionId();

        // 更新子任务记录状态
        if (memoryManager) {
            await memoryManager.saveSubTaskRun({
                id: task.runId,
                runId: task.runId,
                parentSessionId: task.parentSessionId,
                childSessionId: actualSessionId,
                mode: 'background',
                status: result.status === 'completed' ? 'completed' : 'failed',
                description: task.description,
                prompt: task.prompt,
                subagentType: task.subagentType,
                startedAt: task.startedAt,
                finishedAt: Date.now(),
                turns: result.loopCount,
                toolsUsed: [],
                output: result.finalMessage ? String(result.finalMessage.content) : undefined,
                error: result.failure?.internalMessage,
            });
        }

        return {
            success: result.status === 'completed',
            taskId: task.runId,
            childSessionId: actualSessionId,
            status: restart ? 'restarted' : 'resumed',
            output: result.finalMessage ? String(result.finalMessage.content) : undefined,
            error: result.failure?.internalMessage,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            taskId: task.runId,
            childSessionId: task.childSessionId,
            status: 'failed',
            error: errorMessage,
        };
    }
}

/**
 * 批量恢复中断的任务
 *
 * @param tasks 中断的任务列表
 * @param options 恢复选项
 * @param parallel 是否并行执行（默认串行）
 * @returns 恢复结果列表
 */
export async function recoverTasks(
    tasks: InterruptedTask[],
    options: RecoveryOptions,
    parallel = false
): Promise<RecoveryResult[]> {
    if (parallel) {
        return Promise.all(tasks.map((task) => recoverTask(task, options)));
    }

    // 串行执行，避免 RATE_LIMIT
    const results: RecoveryResult[] = [];
    for (const task of tasks) {
        const result = await recoverTask(task, options);
        results.push(result);
    }
    return results;
}

/**
 * 将中断的任务标记为 "interrupted" 状态
 *
 * 程序启动时调用，将所有 queued/running 状态的任务标记为 interrupted
 *
 * @param memoryManager Memory Manager 实例
 * @param parentSessionId 可选，限定父会话 ID
 */
export async function markInterruptedTasks(
    memoryManager: IMemoryManager | undefined,
    parentSessionId?: string
): Promise<number> {
    const tasks = await findInterruptedTasks(memoryManager, parentSessionId);

    if (tasks.length === 0) {
        return 0;
    }

    // 逐个更新状态
    let count = 0;
    for (const task of tasks) {
        if (!memoryManager) continue;

        try {
            await memoryManager.saveSubTaskRun({
                id: task.runId,
                runId: task.runId,
                parentSessionId: task.parentSessionId,
                childSessionId: task.childSessionId,
                mode: 'background',
                status: 'failed',
                description: task.description,
                prompt: task.prompt,
                subagentType: task.subagentType,
                startedAt: task.startedAt,
                finishedAt: Date.now(),
                toolsUsed: [],
                error: 'Task interrupted by program exit',
            });
            count++;
        } catch (e) {
            console.error(`[Recovery] Failed to mark task ${task.runId} as interrupted:`, e);
        }
    }

    return count;
}

/**
 * 构建子代理的系统提示词
 */
function buildSubagentSystemPrompt(basePrompt: string, workingDir: string): string {
    return `${basePrompt}

Execution context:
- Project root directory: ${workingDir}
- Use relative paths from the project root whenever possible.
- Never assume the project root is "/workspace".`;
}

export { InterruptedTask as InterruptedTaskInfo };
