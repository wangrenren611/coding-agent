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
import { AgentGetStatusToolV3 } from '../status-tool';

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

describe('OrchestratorKernelV3 status capability', () => {
    it('injects agent_get_status tool and allows controller to query child runs', async () => {
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

        const controllerProfile = runtime.getAgent('controller');
        expect(controllerProfile?.toolRegistry?.hasTool('agent_get_status')).toBe(true);

        const controllerRun = await kernel.execute('start goal');
        const childRun = await kernel.dispatch({
            agentId: 'coder',
            parentRunId: controllerRun.runId,
            input: 'implement task',
        });

        const runs = await kernel.queryRuns({
            parentAgentId: 'controller',
        });
        expect(runs.some((item) => item.runId === childRun.runId)).toBe(true);

        const statusTool = new AgentGetStatusToolV3(runtime, {
            queryRuns: (query) => kernel.queryRuns(query),
            getAgentRole: (agentId) => runtime.getAgent(agentId)?.role,
        });

        const result = await statusTool.execute(
            {},
            {
                environment: 'test',
                platform: process.platform,
                time: new Date().toISOString(),
                workingDirectory: process.cwd(),
                sessionId: 'session-controller',
            }
        );
        expect(result.success).toBe(true);
        expect(String(result.output || '')).toContain(childRun.runId);
    });
});
