import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LLMProvider } from '../../../providers';
import { LLMBadRequestError } from '../../../providers/types/errors';
import type { LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../../providers';
import type { ToolContext } from '../base';
import { TestEnvironment } from './test-utils';
import { createMemoryManager } from '../../memory';
import type { IMemoryManager } from '../../memory';
import { ToolRegistry } from '../registry';
import {
    TaskCreateTool,
    TaskGetTool,
    TaskListTool,
    TaskStopTool,
    TaskTool,
    TaskUpdateTool,
    clearTaskState,
} from '../task';

async function waitForSubTaskRunStatus(
    memoryManager: IMemoryManager,
    runId: string,
    expectedStatuses: Array<'completed' | 'failed' | 'cancelled'>,
    timeoutMs = 3000
) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const run = await memoryManager.getSubTaskRun(runId);
        if (run && expectedStatuses.includes(run.status as 'completed' | 'failed' | 'cancelled')) {
            return run;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return memoryManager.getSubTaskRun(runId);
}

class MockProvider extends LLMProvider {
    private readonly text: string;
    private readonly delayMs: number;

    constructor(text = 'done', delayMs = 0) {
        super({
            apiKey: 'mock',
            baseURL: 'https://mock.local',
            model: 'mock-model',
            max_tokens: 1024,
            LLMMAX_TOKENS: 8192,
            temperature: 0,
        });
        this.text = text;
        this.delayMs = delayMs;
    }

    async generate(_messages: LLMRequestMessage[], options?: LLMGenerateOptions): Promise<LLMResponse | null> {
        if (this.delayMs > 0) {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, this.delayMs);
                options?.abortSignal?.addEventListener(
                    'abort',
                    () => {
                        clearTimeout(timer);
                        reject(new Error('aborted'));
                    },
                    { once: true }
                );
            });
        }

        if (options?.abortSignal?.aborted) {
            throw new Error('aborted');
        }

        return {
            id: 'mock-response',
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: this.text,
                    },
                    finish_reason: 'stop',
                },
            ],
        };
    }

    getTimeTimeout(): number {
        return 10_000;
    }

    getLLMMaxTokens(): number {
        return 8192;
    }

    getMaxOutputTokens(): number {
        return 1024;
    }
}

class FailingProvider extends LLMProvider {
    constructor() {
        super({
            apiKey: 'mock',
            baseURL: 'https://mock.local',
            model: 'mock-model',
            max_tokens: 1024,
            LLMMAX_TOKENS: 8192,
            temperature: 0,
        });
    }

    async generate(_messages: LLMRequestMessage[], _options?: LLMGenerateOptions): Promise<LLMResponse | null> {
        throw new LLMBadRequestError('400 Bad Request - malformed tool call');
    }

    getTimeTimeout(): number {
        return 10_000;
    }

    getLLMMaxTokens(): number {
        return 8192;
    }

    getMaxOutputTokens(): number {
        return 1024;
    }
}

