import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LLMProvider } from '../../../providers';
import { LLMBadRequestError } from '../../../providers/types/errors';
import type { LLMGenerateOptions, LLMRequestMessage, LLMResponse, ToolCall } from '../../../providers';
import type { ToolContext } from '../base';
import { TestEnvironment } from './test-utils';
import { createMemoryManager } from '../../memory';
import type { IMemoryManager } from '../../memory';
import { ToolRegistry } from '../registry';
import {
    SubagentType,
    TaskCreateTool,
    TaskGetTool,
    TaskListTool,
    TaskOutputTool,
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

class ModelCaptureProvider extends MockProvider {
    readonly requestedModels: string[] = [];

    override async generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> {
        if (options?.model) {
            this.requestedModels.push(options.model);
        }
        return super.generate(messages, options);
    }
}

// Type helpers for metadata access
interface TaskCreateMetadata {
    id: string;
    subject: string;
    description: string;
    activeForm: string;
    status: string;
    owner: string;
    metadata?: Record<string, unknown>;
    blocks: string[];
    blockedBy: string[];
    createdAt: string;
    updatedAt: string;
}

interface TaskGetMetadata {
    id: string;
    subject: string;
    description: string;
    activeForm: string;
    status: string;
    owner: string;
    metadata?: Record<string, unknown>;
    blocks: string[];
    blockedBy: string[];
    createdAt: string;
    updatedAt: string;
}

interface TaskListMetadata {
    count: number;
    tasks: Array<{
        id: string;
        subject: string;
        description: string;
        activeForm: string;
        status: string;
        owner: string;
        blocks: string[];
        blockedBy: string[];
    }>;
}

interface TaskToolMetadata {
    task_id: string;
    status: string;
    parent_session_id?: string;
    child_session_id?: string;
    subagent_type?: string;
    model?: string;
    model_hint?: string;
    model_resolved?: string | null;
    model_applied?: boolean;
    resume?: string;
    storage?: string;
    error?: string;
    timed_out?: boolean;
}

interface TaskStopMetadata {
    status: string;
}

interface TaskOutputMetadata {
    task_id: string;
    status: string;
    timed_out?: boolean;
    error?: string;
}

describe('Task tools', () => {
    const MANAGED_TASK_PARENT_ID = '__task_tool_managed__';
    let env: TestEnvironment;
    let sessionId: string;
    let memoryManager: IMemoryManager;
    let toolContext: ToolContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withContext = <T extends { execute: (...args: any[]) => any }>(tool: T): T => {
        const rawExecute = tool.execute.bind(tool);
        (tool as unknown as { execute: (args?: unknown) => unknown }).execute = (args?: unknown) =>
            rawExecute(args as never, toolContext);
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
            workingDirectory: process.cwd(),
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

        const createAMeta = createA.metadata as TaskCreateMetadata | undefined;
        const createBMeta = createB.metadata as TaskCreateMetadata | undefined;

        expect(createA.success).toBe(true);
        expect(createB.success).toBe(true);
        expect(createAMeta?.id).toBe('1');
        expect(createBMeta?.id).toBe('2');

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
        const task1Meta = task1.metadata as TaskGetMetadata | undefined;
        const task2Meta = task2.metadata as TaskGetMetadata | undefined;

        expect(task1.success).toBe(true);
        expect(task2.success).toBe(true);
        expect(task1Meta?.blocks).toContain('2');
        expect(task2Meta?.blockedBy).toContain('1');

        const step1 = await update.execute({ taskId: '1', status: 'in_progress' });
        const step2 = await update.execute({ taskId: '1', status: 'completed' });
        expect(step1.success).toBe(true);
        expect(step2.success).toBe(true);

        const listed = await list.execute();
        const listedMeta = listed.metadata as TaskListMetadata | undefined;

        expect(listed.success).toBe(true);
        expect(listedMeta?.count).toBe(2);
        const listedTask2 = listedMeta?.tasks.find((t) => t.id === '2');
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

        const ids = results.map((result) => (result.metadata as TaskCreateMetadata | undefined)?.id as string);
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
        const listedMeta = listed.metadata as TaskListMetadata | undefined;

        expect(listed.success).toBe(true);
        expect(listedMeta?.count).toBe(0);

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
            subagent_type: SubagentType.Explore as SubagentType,
            run_in_background: false,
        });

        const resultMeta = result.metadata as TaskToolMetadata | undefined;

        expect(result.success).toBe(true);
        expect(resultMeta?.storage).toBe('memory_manager');
        const runId = resultMeta?.task_id as string;
        const childSessionId = resultMeta?.child_session_id as string;
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
            subagent_type: SubagentType.Explore as SubagentType,
            run_in_background: true,
        });

        const startedMeta = started.metadata as TaskToolMetadata | undefined;

        expect(started.success).toBe(true);
        const taskId = startedMeta?.task_id as string;
        expect(taskId).toBeTruthy();
        expect(startedMeta?.status).toBe('queued');
        expect(startedMeta?.storage).toBe('memory_manager');

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
            subagent_type: SubagentType.Explore as SubagentType,
            run_in_background: true,
        });

        const startedMeta = started.metadata as TaskToolMetadata | undefined;
        const taskId = startedMeta?.task_id as string;

        const stopped = await stopTool.execute({ task_id: taskId });
        const stoppedMeta = stopped.metadata as TaskStopMetadata | undefined;

        expect(stopped.success).toBe(true);
        expect(['cancelling', 'cancelled', 'completed']).toContain(stoppedMeta?.status);

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
            subagent_type: SubagentType.Explore as SubagentType,
            run_in_background: true,
        });

        const startedMeta = started.metadata as TaskToolMetadata | undefined;
        const taskId = startedMeta?.task_id as string;

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
                            subagent_type: SubagentType.Explore,
                            run_in_background: false,
                        }),
                    },
                } as ToolCall,
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
            subagent_type: SubagentType.Explore as SubagentType,
            run_in_background: false,
        });

        const resultMeta = result.metadata as TaskToolMetadata | undefined;

        expect(result.success).toBe(false);
        expect(resultMeta?.status).toBe('failed');
        expect(resultMeta?.error).toBe('LLM_REQUEST_FAILED');
        expect(result.output).toContain('Agent execution failed');
    });

    it('should apply model hint mapping from env and pass resolved model to provider', async () => {
        const previous = process.env.TASK_SUBAGENT_MODEL_OPUS;
        process.env.TASK_SUBAGENT_MODEL_OPUS = 'mock-opus-model';

        try {
            const provider = new ModelCaptureProvider('model hint routed');
            const taskTool = withContext(new TaskTool(provider));
            const result = await taskTool.execute({
                description: 'Model routing',
                prompt: 'Route by model hint',
                subagent_type: SubagentType.Explore as SubagentType,
                model: 'opus',
                run_in_background: false,
            });

            const resultMeta = result.metadata as TaskToolMetadata | undefined;

            expect(result.success).toBe(true);
            expect(provider.requestedModels).toContain('mock-opus-model');
            expect(resultMeta?.model).toBe('opus');
            expect(resultMeta?.model_hint).toBe('opus');
            expect(resultMeta?.model_resolved).toBe('mock-opus-model');
            expect(resultMeta?.model_applied).toBe(true);
        } finally {
            if (previous === undefined) {
                delete process.env.TASK_SUBAGENT_MODEL_OPUS;
            } else {
                process.env.TASK_SUBAGENT_MODEL_OPUS = previous;
            }
        }
    });

    it('should keep model_applied false when no model mapping is available', async () => {
        const previous = process.env.TASK_SUBAGENT_MODEL_HAIKU;
        delete process.env.TASK_SUBAGENT_MODEL_HAIKU;

        try {
            const provider = new ModelCaptureProvider('no mapping');
            const taskTool = withContext(new TaskTool(provider));
            const result = await taskTool.execute({
                description: 'Model no-op',
                prompt: 'No model mapping expected',
                subagent_type: SubagentType.Explore as SubagentType,
                model: 'haiku',
                run_in_background: false,
            });

            const resultMeta = result.metadata as TaskToolMetadata | undefined;

            expect(result.success).toBe(true);
            expect(provider.requestedModels).toHaveLength(0);
            expect(resultMeta?.model).toBe('haiku');
            expect(resultMeta?.model_hint).toBe('haiku');
            expect(resultMeta?.model_resolved).toBeNull();
            expect(resultMeta?.model_applied).toBe(false);
        } finally {
            if (previous !== undefined) {
                process.env.TASK_SUBAGENT_MODEL_HAIKU = previous;
            }
        }
    });
});

