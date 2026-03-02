import { describe, expect, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import { OrchestratorKernelV2 } from '../kernel';
import type {
    AgentProfileV2,
    AgentRuntimeV2,
    ExecuteCommandV2,
    RunHandleV2,
    RunRecordV2,
    RuntimeEventV2,
} from '../types';

class MockRuntime implements AgentRuntimeV2 {
    public readonly calls: ExecuteCommandV2[] = [];
    private readonly profiles = new Map<string, AgentProfileV2>();
    private readonly runs = new Map<string, RunRecordV2>();

    upsertAgent(profile: AgentProfileV2): void {
        this.profiles.set(profile.agentId, { ...profile });
    }

    getAgent(agentId: string): AgentProfileV2 | undefined {
        const profile = this.profiles.get(agentId);
        return profile ? { ...profile } : undefined;
    }

    listAgents(): AgentProfileV2[] {
        return Array.from(this.profiles.values()).map((profile) => ({ ...profile }));
    }

    getAgentIdBySession(_sessionId: string): string | undefined {
        return undefined;
    }

    async execute(command: ExecuteCommandV2): Promise<RunHandleV2> {
        if (command.profile) {
            this.upsertAgent(command.profile);
        }
        const profile = this.profiles.get(command.agentId);
        if (!profile) {
            throw new Error(`Agent not found: ${command.agentId}`);
        }

        this.calls.push(command);
        const runId = uuid();
        const now = Date.now();
        const mode = String(command.metadata?.mode || '');
        const output = this.buildOutput(profile, mode, command.metadata);

        this.runs.set(runId, {
            runId,
            agentId: command.agentId,
            status: 'completed',
            input: command.input,
            output,
            createdAt: now,
            startedAt: now,
            finishedAt: now,
            metadata: command.metadata,
        });

        return {
            runId,
            agentId: command.agentId,
            status: 'completed',
        };
    }

    async abort(): Promise<void> {
        return undefined;
    }

    stream(_runId: string, _listener: (event: RuntimeEventV2) => void): () => void {
        return () => undefined;
    }

    async status(runId: string): Promise<RunRecordV2 | undefined> {
        const run = this.runs.get(runId);
        return run ? { ...run } : undefined;
    }

    private buildOutput(profile: AgentProfileV2, mode: string, metadata?: Record<string, unknown>): string {
        if (profile.role === 'controller' && mode === 'planner') {
            return JSON.stringify(
                {
                    summary: '博客系统任务拆解',
                    tasks: [
                        {
                            id: 'design-home',
                            title: '首页设计',
                            role: 'ui-designer',
                            description: '输出首页布局规范',
                            dependsOn: [],
                            acceptanceCriteria: ['有线框图'],
                        },
                        {
                            id: 'frontend-home',
                            title: '首页前端实现',
                            role: 'frontend-coder',
                            description: '实现首页结构与交互',
                            dependsOn: ['design-home'],
                            acceptanceCriteria: ['页面可运行'],
                        },
                        {
                            id: 'backend-posts',
                            title: '文章接口实现',
                            role: 'backend-coder',
                            description: '实现文章 API',
                            dependsOn: [],
                            acceptanceCriteria: ['返回正确数据'],
                        },
                        {
                            id: 'review-release',
                            title: '联调评审',
                            role: 'reviewer',
                            description: '输出风险与上线建议',
                            dependsOn: ['frontend-home', 'backend-posts'],
                            acceptanceCriteria: ['问题清单完整'],
                        },
                    ],
                },
                null,
                2
            );
        }

        if (mode === 'agent-prompt-generation') {
            return `dynamic prompt for ${String(metadata?.role || 'unknown')}`;
        }

        if (mode === 'goal-summary') {
            return 'goal summary';
        }

        if (mode === 'task') {
            return `task-${String(metadata?.taskId || 'unknown')}-done`;
        }

        return 'ok';
    }
}

describe('OrchestratorKernelV2', () => {
    it('plans goal, spawns dynamic role, and executes dependency-aware tasks', async () => {
        const runtime = new MockRuntime();
        const kernel = new OrchestratorKernelV2({
            runtime,
            provider: {} as never,
            controller: {
                agentId: 'controller',
                systemPrompt: 'controller',
            },
            templates: [
                {
                    role: 'frontend-coder',
                    systemPrompt: 'frontend',
                },
                {
                    role: 'backend-coder',
                    systemPrompt: 'backend',
                },
                {
                    role: 'reviewer',
                    systemPrompt: 'review',
                },
            ],
            scheduler: {
                maxConcurrentTasks: 1,
                maxTaskRetries: 0,
                taskTimeoutMs: 30_000,
                failFast: false,
            },
        });

        const result = await kernel.execute('实现一个博客系统');

        expect(result.status).toBe('completed');
        expect(result.plan.tasks).toHaveLength(4);
        expect(result.tasks).toHaveLength(4);

        const taskRuns = runtime.calls.filter((call) => call.metadata?.mode === 'task');
        expect(taskRuns.map((call) => call.metadata?.taskId)).toEqual([
            'design-home',
            'frontend-home',
            'backend-posts',
            'review-release',
        ]);

        const dynamicTask = result.tasks.find((task) => task.taskId === 'design-home');
        expect(dynamicTask?.agentId.startsWith('dynamic-')).toBe(true);
    });
});