describe('Task tools', () => {
    const MANAGED_TASK_PARENT_ID = '__task_tool_managed__';
    let env: TestEnvironment;
    let sessionId: string;
    let memoryManager: IMemoryManager;
    let toolContext: ToolContext;
    const withContext = <T extends { execute: (...args: any[]) => any }>(tool: T): T => {
        const rawExecute = tool.execute.bind(tool);
        (tool as any).execute = (args?: unknown) => rawExecute(args as never, toolContext);
        return tool;
    };

    beforeEach(async () => {
        env = new TestEnvironment('task-tools');
        await env.setup();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: `${env.getTestDir()}/agent-memory`,
        });
        await memoryManager.initialize();
        sessionId = `task-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        toolContext = {
            environment: process.cwd(),
            platform: process.platform,
            time: new Date().toISOString(),
            sessionId,
            memoryManager,
        };
        clearTaskState();
    });

    afterEach(async () => {
        clearTaskState();
        await memoryManager.close();
        await env.teardown();
    });

    it('should create/list/get/update/delete managed tasks', async () => {
        const create = withContext(new TaskCreateTool());
        const list = withContext(new TaskListTool());
        const get = withContext(new TaskGetTool());
        const update = withContext(new TaskUpdateTool());

        const createA = await create.execute({
            subject: 'Implement auth flow',
            description: 'Add login endpoint and validation',
            activeForm: 'Implementing auth flow',
        });
        const createB = await create.execute({
            subject: 'Run test suite',
            description: 'Run all unit tests',
            activeForm: 'Running test suite',
        });

        expect(createA.success).toBe(true);
        expect(createB.success).toBe(true);
        expect(createA.metadata?.id).toBe('1');
        expect(createB.metadata?.id).toBe('2');

        const storedTasks = await memoryManager.queryTasks({
            sessionId,
            parentTaskId: MANAGED_TASK_PARENT_ID,
        });
        expect(storedTasks).toHaveLength(2);
        await expect(fs.access(path.join(env.getTestDir(), 'task-list.json'))).rejects.toThrow();

        const updateDep = await update.execute({
            taskId: '2',
            addBlockedBy: ['1'],
            owner: 'agent-1',
        });
        expect(updateDep.success).toBe(true);

        const task1 = await get.execute({ taskId: '1' });
        const task2 = await get.execute({ taskId: '2' });
        expect(task1.success).toBe(true);
        expect(task2.success).toBe(true);
        expect(task1.metadata?.blocks).toContain('2');
        expect(task2.metadata?.blockedBy).toContain('1');

        const step1 = await update.execute({ taskId: '1', status: 'in_progress' });
        const step2 = await update.execute({ taskId: '1', status: 'completed' });
        expect(step1.success).toBe(true);
        expect(step2.success).toBe(true);

        const listed = await list.execute();
        expect(listed.success).toBe(true);
        expect(listed.metadata?.count).toBe(2);
        const listedTask2 = listed.metadata?.tasks.find((t: any) => t.id === '2');
        expect(listedTask2?.blockedBy).toEqual([]);

        const deleted = await update.execute({ taskId: '2', status: 'deleted' });
        expect(deleted.success).toBe(true);
        const missing = await get.execute({ taskId: '2' });
        expect(missing.success).toBe(false);
    });

    it('should assign unique IDs for concurrent managed task creation', async () => {
        const create = withContext(new TaskCreateTool());

        const results = await Promise.all([
            create.execute({
                subject: 'Task A',
                description: 'Concurrent create A',
                activeForm: 'Creating task A',
            }),
            create.execute({
                subject: 'Task B',
                description: 'Concurrent create B',
                activeForm: 'Creating task B',
            }),
            create.execute({
                subject: 'Task C',
                description: 'Concurrent create C',
                activeForm: 'Creating task C',
            }),
        ]);

        const ids = results.map((result) => result.metadata?.id as string);
        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
        const sortedIds = ids.map((id) => Number.parseInt(id, 10)).sort((a, b) => a - b);
        expect(sortedIds).toEqual([1, 2, 3]);

        const storedTasks = await memoryManager.queryTasks({
            sessionId,
            parentTaskId: MANAGED_TASK_PARENT_ID,
        });
        expect(storedTasks).toHaveLength(3);
    });

    it('should reject invalid status transition', async () => {
        const create = withContext(new TaskCreateTool());
        const update = withContext(new TaskUpdateTool());
        await create.execute({
            subject: 'Build app',
            description: 'Build once',
            activeForm: 'Building app',
        });

        const invalid = await update.execute({
            taskId: '1',
            status: 'completed',
        });
        expect(invalid.success).toBe(false);
        expect(invalid.output).toContain('Invalid status transition');
    });

    it('should keep task 3 in_progress after concurrent updates before marking it completed', async () => {
        const create = withContext(new TaskCreateTool());
        const update = withContext(new TaskUpdateTool());

        await create.execute({
            subject: 'Task 1',
            description: 'Prepare folder',
            activeForm: 'Preparing folder',
        });
        await create.execute({
            subject: 'Task 2',
            description: 'Summarize posts 1-5',
            activeForm: 'Summarizing posts 1-5',
        });
        await create.execute({
            subject: 'Task 3',
            description: 'Summarize posts 6-10',
            activeForm: 'Summarizing posts 6-10',
        });
        await create.execute({
            subject: 'Task 4',
            description: 'Summarize posts 11-17',
            activeForm: 'Summarizing posts 11-17',
        });

        const task2InProgress = await update.execute({ taskId: '2', status: 'in_progress' });
        expect(task2InProgress.success).toBe(true);

        const originalSaveTask = memoryManager.saveTask.bind(memoryManager);
        (memoryManager as IMemoryManager & { saveTask: IMemoryManager['saveTask'] }).saveTask = async (task) => {
            // Force "task 2 completed" update to flush later so it can overwrite task 3 state with a stale snapshot.
            if (task.taskId.endsWith('-2') && task.status === 'completed') {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            await originalSaveTask(task);
        };

        try {
            const [task2Completed, task3InProgress] = await Promise.all([
                update.execute({ taskId: '2', status: 'completed' }),
                update.execute({ taskId: '3', status: 'in_progress' }),
            ]);

            expect(task2Completed.success).toBe(true);
            expect(task3InProgress.success).toBe(true);

            const task3Completed = await update.execute({ taskId: '3', status: 'completed' });
            expect(task3Completed.success).toBe(true);
        } finally {
            (memoryManager as IMemoryManager & { saveTask: IMemoryManager['saveTask'] }).saveTask = originalSaveTask;
        }
    });

    it('should ignore legacy task-list.json when memory manager storage is enabled', async () => {
        const legacyTask = {
            id: '1',
            subject: 'Legacy task',
            description: 'Imported from legacy file',
            activeForm: 'Importing legacy task',
            status: 'pending',
            owner: '',
            metadata: { source: 'legacy' },
            blocks: [],
            blockedBy: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const legacyFilePath = path.join('.memory', sessionId, 'task-list.json');
        await fs.mkdir(path.dirname(legacyFilePath), { recursive: true });
        await fs.writeFile(legacyFilePath, JSON.stringify([legacyTask], null, 2), 'utf-8');

        const list = withContext(new TaskListTool());
        const listed = await list.execute();
        expect(listed.success).toBe(true);
        expect(listed.metadata?.count).toBe(0);

        const storedTasks = await memoryManager.queryTasks({
            sessionId,
            parentTaskId: MANAGED_TASK_PARENT_ID,
        });
        expect(storedTasks).toHaveLength(0);
    });

    it('should persist foreground task run metadata without duplicating full messages', async () => {
        const taskTool = withContext(new TaskTool(new MockProvider('foreground done')));
        const result = await taskTool.execute({
            description: 'Analyze modules',
            prompt: 'Summarize modules',
            subagent_type: 'explore',
        });

        expect(result.success).toBe(true);
        expect(result.metadata?.storage).toBe('memory_manager');
        const runId = result.metadata?.task_id as string;
        const childSessionId = result.metadata?.child_session_id as string;
        const run = await memoryManager.getSubTaskRun(runId);
        expect(run).toBeTruthy();
        expect(run?.status).toBe('completed');
        expect(run?.parentSessionId).toBe(sessionId);
        expect(run?.childSessionId).toBe(childSessionId);
        expect(run?.messageCount).toBeGreaterThan(0);
        expect(run?.messages).toBeUndefined();

        const childContext = await memoryManager.getCurrentContext(childSessionId);
        expect(childContext).toBeTruthy();
        expect((childContext?.messages || []).length).toBeGreaterThan(1);

        const subTaskFilePath = path.join(
            env.getTestDir(),
            'agent-memory',
            'subtask-runs',
            `subtask-run-${encodeURIComponent(runId)}.json`
        );
        const raw = await fs.readFile(subTaskFilePath, 'utf-8');
        const stored = JSON.parse(raw);
        expect(stored.runId).toBe(runId);
        expect(stored.status).toBe('completed');
        expect(stored.messages).toBeUndefined();
        expect(stored.messageCount).toBeGreaterThan(0);
    });

    it('should run background task and persist output metadata', async () => {
        const taskTool = withContext(new TaskTool(new MockProvider('background done')));

        const started = await taskTool.execute({
            description: 'Explore codebase',
            prompt: 'Summarize repo structure',
            subagent_type: 'explore',
            run_in_background: true,
        });
        expect(started.success).toBe(true);
        const taskId = started.metadata?.task_id as string;
        expect(taskId).toBeTruthy();
        expect(started.metadata?.status).toBe('queued');
        expect(started.metadata?.storage).toBe('memory_manager');

        const run = await waitForSubTaskRunStatus(memoryManager, taskId, ['completed']);
        expect(run?.status).toBe('completed');
        expect(run?.output).toContain('background done');
        expect(run?.messageCount).toBeGreaterThan(0);
        expect(run?.messages).toBeUndefined();

        const childContext = await memoryManager.getCurrentContext(run?.childSessionId || '');
        expect(childContext).toBeTruthy();
    });

    it('should stop a running background task', async () => {
        const taskTool = withContext(new TaskTool(new MockProvider('late result', 1000)));
        const stopTool = withContext(new TaskStopTool());

        const started = await taskTool.execute({
            description: 'Long task',
            prompt: 'Do something long',
            subagent_type: 'explore',
            run_in_background: true,
        });
        const taskId = started.metadata?.task_id as string;

        const stopped = await stopTool.execute({ task_id: taskId });
        expect(stopped.success).toBe(true);
        expect(['cancelling', 'cancelled', 'completed']).toContain(stopped.metadata?.status);

        const run = await waitForSubTaskRunStatus(memoryManager, taskId, ['cancelled', 'completed']);
        expect(['cancelled', 'completed']).toContain(run?.status);
        expect(run?.messageCount).toBeGreaterThanOrEqual(0);
        expect(run?.messages).toBeUndefined();
    });

    it('should observe background task completion via persisted run state', async () => {
        const taskTool = withContext(new TaskTool(new MockProvider('slow done', 50)));

        const started = await taskTool.execute({
            description: 'Slow background task',
            prompt: 'Wait and then respond',
            subagent_type: 'explore',
            run_in_background: true,
        });

        const taskId = started.metadata?.task_id as string;

        const run = await waitForSubTaskRunStatus(memoryManager, taskId, ['completed']);
        expect(run?.status).toBe('completed');
        expect(run?.output).toContain('slow done');
    });

    it('should not apply ToolRegistry timeout to task tool execution', async () => {
        const registry = new ToolRegistry({
            workingDirectory: process.cwd(),
            toolTimeout: 20,
        });
        registry.register([new TaskTool(new MockProvider('slow success', 80))]);

        const results = await registry.execute(
            [
                {
                    id: 'call_1',
                    index: 0,
                    type: 'function',
                    function: {
                        name: 'task',
                        arguments: JSON.stringify({
                            description: 'Slow run',
                            prompt: 'Wait and return',
                            subagent_type: 'explore',
                        }),
                    },
                } as any,
            ],
            {
                sessionId,
                memoryManager,
            }
        );

        expect(results).toHaveLength(1);
        expect(results[0].result?.success).toBe(true);
        expect(results[0].result?.output).toContain('slow success');
    });

    it('should return agent-layer failure code for foreground task failures', async () => {
        const taskTool = withContext(new TaskTool(new FailingProvider()));
        const result = await taskTool.execute({
            description: 'Failure case',
            prompt: 'Trigger provider failure',
            subagent_type: 'explore',
        });

        expect(result.success).toBe(false);
        expect(result.metadata?.status).toBe('failed');
        expect(result.metadata?.error).toBe('LLM_REQUEST_FAILED');
        expect(result.output).toContain('Agent execution failed');
    });
});
