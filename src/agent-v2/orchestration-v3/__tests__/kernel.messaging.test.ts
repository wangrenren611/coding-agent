import { describe, expect, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import type {
    AgentProfileV2,
    AgentRuntimeV2,
    ExecuteCommandV2,
    RunHandleV2,
    RunRecordV2,
    RuntimeEventV2,
    RuntimeRunStatus,
} from '../../orchestration-v2/types';
import { OrchestratorKernelV3 } from '../kernel';

class RecordingRuntimeV3 implements AgentRuntimeV2 {
    private readonly profiles = new Map<string, AgentProfileV2>();
    private readonly runs = new Map<string, RunRecordV2>();
    private readonly subscribers = new Map<string, Set<(event: RuntimeEventV2) => void>>();
    private readonly sessionAgents = new Map<string, string>();
    private sequence = 0;

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
        return Array.from(this.profiles.values()).map((profile) => ({ ...profile }));
    }

    getAgentIdBySession(sessionId: string): string | undefined {
        return this.sessionAgents.get(sessionId);
    }

    async execute(command: ExecuteCommandV2): Promise<RunHandleV2> {
        this.sequence += 1;
        const runId = `run-${this.sequence}-${command.agentId}`;
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
        this.completeRun(runId, 'aborted');
    }

    stream(runId: string, listener: (event: RuntimeEventV2) => void): () => void {
        const set = this.subscribers.get(runId) || new Set<(event: RuntimeEventV2) => void>();
        set.add(listener);
        this.subscribers.set(runId, set);
        return () => {
            const current = this.subscribers.get(runId);
            if (!current) return;
            current.delete(listener);
            if (current.size === 0) {
                this.subscribers.delete(runId);
            }
        };
    }

    async status(runId: string): Promise<RunRecordV2 | undefined> {
        const run = this.runs.get(runId);
        return run ? { ...run } : undefined;
    }

    completeRun(
        runId: string,
        status: Extract<RuntimeRunStatus, 'completed' | 'failed' | 'aborted'>,
        output?: string
    ): void {
        const current = this.runs.get(runId);
        if (!current) return;

        const patch: Partial<RunRecordV2> =
            status === 'completed'
                ? { status, output, finishedAt: Date.now() }
                : { status, error: output || `${status}`, finishedAt: Date.now() };
        this.runs.set(runId, {
            ...current,
            ...patch,
        });

        const eventType = status === 'completed' ? 'run.completed' : status === 'failed' ? 'run.failed' : 'run.aborted';
        const listeners = this.subscribers.get(runId);
        if (!listeners || listeners.size === 0) return;
        const event: RuntimeEventV2 = {
            eventId: uuid(),
            timestamp: Date.now(),
            type: eventType,
            runId,
            agentId: current.agentId,
            payload: status === 'completed' ? { output } : { error: output },
        };
        for (const listener of listeners) {
            listener(event);
        }
    }
}

async function waitFor<T>(
    fn: () => T | undefined,
    timeoutMs: number = 1000,
    pollMs: number = 20
): Promise<T | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = fn();
        if (value !== undefined) return value;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return fn();
}

