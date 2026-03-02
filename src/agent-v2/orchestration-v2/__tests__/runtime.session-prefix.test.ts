import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../session/types';
import { LocalAgentRuntimeV2 } from '../runtime';

let sessionCounter = 0;

type AgentMockOptions = {
    sessionId?: string;
};

vi.mock('../../agent/agent', () => {
    class AgentMock {
        private readonly sessionId: string;

        constructor(options: AgentMockOptions) {
            sessionCounter += 1;
            this.sessionId = options.sessionId || `mock-root-session-${sessionCounter}`;
        }

        abort = vi.fn();
        close = vi.fn().mockResolvedValue(undefined);
        getSessionId = vi.fn(() => this.sessionId);
        executeWithResult = vi.fn(async () => {
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
                sessionId: this.sessionId,
            };
        });
    }

    return {
        Agent: AgentMock,
    };
});

async function waitUntilCompleted(
    runtime: LocalAgentRuntimeV2,
    runId: string,
    timeoutMs: number = 5000
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const run = await runtime.status(runId);
        if (run?.status === 'completed') return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`run did not complete in time: ${runId}`);
}

describe('LocalAgentRuntimeV2 session prefixing', () => {
    beforeEach(() => {
        sessionCounter = 0;
    });

    it('prefixes child agent sessionId with main sessionId', async () => {
        const runtime = new LocalAgentRuntimeV2();
        runtime.upsertAgent({
            agentId: 'controller',
            role: 'controller',
            systemPrompt: 'controller',
            provider: {} as never,
        });
        runtime.upsertAgent({
            agentId: 'template-coder',
            role: 'coder',
            systemPrompt: 'coder',
            provider: {} as never,
        });

        const goalRunId = 'goal-001';
        const plannerHandle = await runtime.execute({
            agentId: 'controller',
            parentRunId: goalRunId,
            input: 'plan',
        });
        await waitUntilCompleted(runtime, plannerHandle.runId);
        const plannerRun = await runtime.status(plannerHandle.runId);
        const mainSessionId = plannerRun?.sessionId;
        expect(mainSessionId).toBeTruthy();

        const taskHandle1 = await runtime.execute({
            agentId: 'template-coder',
            parentRunId: goalRunId,
            input: 'task-1',
        });
        await waitUntilCompleted(runtime, taskHandle1.runId);
        const taskRun1 = await runtime.status(taskHandle1.runId);
        expect(taskRun1?.sessionId).toBeTruthy();
        expect(taskRun1?.sessionId?.startsWith(`${mainSessionId}-`)).toBe(true);
        expect(runtime.getAgentIdBySession(taskRun1?.sessionId || '')).toBe('template-coder');

        const taskHandle2 = await runtime.execute({
            agentId: 'template-coder',
            parentRunId: goalRunId,
            input: 'task-2',
        });
        await waitUntilCompleted(runtime, taskHandle2.runId);
        const taskRun2 = await runtime.status(taskHandle2.runId);
        expect(taskRun2?.sessionId).toBe(taskRun1?.sessionId);
    });
});
