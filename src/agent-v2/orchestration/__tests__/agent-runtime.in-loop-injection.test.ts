import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../session/types';
import { AgentRuntimeService } from '../agent-runtime';
import { InMemoryEventStream } from '../event-stream';
import { InMemoryStateStore } from '../state-store';

type MockAgentOptions = {
    loopBoundaryHook?: (context: {
        loopCount: number;
        sessionId: string;
        appendUserMessage: (content: unknown) => void;
    }) => Promise<void> | void;
};

const appendedContents: unknown[] = [];

vi.mock('../../agent/agent', () => {
    class AgentMock {
        private readonly options: MockAgentOptions;

        constructor(options: MockAgentOptions) {
            this.options = options;
        }

        abort = vi.fn();
        close = vi.fn().mockResolvedValue(undefined);
        getSessionId = vi.fn().mockReturnValue('mock-session-id');

        executeWithResult = vi.fn(async () => {
            await this.options.loopBoundaryHook?.({
                loopCount: 1,
                sessionId: 'mock-session-id',
                appendUserMessage: (content: unknown) => {
                    appendedContents.push(content);
                },
            });

            const finalMessage: Message = {
                messageId: 'msg-final',
                role: 'assistant',
                content: [{ type: 'text', text: 'ok' }],
            };

            return {
                status: 'completed',
                finalMessage,
                loopCount: 1,
                retryCount: 0,
                sessionId: 'mock-session-id',
            };
        });
    }

    return {
        Agent: AgentMock,
    };
});

async function waitUntilCompleted(
    runtime: AgentRuntimeService,
    runId: string,
    timeoutMs: number = 5000
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const run = await runtime.status(runId);
        if (run?.status === 'completed') {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`run did not complete in time: ${runId}`);
}

describe('AgentRuntimeService in-loop message injection', () => {
    beforeEach(() => {
        appendedContents.length = 0;
    });

    it('injects queued messages at loop boundary and acks them in the same run', async () => {
        const stateStore = new InMemoryStateStore();
        const eventStream = new InMemoryEventStream();
        const runtime = new AgentRuntimeService(stateStore, eventStream, {
            inLoopMessageInjection: {
                enabled: true,
                receiveLimit: 10,
                leaseMs: 10_000,
            },
        });

        stateStore.saveAgentProfile({
            agentId: 'coder',
            role: 'coder',
            systemPrompt: 'coder prompt',
            provider: {} as never,
        });

        stateStore.enqueueMessage('coder', {
            messageId: 'mail-1',
            timestamp: Date.now(),
            fromAgentId: 'reviewer',
            toAgentId: 'coder',
            topic: 'bug-report',
            payload: { bug: 'cart total mismatch' },
        });

        const handle = await runtime.execute({
            agentId: 'coder',
            input: '请执行任务',
        });
        await waitUntilCompleted(runtime, handle.runId);

        expect(appendedContents.length).toBeGreaterThan(0);
        const injectedText = String(appendedContents[0] ?? '');
        expect(injectedText).toContain('Inter-agent messages injected at loop boundary');
        expect(injectedText).toContain('mail-1');
        expect(injectedText).toContain('bug-report');

        const remaining = stateStore.receiveMessages('coder', { limit: 10 });
        expect(remaining).toHaveLength(0);

        const ackEvents = eventStream
            .replay({ runId: handle.runId, types: ['agent.message.acked'] })
            .filter((event) => event.payload && (event.payload as { mode?: string }).mode === 'in-loop-injection');
        expect(ackEvents).toHaveLength(1);
        expect(ackEvents[0]?.payload?.messageId).toBe('mail-1');
    });
});
