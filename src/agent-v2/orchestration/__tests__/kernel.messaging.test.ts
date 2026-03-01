import { describe, expect, it } from 'vitest';
import { InMemoryEventStream } from '../event-stream';
import { OrchestratorKernel } from '../kernel';
import { DefaultPolicyEngine } from '../policy-engine';
import { InMemoryStateStore } from '../state-store';
import type { AgentRuntime } from '../types';

function createNoopRuntime(): AgentRuntime {
    return {
        execute: async (command) => ({
            runId: `run-${command.agentId}`,
            agentId: command.agentId,
            status: 'queued',
        }),
        abort: async () => undefined,
        stream: () => () => undefined,
        status: async () => undefined,
    };
}

describe('OrchestratorKernel messaging', () => {
    it('deduplicates message by idempotency key within dedup window', () => {
        const stateStore = new InMemoryStateStore();
        const eventStream = new InMemoryEventStream();
        const policyEngine = new DefaultPolicyEngine(stateStore);
        const kernel = new OrchestratorKernel({
            runtime: createNoopRuntime(),
            stateStore,
            policyEngine,
            eventStream,
            messageRuntime: {
                dedupWindowMs: 60_000,
            },
        });

        kernel.registerAgent({
            agentId: 'a',
            role: 'sender',
            systemPrompt: 'sender',
            provider: {} as never,
        });
        kernel.registerAgent({
            agentId: 'b',
            role: 'receiver',
            systemPrompt: 'receiver',
            provider: {} as never,
        });

        const first = kernel.sendMessage({
            fromAgentId: 'a',
            toAgentId: 'b',
            topic: 't1',
            idempotencyKey: 'idem-1',
            payload: { content: 'hello' },
        });
        const second = kernel.sendMessage({
            fromAgentId: 'a',
            toAgentId: 'b',
            topic: 't1',
            idempotencyKey: 'idem-1',
            payload: { content: 'hello again' },
        });

        expect(second.messageId).toBe(first.messageId);

        const received = kernel.receiveMailbox('b', { limit: 10, leaseMs: 5000 });
        expect(received).toHaveLength(1);
        expect(received[0]?.messageId).toBe(first.messageId);
    });

    it('keeps topic partition order while allowing other topic delivery', () => {
        const stateStore = new InMemoryStateStore();
        const eventStream = new InMemoryEventStream();
        const policyEngine = new DefaultPolicyEngine(stateStore);
        const kernel = new OrchestratorKernel({
            runtime: createNoopRuntime(),
            stateStore,
            policyEngine,
            eventStream,
            messageRuntime: {
                enforceTopicPartitionOrder: true,
                dedupWindowMs: 60_000,
            },
        });

        kernel.registerAgent({
            agentId: 'a',
            role: 'sender',
            systemPrompt: 'sender',
            provider: {} as never,
        });
        kernel.registerAgent({
            agentId: 'b',
            role: 'receiver',
            systemPrompt: 'receiver',
            provider: {} as never,
        });

        const now = Date.now();
        kernel.sendMessage({
            fromAgentId: 'a',
            toAgentId: 'b',
            topic: 'topic-a',
            visibleAt: now + 60_000,
            payload: { order: 1 },
        });
        kernel.sendMessage({
            fromAgentId: 'a',
            toAgentId: 'b',
            topic: 'topic-a',
            visibleAt: now,
            payload: { order: 2 },
        });
        kernel.sendMessage({
            fromAgentId: 'a',
            toAgentId: 'b',
            topic: 'topic-b',
            visibleAt: now,
            payload: { order: 1 },
        });

        const received = kernel.receiveMailbox('b', { limit: 10, leaseMs: 5000 });
        expect(received).toHaveLength(1);
        expect(received[0]?.topic).toBe('topic-b');
    });
});
