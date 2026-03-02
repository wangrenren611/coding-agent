import { describe, expect, it } from 'vitest';
import type {
    AgentProfileV2,
    AgentRuntimeV2,
    ExecuteCommandV2,
    RunHandleV2,
    RunRecordV2,
    RuntimeEventV2,
} from '../types';
import { OrchestratorKernelV2 } from '../kernel';

class RecordingRuntime implements AgentRuntimeV2 {
    private readonly profiles = new Map<string, AgentProfileV2>();

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
        return {
            runId: `run-${command.agentId}`,
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

    async status(_runId: string): Promise<RunRecordV2 | undefined> {
        return undefined;
    }
}

describe('OrchestratorKernelV2 messaging', () => {
    it('supports send -> receive -> ack flow', () => {
        const runtime = new RecordingRuntime();
        const kernel = new OrchestratorKernelV2({
            runtime,
            provider: {} as never,
            controller: {
                systemPrompt: 'controller',
            },
            templates: [
                {
                    role: 'reviewer',
                    systemPrompt: 'review',
                },
                {
                    role: 'coder',
                    systemPrompt: 'code',
                },
            ],
        });

        const sent = kernel.sendMessage({
            fromAgentId: 'template-reviewer',
            toAgentId: 'template-coder',
            topic: 'bug-report',
            payload: { bug: 'price mismatch' },
            correlationId: 'goal-1',
        });

        const received = kernel.receiveMessages('template-coder', { limit: 10, leaseMs: 5_000 });
        expect(received).toHaveLength(1);
        expect(received[0]?.messageId).toBe(sent.messageId);
        expect(received[0]?.status).toBe('in_flight');

        const acked = kernel.ackMessage('template-coder', sent.messageId);
        expect(acked).toBe(true);

        const next = kernel.receiveMessages('template-coder', { limit: 10 });
        expect(next).toHaveLength(0);
    });

    it('moves message to dead letters when max attempts exceeded', () => {
        const runtime = new RecordingRuntime();
        const kernel = new OrchestratorKernelV2({
            runtime,
            provider: {} as never,
            controller: {
                systemPrompt: 'controller',
            },
            templates: [
                {
                    role: 'reviewer',
                    systemPrompt: 'review',
                },
                {
                    role: 'coder',
                    systemPrompt: 'code',
                },
            ],
        });

        const sent = kernel.sendMessage({
            fromAgentId: 'template-reviewer',
            toAgentId: 'template-coder',
            topic: 'bug-report',
            payload: { bug: 'coupon duplicated' },
            correlationId: 'goal-2',
            maxAttempts: 1,
        });

        const received = kernel.receiveMessages('template-coder', { limit: 1, leaseMs: 1_000 });
        expect(received).toHaveLength(1);

        const nacked = kernel.nackMessage('template-coder', sent.messageId, { error: 'cannot parse' });
        expect(nacked.deadLettered).toBe(true);
        expect(nacked.requeued).toBe(false);

        const dead = kernel.listDeadLetters('template-coder', 10);
        expect(dead).toHaveLength(1);
        expect(dead[0]?.messageId).toBe(sent.messageId);
    });

    it('injects messaging tools to registered agent profiles', () => {
        const runtime = new RecordingRuntime();
        const kernel = new OrchestratorKernelV2({
            runtime,
            provider: {} as never,
            controller: {
                agentId: 'controller',
                systemPrompt: 'controller',
            },
            templates: [
                {
                    role: 'reviewer',
                    systemPrompt: 'review',
                },
            ],
        });

        const controller = runtime.getAgent('controller');
        const reviewer = runtime.getAgent('template-reviewer');

        expect(controller?.toolRegistry?.hasTool('agent_send_message')).toBe(true);
        expect(controller?.toolRegistry?.hasTool('agent_receive_messages')).toBe(true);
        expect(controller?.toolRegistry?.hasTool('agent_ack_messages')).toBe(true);
        expect(controller?.toolRegistry?.hasTool('agent_nack_message')).toBe(true);
        expect(reviewer?.toolRegistry?.hasTool('agent_list_dead_letters')).toBe(true);

        void kernel;
    });
});