describe('OrchestratorKernelV3 messaging', () => {
    it('supports send -> receive -> ack flow', () => {
        const runtime = new RecordingRuntimeV3();
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
                reviewer: {
                    role: 'reviewer',
                    systemPrompt: 'reviewer',
                    provider: {} as never,
                },
            },
        });

        const sent = kernel.sendMessage({
            fromAgentId: 'reviewer',
            toAgentId: 'coder',
            topic: 'bug-report',
            payload: { bug: 'price mismatch' },
            correlationId: 'goal-1',
        });

        const received = kernel.receiveMessages('coder', { limit: 10, leaseMs: 5000 });
        expect(received).toHaveLength(1);
        expect(received[0]?.messageId).toBe(sent.messageId);
        expect(received[0]?.status).toBe('in_flight');

        const acked = kernel.ackMessage('coder', sent.messageId);
        expect(acked).toBe(true);

        const next = kernel.receiveMessages('coder', { limit: 10 });
        expect(next).toHaveLength(0);
    });

    it('moves message to dead letters when max attempts exceeded', () => {
        const runtime = new RecordingRuntimeV3();
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
                reviewer: {
                    role: 'reviewer',
                    systemPrompt: 'reviewer',
                    provider: {} as never,
                },
            },
        });

        const sent = kernel.sendMessage({
            fromAgentId: 'reviewer',
            toAgentId: 'coder',
            topic: 'bug-report',
            payload: { bug: 'coupon duplicated' },
            correlationId: 'goal-2',
            maxAttempts: 1,
        });

        const received = kernel.receiveMessages('coder', { limit: 1, leaseMs: 1000 });
        expect(received).toHaveLength(1);

        const nacked = kernel.nackMessage('coder', sent.messageId, { error: 'cannot parse' });
        expect(nacked.deadLettered).toBe(true);
        expect(nacked.requeued).toBe(false);

        const dead = kernel.listDeadLetters('coder', 10);
        expect(dead).toHaveLength(1);
        expect(dead[0]?.messageId).toBe(sent.messageId);
    });

    it('pushes child terminal status to parent mailbox automatically', async () => {
        const runtime = new RecordingRuntimeV3();
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
        const childRun = await kernel.dispatch({
            agentId: 'coder',
            parentRunId: controllerRun.runId,
            input: 'implement checkout',
        });

        runtime.completeRun(childRun.runId, 'completed', 'checkout done');

        const delivered = await waitFor(() => {
            const messages = kernel.receiveMessages('controller', { limit: 10, leaseMs: 3000 });
            return messages.length > 0 ? messages[0] : undefined;
        });
        expect(delivered).toBeTruthy();
        expect(delivered?.topic).toBe('child-task-completed');
        expect(delivered?.runId).toBe(childRun.runId);
        expect(delivered?.payload?.status).toBe('completed');
        expect(delivered?.payload?.output).toBe('checkout done');
    });

    it('returns child progress snapshot when wait times out', async () => {
        const runtime = new RecordingRuntimeV3();
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

        const controllerRun = await kernel.execute('goal');
        const childRun = await kernel.dispatch({
            agentId: 'coder',
            parentRunId: controllerRun.runId,
            input: 'long task',
        });

        const waited = await kernel.waitForMessages('controller', {
            waitMs: 50,
            pollIntervalMs: 10,
            parentRunId: controllerRun.runId,
            includeChildProgressOnTimeout: true,
        });
        expect(waited.timedOut).toBe(true);
        expect(waited.messages).toHaveLength(0);
        expect(waited.childProgress?.some((item) => item.runId === childRun.runId && item.status === 'running')).toBe(
            true
        );
    });

    it('injects v3 messaging tools into agents', () => {
        const runtime = new RecordingRuntimeV3();
        const kernel = new OrchestratorKernelV3({
            runtime,
            controllerId: 'controller',
            agentsConfigs: {
                controller: {
                    role: 'controller',
                    systemPrompt: 'controller',
                    provider: {} as never,
                },
                reviewer: {
                    role: 'reviewer',
                    systemPrompt: 'reviewer',
                    provider: {} as never,
                },
            },
        });

        const controller = runtime.getAgent('controller');
        const reviewer = runtime.getAgent('reviewer');

        expect(controller?.toolRegistry?.hasTool('agent_send_message')).toBe(true);
        expect(controller?.toolRegistry?.hasTool('agent_receive_messages')).toBe(true);
        expect(controller?.toolRegistry?.hasTool('agent_wait_for_messages')).toBe(true);
        expect(controller?.toolRegistry?.hasTool('agent_ack_messages')).toBe(true);
        expect(controller?.toolRegistry?.hasTool('agent_nack_message')).toBe(true);
        expect(reviewer?.toolRegistry?.hasTool('agent_list_dead_letters')).toBe(true);

        void kernel;
    });
});