describe('TaskOutputTool', () => {
    let env: TestEnvironment;
    let sessionId: string;
    let memoryManager: IMemoryManager;
    let toolContext: ToolContext;

    beforeEach(async () => {
        env = new TestEnvironment('task-output-tool');
        await env.setup();
        sessionId = `test-session-output-${Date.now()}`;
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: `${env.getTestDir()}/agent-memory`,
        });
        await memoryManager.initialize();
        toolContext = {
            environment: 'test',
            platform: 'test',
            time: new Date().toISOString(),
            workingDirectory: env.workingDir,
            sessionId,
            memoryManager,
        };
    });

    afterEach(async () => {
        await memoryManager.close();
        await env.teardown();
    });

    it('should return error for non-existent task', async () => {
        const tool = new TaskOutputTool();
        const result = await tool.execute({ task_id: 'non-existent-task', block: true, timeout: 30000 }, toolContext);

        const resultMeta = result.metadata as TaskOutputMetadata | undefined;

        expect(result.success).toBe(false);
        expect(resultMeta?.error).toBe('TASK_NOT_FOUND');
        expect(result.output).toContain('Task not found');
    });

    it('should get output from completed background task', async () => {
        // 首先创建一个后台任务
        const taskTool = new TaskTool(new MockProvider('task output result'), env.workingDir);
        const createResult = await taskTool.execute(
            {
                description: 'Background test task',
                prompt: 'Run test',
                subagent_type: SubagentType.Explore as SubagentType,
                run_in_background: true,
            },
            toolContext
        );

        const createResultMeta = createResult.metadata as TaskToolMetadata | undefined;

        expect(createResult.success).toBe(true);
        const taskId = createResultMeta?.task_id as string;
        expect(taskId).toBeDefined();

        // 等待任务完成
        await waitForSubTaskRunStatus(memoryManager, taskId, ['completed', 'failed'], 5000);

        // 使用 TaskOutputTool 获取输出
        const outputTool = new TaskOutputTool();
        const outputResult = await outputTool.execute({ task_id: taskId, block: false, timeout: 30000 }, toolContext);

        const outputResultMeta = outputResult.metadata as TaskOutputMetadata | undefined;

        expect(outputResultMeta?.task_id).toBe(taskId);
        expect(outputResultMeta?.status).toBe('completed');
    });

    it('should support block=false for non-blocking status check', async () => {
        // 创建一个长时间运行的后台任务
        const taskTool = new TaskTool(new MockProvider('slow result', 10000), env.workingDir);
        const createResult = await taskTool.execute(
            {
                description: 'Long running task',
                prompt: 'Run slow test',
                subagent_type: SubagentType.Explore as SubagentType,
                run_in_background: true,
            },
            toolContext
        );

        const createResultMeta = createResult.metadata as TaskToolMetadata | undefined;
        const taskId = createResultMeta?.task_id as string;

        // 立即检查状态（非阻塞）
        const outputTool = new TaskOutputTool();
        const outputResult = await outputTool.execute({ task_id: taskId, block: false, timeout: 1000 }, toolContext);

        const outputResultMeta = outputResult.metadata as TaskOutputMetadata | undefined;

        // 任务应该在运行中或已完成（取决于执行速度）
        expect(outputResultMeta?.task_id).toBe(taskId);
        expect(['queued', 'running', 'completed']).toContain(outputResultMeta?.status);
    });

    it('should return timed_out when timeout exceeded with block=true', async () => {
        // 创建一个长时间运行的后台任务
        const taskTool = new TaskTool(new MockProvider('very slow result', 30000), env.workingDir);
        const createResult = await taskTool.execute(
            {
                description: 'Very long running task',
                prompt: 'Run very slow test',
                subagent_type: SubagentType.Explore as SubagentType,
                run_in_background: true,
            },
            toolContext
        );

        const createResultMeta = createResult.metadata as TaskToolMetadata | undefined;
        const taskId = createResultMeta?.task_id as string;

        // 使用短超时进行阻塞获取
        const outputTool = new TaskOutputTool();
        const outputResult = await outputTool.execute({ task_id: taskId, block: true, timeout: 1000 }, toolContext);

        const outputResultMeta = outputResult.metadata as TaskOutputMetadata | undefined;

        // 应该返回超时状态
        expect(outputResultMeta?.task_id).toBe(taskId);
        expect(outputResultMeta?.timed_out).toBe(true);
        expect(['queued', 'running']).toContain(outputResultMeta?.status);
    });
});
