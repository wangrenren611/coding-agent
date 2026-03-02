import { describe, expect, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import type {
    AgentProfileV2,
    AgentRuntimeV2,
    ExecuteCommandV2,
    RunHandleV2,
    RunRecordV2,
    RuntimeEventV2,
} from '../../orchestration-v2/types';
import { OrchestratorKernelV3 } from '../kernel';
import { AgentDispatchTaskToolV3 } from '../dispatch-tool';

class MockRuntimeV3 implements AgentRuntimeV2 {
    private readonly profiles = new Map<string, AgentProfileV2>();
    private readonly runs = new Map<string, RunRecordV2>();
    private readonly sessionAgents = new Map<string, string>();

    upsertAgent(profile: AgentProfileV2): void {
        this.profiles.set(profile.agentId, { ...profile });
        const sessionId = profile.sessionId || `session-${profile.agentId}`;
        this.sessionAgents.set(sessionId, profile.agentId);
    }

    getAgent(agentId: string): AgentProfileV2 | undefined {
        const profile = this.profiles.get(agentId);
        return profile ? { ...profile } : undefined;
    }

    listAgents(): AgentProfileV2[] {
        return Array.from(this.profiles.values()).map((item) => ({ ...item }));
    }

    getAgentIdBySession(sessionId: string): string | undefined {
        return this.sessionAgents.get(sessionId);
    }

    async execute(command: ExecuteCommandV2): Promise<RunHandleV2> {
        const runId = uuid();
        this.runs.set(runId, {
            runId,
            agentId: command.agentId,
            parentRunId: command.parentRunId,
            status: 'running',
            input: command.input,
            createdAt: Date.now(),
            startedAt: Date.now(),
        });
        return {
            runId,
            agentId: command.agentId,
            status: 'running',
        };
    }

    async abort(runId: string): Promise<void> {
        const current = this.runs.get(runId);
        if (!current) return;
        this.runs.set(runId, {
            ...current,
            status: 'aborted',
            finishedAt: Date.now(),
        });
    }

    stream(_runId: string, _listener: (event: RuntimeEventV2) => void): () => void {
        return () => undefined;
    }

    async status(runId: string): Promise<RunRecordV2 | undefined> {
        const run = this.runs.get(runId);
        return run ? { ...run } : undefined;
    }
}

describe('OrchestratorKernelV3 dispatch tool', () => {
    it('injects agent_dispatch_task to controller only', () => {
        const runtime = new MockRuntimeV3();
        const kernel = new OrchestratorKernelV3({
            runtime,
            controllerId: 'controller',
            agentsConfigs: {
                controller: {
                    role: 'controller',
                    systemPrompt: 'controller',
                    provider: {} as never,
                },
                coder: {
                    role: 'coder',
                    systemPrompt: 'coder',
                    provider: {} as never,
                },
            },
        });

        const controller = runtime.getAgent('controller');
        const coder = runtime.getAgent('coder');

        expect(controller?.toolRegistry?.hasTool('agent_dispatch_task')).toBe(true);
        expect(coder?.toolRegistry?.hasTool('agent_dispatch_task')).toBe(false);

        void kernel;
    });

    it('allows controller to dispatch child run and auto-infers parentRunId', async () => {
        const runtime = new MockRuntimeV3();
        const kernel = new OrchestratorKernelV3({
            runtime,
            controllerId: 'controller',
            agentsConfigs: {
                controller: {
                    role: 'controller',
                    systemPrompt: 'controller',
                    provider: {} as never,
                },
                coder: {
                    role: 'coder',
                    systemPrompt: 'coder',
                    provider: {} as never,
                },
            },
        });

        const controllerRun = await kernel.execute('start goal');
        const tool = new AgentDispatchTaskToolV3(runtime, {
            dispatch: (command) => kernel.dispatch(command),
            queryRuns: (query) => kernel.queryRuns(query),
            hasAgent: (agentId) => Boolean(runtime.getAgent(agentId)),
            isControllerAgent: (agentId) => agentId === 'controller',
        });

        const result = await tool.execute(
            {
                agentId: 'coder',
                input: 'implement checkout',
            },
            {
                environment: 'test',
                platform: process.platform,
                time: new Date().toISOString(),
                workingDirectory: process.cwd(),
                sessionId: 'session-controller',
            }
        );

        expect(result.success).toBe(true);
        const meta = (result.metadata || {}) as { parentRunId?: string; childRunId?: string };
        expect(meta.parentRunId).toBe(controllerRun.runId);
        expect(typeof meta.childRunId).toBe('string');

        const children = await kernel.queryRuns({
            parentRunId: controllerRun.runId,
            agentId: 'coder',
            limit: 10,
        });
        expect(children.length).toBeGreaterThan(0);
    });
});
