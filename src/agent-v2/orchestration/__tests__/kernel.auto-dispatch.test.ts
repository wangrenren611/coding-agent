import { describe, expect, it } from 'vitest';
import { InMemoryEventStream } from '../event-stream';
import { OrchestratorKernel } from '../kernel';
import { DefaultPolicyEngine } from '../policy-engine';
import { InMemoryStateStore } from '../state-store';
import type { AgentRuntime, ExecuteCommand, RunHandle } from '../types';

class RecordingRuntime implements AgentRuntime {
    public readonly calls: ExecuteCommand[] = [];

    async execute(command: ExecuteCommand): Promise<RunHandle> {
        this.calls.push(command);
        return {
            runId: `run-${this.calls.length}`,
            agentId: command.agentId,
            status: 'queued',
        };
    }

    async abort(): Promise<void> {
        return undefined;
    }

    stream(): () => void {
        return () => undefined;
    }

    async status() {
        return undefined;
    }
}

describe('OrchestratorKernel auto dispatch', () => {
    it('dispatches next round automatically when message event arrives', async () => {
        const stateStore = new InMemoryStateStore();
        const eventStream = new InMemoryEventStream();
        const policyEngine = new DefaultPolicyEngine(stateStore);
        const runtime = new RecordingRuntime();

        const kernel = new OrchestratorKernel({
            runtime,
            stateStore,
            policyEngine,
            eventStream,
            autoDispatch: {
                enabled: true,
                debounceMs: 0,
                inputBuilder: (trigger) => `auto-dispatch for ${trigger.toAgentId}`,
            },
        });

        kernel.registerAgent({
            agentId: 'sender',
            role: 'sender',
            systemPrompt: 'sender',
            provider: {} as never,
        });
        kernel.registerAgent({
            agentId: 'receiver',
            role: 'receiver',
            systemPrompt: 'receiver',
            provider: {} as never,
        });

        kernel.sendMessage({
            fromAgentId: 'sender',
            toAgentId: 'receiver',
            topic: 'test-topic',
            payload: { hello: 'world' },
        });

        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(runtime.calls.length).toBe(1);
        expect(runtime.calls[0]?.agentId).toBe('receiver');
        expect(runtime.calls[0]?.metadata).toMatchObject({
            autoDispatch: true,
        });

        kernel.close();
    });
});
