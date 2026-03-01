/**
 * 子代理任务恢复模块测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    findInterruptedTasks,
    recoverTask,
    markInterruptedTasks,
    type InterruptedTask,
    type RecoveryOptions,
} from '../recovery';
import { createMemoryManager } from '../../../memory';
import { SubagentType } from '../shared';
import type { LLMProvider, LLMResponse } from '../../../../providers/types';

// Mock Provider
class MockProvider {
    async generate(): Promise<LLMResponse> {
        return {
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'Task completed successfully!',
                    },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
    }
    getTimeTimeout() {
        return 60000;
    }
}

describe('子代理任务恢复模块', () => {
    let memoryManager: ReturnType<typeof createMemoryManager>;
    let mockProvider: MockProvider;
    let testSessionId: string;

    beforeEach(async () => {
        testSessionId = 'test-recovery-session-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/recovery-' + testSessionId,
        });
        await memoryManager.initialize();
        mockProvider = new MockProvider();
    });

    afterEach(async () => {
        await memoryManager.close();
    });

    it('findInterruptedTasks: 应该返回状态为 queued 或 running 的任务', async () => {
        // 创建一个中断的任务记录
        await memoryManager.saveSubTaskRun({
            id: 'task-interrupted-1',
            runId: 'task-interrupted-1',
            parentSessionId: testSessionId,
            childSessionId: `${testSessionId}::subtask::task-interrupted-1`,
            mode: 'background',
            status: 'running',
            description: 'Test interrupted task',
            prompt: 'Do something',
            subagentType: SubagentType.GeneralPurpose,
            startedAt: Date.now(),
            toolsUsed: [],
        });

        // 创建一个已完成的任务记录
        await memoryManager.saveSubTaskRun({
            id: 'task-completed-1',
            runId: 'task-completed-1',
            parentSessionId: testSessionId,
            childSessionId: `${testSessionId}::subtask::task-completed-1`,
            mode: 'background',
            status: 'completed',
            description: 'Test completed task',
            prompt: 'Do something else',
            subagentType: SubagentType.GeneralPurpose,
            startedAt: Date.now(),
            finishedAt: Date.now(),
            toolsUsed: [],
        });

        // 查询中断的任务
        const interruptedTasks = await findInterruptedTasks(memoryManager, testSessionId);

        console.log('Interrupted tasks:', interruptedTasks);

        // 应该只有 1 个中断的任务
        expect(interruptedTasks.length).toBe(1);
        expect(interruptedTasks[0].runId).toBe('task-interrupted-1');
        expect(interruptedTasks[0].status).toBe('running');
    });

    it('findInterruptedTasks: 没有 memoryManager 时应该返回空数组', async () => {
        const tasks = await findInterruptedTasks(undefined, testSessionId);
        expect(tasks).toEqual([]);
    });

    it('markInterruptedTasks: 应该将中断的任务标记为 failed', async () => {
        // 创建两个中断的任务记录
        await memoryManager.saveSubTaskRun({
            id: 'task-mark-1',
            runId: 'task-mark-1',
            parentSessionId: testSessionId,
            childSessionId: `${testSessionId}::subtask::task-mark-1`,
            mode: 'background',
            status: 'queued',
            description: 'Test queued task',
            prompt: 'Do something',
            subagentType: SubagentType.Explore,
            startedAt: Date.now(),
            toolsUsed: [],
        });

        await memoryManager.saveSubTaskRun({
            id: 'task-mark-2',
            runId: 'task-mark-2',
            parentSessionId: testSessionId,
            childSessionId: `${testSessionId}::subtask::task-mark-2`,
            mode: 'background',
            status: 'running',
            description: 'Test running task',
            prompt: 'Do something',
            subagentType: SubagentType.CodeReviewer,
            startedAt: Date.now(),
            toolsUsed: [],
        });

        // 标记中断的任务
        const count = await markInterruptedTasks(memoryManager, testSessionId);
        expect(count).toBe(2);

        // 验证任务已被标记为 failed
        const remaining = await findInterruptedTasks(memoryManager, testSessionId);
        expect(remaining.length).toBe(0);

        // 验证任务记录存在且状态为 failed
        const task1 = await memoryManager.getSubTaskRun('task-mark-1');
        expect(task1?.status).toBe('failed');
        expect(task1?.error).toContain('interrupted');

        const task2 = await memoryManager.getSubTaskRun('task-mark-2');
        expect(task2?.status).toBe('failed');
    });

    it('recoverTask: 应该能够恢复中断的任务', async () => {
        // 创建一个中断的任务记录
        await memoryManager.saveSubTaskRun({
            id: 'task-recover-1',
            runId: 'task-recover-1',
            parentSessionId: testSessionId,
            childSessionId: `${testSessionId}::subtask::task-recover-1`,
            mode: 'background',
            status: 'running',
            description: 'Test task to recover',
            prompt: 'Say hello',
            subagentType: SubagentType.GeneralPurpose,
            startedAt: Date.now(),
            toolsUsed: [],
        });

        const interruptedTask: InterruptedTask = {
            runId: 'task-recover-1',
            parentSessionId: testSessionId,
            childSessionId: `${testSessionId}::subtask::task-recover-1`,
            description: 'Test task to recover',
            prompt: 'Say hello',
            subagentType: SubagentType.GeneralPurpose,
            status: 'running',
            startedAt: Date.now(),
        };

        const options: RecoveryOptions = {
            provider: mockProvider as unknown as LLMProvider,
            memoryManager,
            workingDirectory: process.cwd(),
        };

        const result = await recoverTask(interruptedTask, options);

        console.log('Recovery result:', result);

        expect(result.success).toBe(true);
        expect(result.taskId).toBe('task-recover-1');
        expect(result.status).toBe('resumed');

        // 验证任务记录已更新
        const taskRecord = await memoryManager.getSubTaskRun('task-recover-1');
        expect(taskRecord?.status).toBe('completed');
    });

    it('recoverTask: restart=true 应该创建新会话', async () => {
        // 先创建一个有历史的子会话
        const childSessionId = `${testSessionId}::subtask::task-restart-1`;
        await memoryManager.createSession(childSessionId, 'Test system prompt');
        await memoryManager.addMessageToContext(childSessionId, {
            messageId: 'msg-1',
            role: 'user',
            content: 'Previous message',
        });

        const interruptedTask: InterruptedTask = {
            runId: 'task-restart-1',
            parentSessionId: testSessionId,
            childSessionId,
            description: 'Test task to restart',
            prompt: 'Say hello',
            subagentType: SubagentType.GeneralPurpose,
            status: 'running',
            startedAt: Date.now(),
        };

        const options: RecoveryOptions = {
            provider: mockProvider as unknown as LLMProvider,
            memoryManager,
            workingDirectory: process.cwd(),
            restart: true,
        };

        const result = await recoverTask(interruptedTask, options);

        expect(result.success).toBe(true);
        expect(result.status).toBe('restarted');
        // 新会话 ID 应该与原来不同
        expect(result.childSessionId).not.toBe(childSessionId);
    });

    it('recoverTask: 无效的 subagentType 应该返回失败', async () => {
        const interruptedTask: InterruptedTask = {
            runId: 'task-invalid-1',
            parentSessionId: testSessionId,
            childSessionId: `${testSessionId}::subtask::task-invalid-1`,
            description: 'Test invalid task',
            prompt: 'Say hello',
            subagentType: 'invalid-type' as SubagentType,
            status: 'running',
            startedAt: Date.now(),
        };

        const options: RecoveryOptions = {
            provider: mockProvider as unknown as LLMProvider,
            memoryManager,
            workingDirectory: process.cwd(),
        };

        const result = await recoverTask(interruptedTask, options);

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toContain('Unknown subagent type');
    });
});
