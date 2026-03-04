import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../agent';
import { AgentMessageType, type AgentMessage, type StatusMessage } from '../stream-types';
import { AgentStatus } from '../types';
import { createMemoryManager } from '../../memory';
import { LLMRetryableError } from '../../../providers';
import { notifySubtaskStatus } from '../../tool/task/subtask-notifier';
import type { LLMProvider, LLMResponse, LLMGenerateOptions, LLMRequestMessage, Chunk } from '../../../providers';

type ProviderStep =
    | LLMResponse
    | Error
    | ((
          messages: LLMRequestMessage[],
          options?: LLMGenerateOptions
      ) => Promise<LLMResponse | AsyncGenerator<Chunk> | null> | LLMResponse | AsyncGenerator<Chunk> | null);

class SequenceProvider {
    private readonly steps: ProviderStep[];
    callCount = 0;

    constructor(steps: ProviderStep[]) {
        this.steps = steps;
    }

    async generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | AsyncGenerator<Chunk> | null> {
        const index = this.callCount;
        this.callCount += 1;
        const step = this.steps[Math.min(index, this.steps.length - 1)];

        if (step instanceof Error) {
            throw step;
        }

        if (typeof step === 'function') {
            return await step(messages, options);
        }

        return step;
    }

    getTimeTimeout(): number {
        return 5000;
    }

    getLLMMaxTokens(): number {
        return 32000;
    }

    getMaxOutputTokens(): number {
        return 4096;
    }
}

function createTextResponse(content: string, finishReason: 'stop' | 'length' = 'stop'): LLMResponse {
    return {
        id: `resp-${Date.now()}-${Math.random()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content,
                },
                finish_reason: finishReason,
            },
        ],
        usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
        },
    };
}

function createContentFilterResponse(content: string): LLMResponse {
    return {
        id: `content-filter-${Date.now()}-${Math.random()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content,
                },
                finish_reason: 'content_filter',
            },
        ],
    };
}

function createToolCallResponse(toolName: string, args: Record<string, unknown>): LLMResponse {
    return {
        id: `tool-${Date.now()}-${Math.random()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: 'calling tool',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            index: 0,
                            function: {
                                name: toolName,
                                arguments: JSON.stringify(args),
                            },
                        },
                    ],
                },
                finish_reason: 'tool_calls',
            },
        ],
    };
}

function createInvalidToolCallResponse(): LLMResponse {
    return {
        id: `tool-invalid-${Date.now()}-${Math.random()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: 'invalid tool call',
                    tool_calls: [
                        {
                            id: '',
                            type: 'function',
                            index: 0,
                            function: {
                                name: 'list_files',
                                arguments: '{}',
                            },
                        },
                    ],
                },
                finish_reason: 'tool_calls',
            },
        ],
    };
}

function createReasoningOnlyResponse(reasoning: string): LLMResponse {
    return {
        id: `reasoning-only-${Date.now()}-${Math.random()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: '',
                    reasoning_content: reasoning,
                },
                finish_reason: 'stop',
            },
        ],
    };
}

function createChunkStream(chunks: Chunk[]): AsyncGenerator<Chunk> {
    return (async function* () {
        for (const chunk of chunks) {
            yield chunk;
        }
    })();
}

describe('Agent completed and exception scenarios', () => {
    const memoryManagers: Array<ReturnType<typeof createMemoryManager>> = [];

    afterEach(async () => {
        for (const memoryManager of memoryManagers) {
            await memoryManager.close();
        }
        memoryManagers.length = 0;
    });

    async function createReadyMemoryManager(tag: string) {
        const memoryManager = createMemoryManager({
            type: 'file',
            connectionString: `/tmp/agent-completed-exception-${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        });
        memoryManagers.push(memoryManager);
        await memoryManager.initialize();
        return memoryManager;
    }

    async function createManagedTask(
        memoryManager: Awaited<ReturnType<typeof createReadyMemoryManager>>,
        sessionId: string,
        taskId: string,
        status: 'pending' | 'in_progress' | 'completed'
    ) {
        await memoryManager.saveTask({
            id: taskId,
            taskId,
            sessionId,
            parentTaskId: '__task_tool_managed__',
            status,
            title: `managed task ${taskId}`,
        });
    }

    async function createBackgroundSubtaskRun(
        memoryManager: Awaited<ReturnType<typeof createReadyMemoryManager>>,
        sessionId: string,
        runId: string,
        status: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
    ) {
        const now = Date.now();
        await memoryManager.saveSubTaskRun({
            id: runId,
            runId,
            parentSessionId: sessionId,
            childSessionId: `${sessionId}::subtask::${runId}`,
            mode: 'background',
            status,
            description: `background subtask ${runId}`,
            prompt: 'background subtask prompt',
            subagentType: 'explore',
            startedAt: now - 1000,
            ...(status === 'completed' || status === 'failed' || status === 'cancelled' ? { finishedAt: now } : {}),
            toolsUsed: [],
            output: status === 'completed' ? 'background done' : undefined,
        });
    }

    function attachSubTaskRunQueryCounter(memoryManager: Awaited<ReturnType<typeof createReadyMemoryManager>>) {
        let queryCount = 0;
        const originalQuery = memoryManager.querySubTaskRuns.bind(memoryManager);
        (memoryManager as typeof memoryManager & { querySubTaskRuns: typeof originalQuery }).querySubTaskRuns = async (
            ...args: Parameters<typeof originalQuery>
        ) => {
            queryCount += 1;
            return await originalQuery(...args);
        };
        return {
            getCount: () => queryCount,
        };
    }

    it('stream=true fallback (non-stream response) should still emit text events before completed', async () => {
        const provider = new SequenceProvider([createTextResponse('fallback content')]);
        const memoryManager = await createReadyMemoryManager('stream-fallback');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: true,
            memoryManager,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');

        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('fallback content');
        expect(events.some((e) => e.type === AgentMessageType.TEXT_START)).toBe(true);
        expect(events.some((e) => e.type === AgentMessageType.TEXT_DELTA)).toBe(true);
        expect(events.some((e) => e.type === AgentMessageType.TEXT_COMPLETE)).toBe(true);

        const completedStatuses = events.filter(
            (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.COMPLETED
        );
        expect(completedStatuses).toHaveLength(1);
    });

    it('finish_reason=length with non-empty content should still complete', async () => {
        const provider = new SequenceProvider([createTextResponse('partial but valid', 'length')]);
        const memoryManager = await createReadyMemoryManager('length-complete');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
        });

        const result = await agent.executeWithResult('hello');

        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('partial but valid');
    });

    it('finish_reason=content_filter with non-empty content should still complete', async () => {
        const provider = new SequenceProvider([createContentFilterResponse('filtered but usable')]);
        const memoryManager = await createReadyMemoryManager('content-filter-complete');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
        });

        const result = await agent.executeWithResult('hello');

        expect(result.status).toBe('completed');
        expect(result.finalMessage?.finish_reason).toBe('content_filter');
        expect(result.finalMessage?.content).toBe('filtered but usable');
    });

    it('finish_reason=content_filter with empty content should trigger empty-response retries before loop exhaustion', async () => {
        const provider = new SequenceProvider([createContentFilterResponse('')]);
        const memoryManager = await createReadyMemoryManager('content-filter-empty-loop');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            maxLoops: 2,
            maxRetries: 2,
            retryDelayMs: 1,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_LOOP_EXCEEDED');

        const retryStatuses = events.filter(
            (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.RETRYING
        );
        expect(retryStatuses.length).toBeGreaterThan(0);
        expect(
            retryStatuses.some((e) => String((e as StatusMessage).payload.message || '').includes('EMPTY_RESPONSE'))
        ).toBe(true);
    });

    it('tool failure warning path should still complete when next turn returns final text', async () => {
        const provider = new SequenceProvider([
            createToolCallResponse('unknown_tool', { x: 1 }),
            createTextResponse('final answer after tool warning'),
        ]);
        const memoryManager = await createReadyMemoryManager('tool-failure-complete');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('run tool');

        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('final answer after tool warning');

        const warnStatuses = events.filter(
            (e) =>
                e.type === AgentMessageType.STATUS &&
                e.payload.state === AgentStatus.RUNNING &&
                String((e as StatusMessage).payload.message || '').includes('Tool execution partially or fully failed')
        );
        expect(warnStatuses.length).toBeGreaterThan(0);

        const completedStatuses = events.filter(
            (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.COMPLETED
        );
        expect(completedStatuses).toHaveLength(1);
    });

    it('permission ask should emit request event and continue when user approves', async () => {
        const provider = new SequenceProvider([
            createToolCallResponse('unknown_tool', { x: 1 }),
            createTextResponse('final answer after permission approval'),
        ]);
        const memoryManager = await createReadyMemoryManager('permission-ask-approve');
        const events: AgentMessage[] = [];
        const askSpy = vi.fn(async () => true);

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            permissionRules: [{ effect: 'ask', tool: 'unknown_tool', reason: 'manual approval required' }],
            onPermissionAsk: askSpy,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('run tool');
        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('final answer after permission approval');
        expect(askSpy).toHaveBeenCalledTimes(1);
        expect(events.some((event) => event.type === AgentMessageType.PERMISSION_REQUEST)).toBe(true);
    });

    it('permission ask should abort loop when user rejects', async () => {
        const provider = new SequenceProvider([createToolCallResponse('unknown_tool', { x: 1 })]);
        const memoryManager = await createReadyMemoryManager('permission-ask-reject');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            permissionRules: [{ effect: 'ask', tool: 'unknown_tool', reason: 'manual approval required' }],
            onPermissionAsk: async () => false,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('run tool');
        expect(result.status).toBe('aborted');
        expect(provider.callCount).toBe(1);
        expect(events.some((event) => event.type === AgentMessageType.PERMISSION_REQUEST)).toBe(true);
    });

    it('permission ask should continue in event mode when resolvePermission=true', async () => {
        const provider = new SequenceProvider([
            createToolCallResponse('unknown_tool', { x: 1 }),
            createTextResponse('final answer after event approval'),
        ]);
        const memoryManager = await createReadyMemoryManager('permission-event-approve');
        const events: AgentMessage[] = [];
        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            permissionDecisionMode: 'event',
            permissionRules: [{ effect: 'ask', tool: 'unknown_tool', reason: 'manual approval required' }],
            streamCallback: (msg) => {
                events.push(msg);
                if (msg.type === AgentMessageType.PERMISSION_REQUEST) {
                    setTimeout(() => {
                        agent.resolvePermission(msg.payload.ticketId, true);
                    }, 0);
                }
            },
        });

        const result = await agent.executeWithResult('run tool');
        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('final answer after event approval');
        expect(events.some((event) => event.type === AgentMessageType.PERMISSION_REQUEST)).toBe(true);
    });

    it('permission ask should abort in event mode when resolvePermission=false', async () => {
        const provider = new SequenceProvider([createToolCallResponse('unknown_tool', { x: 1 })]);
        const memoryManager = await createReadyMemoryManager('permission-event-reject');
        const events: AgentMessage[] = [];
        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            permissionDecisionMode: 'event',
            permissionRules: [{ effect: 'ask', tool: 'unknown_tool', reason: 'manual approval required' }],
            streamCallback: (msg) => {
                events.push(msg);
                if (msg.type === AgentMessageType.PERMISSION_REQUEST) {
                    setTimeout(() => {
                        agent.resolvePermission(msg.payload.ticketId, false);
                    }, 0);
                }
            },
        });

        const result = await agent.executeWithResult('run tool');
        expect(result.status).toBe('aborted');
        expect(provider.callCount).toBe(1);
        expect(events.some((event) => event.type === AgentMessageType.PERMISSION_REQUEST)).toBe(true);
    });

    it('should disable permission engine via env when Agent option is unset', async () => {
        const previous = process.env.AGENT_ENABLE_PERMISSION_ENGINE;
        process.env.AGENT_ENABLE_PERMISSION_ENGINE = 'false';
        try {
            const provider = new SequenceProvider([
                createToolCallResponse('unknown_tool', { x: 1 }),
                createTextResponse('final answer after env-disabled permission engine'),
            ]);
            const memoryManager = await createReadyMemoryManager('permission-env-disable');

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: false,
                memoryManager,
                permissionRules: [{ effect: 'deny', tool: 'unknown_tool', reason: 'blocked by test policy' }],
            });

            const result = await agent.executeWithResult('run tool');
            expect(result.status).toBe('completed');
            expect(result.finalMessage?.content).toBe('final answer after env-disabled permission engine');
            expect(provider.callCount).toBe(2);
        } finally {
            if (previous === undefined) {
                delete process.env.AGENT_ENABLE_PERMISSION_ENGINE;
            } else {
                process.env.AGENT_ENABLE_PERMISSION_ENGINE = previous;
            }
        }
    });

    it('explicit Agent.enablePermissionEngine should override env setting', async () => {
        const previous = process.env.AGENT_ENABLE_PERMISSION_ENGINE;
        process.env.AGENT_ENABLE_PERMISSION_ENGINE = 'false';
        try {
            const provider = new SequenceProvider([createToolCallResponse('unknown_tool', { x: 1 })]);
            const memoryManager = await createReadyMemoryManager('permission-env-override');

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: false,
                memoryManager,
                enablePermissionEngine: true,
                permissionRules: [{ effect: 'deny', tool: 'unknown_tool', reason: 'blocked by test policy' }],
            });

            const result = await agent.executeWithResult('run tool');
            expect(result.status).toBe('failed');
            expect(result.failure?.code).toBe('LLM_RESPONSE_INVALID');
            expect(provider.callCount).toBe(1);
        } finally {
            if (previous === undefined) {
                delete process.env.AGENT_ENABLE_PERMISSION_ENGINE;
            } else {
                process.env.AGENT_ENABLE_PERMISSION_ENGINE = previous;
            }
        }
    });

    it('empty assistant response should fail after normal retries and emit retrying status', async () => {
        const provider = new SequenceProvider([createTextResponse(''), createTextResponse('')]);
        const memoryManager = await createReadyMemoryManager('compensation-fail');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            maxRetries: 1,
            retryDelayMs: 1,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');

        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        const retryStatuses = events.filter(
            (e) =>
                e.type === AgentMessageType.STATUS &&
                e.payload.state === AgentStatus.RETRYING &&
                String((e as StatusMessage).payload.message || '').startsWith('Retrying...')
        );
        expect(retryStatuses.length).toBeGreaterThan(0);
        expect(
            retryStatuses.some((e) => String((e as StatusMessage).payload.message || '').includes('EMPTY_RESPONSE'))
        ).toBe(true);

        const failedStatuses = events.filter(
            (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.FAILED
        );
        expect(failedStatuses).toHaveLength(1);
    });

    it('should keep retry statuses explicit for timeout and empty-response retries', async () => {
        const provider = new SequenceProvider([
            new LLMRetryableError('408 Request Timeout - RequestTimeOut', 1, 'TIMEOUT'),
            createTextResponse(''),
            createTextResponse(''),
        ]);
        const memoryManager = await createReadyMemoryManager('no-stale-retry-after-compensation');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            maxRetries: 2,
            retryDelayMs: 1,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        const genericRetryingStatuses = events.filter(
            (e) =>
                e.type === AgentMessageType.STATUS &&
                e.payload.state === AgentStatus.RETRYING &&
                String((e as StatusMessage).payload.message || '').startsWith('Retrying...')
        );
        expect(genericRetryingStatuses.length).toBeGreaterThanOrEqual(2);
        expect(
            genericRetryingStatuses.some((e) => String((e as StatusMessage).payload.message || '').includes('TIMEOUT'))
        ).toBe(true);
        expect(
            genericRetryingStatuses.some((e) =>
                String((e as StatusMessage).payload.message || '').includes('EMPTY_RESPONSE')
            )
        ).toBe(true);

        const compensationStatuses = events.filter(
            (e) =>
                e.type === AgentMessageType.STATUS &&
                e.payload.state === AgentStatus.RETRYING &&
                String((e as StatusMessage).payload.message || '').includes('Compensation retry')
        );
        expect(compensationStatuses).toHaveLength(0);
    });

    it('stream error chunk should be treated as stream error retry instead of empty-response retry', async () => {
        const provider = new SequenceProvider([
            () =>
                createChunkStream([
                    {
                        id: 'chatcmpl-stream-error',
                        index: 0,
                        error: {
                            code: 'internal_server_error',
                            type: 'internal_server_error',
                            message:
                                '<500> InternalError.Algo: An error occurred in model serving, error message is: [Inference engine abort. Finish reason: [STOP_ENGINE_ABORT].]',
                            param: null,
                        },
                    },
                ]),
        ]);
        const memoryManager = await createReadyMemoryManager('stream-error-chunk');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: true,
            memoryManager,
            maxRetries: 1,
            retryDelayMs: 1,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        const retryingMessages = events
            .filter((e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.RETRYING)
            .map((e) => String((e as StatusMessage).payload.message || ''));

        expect(retryingMessages.some((msg) => msg.includes('internal_server_error'))).toBe(true);
        expect(retryingMessages.some((msg) => msg.includes('EMPTY_RESPONSE'))).toBe(false);
    });

    it('stream invalid_parameter_error chunk should fail immediately without retry', async () => {
        const provider = new SequenceProvider([
            () =>
                createChunkStream([
                    {
                        id: 'chatcmpl-invalid-parameter',
                        index: 0,
                        error: {
                            code: 'invalid_parameter_error',
                            type: 'invalid_request_error',
                            message:
                                'An assistant message with "tool_calls" must be followed by tool messages responding to each "tool_call_id".',
                            param: null,
                        },
                    },
                ]),
        ]);
        const memoryManager = await createReadyMemoryManager('stream-invalid-parameter');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: true,
            memoryManager,
            maxRetries: 3,
            retryDelayMs: 1,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('LLM_REQUEST_FAILED');
        expect(provider.callCount).toBe(1);

        const retryingMessages = events.filter(
            (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.RETRYING
        );
        expect(retryingMessages).toHaveLength(0);
    });

    it('stream buffer overflow should fail explicitly instead of becoming empty-response retry', async () => {
        const provider = new SequenceProvider([
            () =>
                createChunkStream([
                    {
                        id: 'chunk-overflow',
                        index: 0,
                        choices: [{ index: 0, delta: { role: 'assistant', content: '0123456789' } }],
                    },
                ]),
        ]);
        const memoryManager = await createReadyMemoryManager('stream-buffer-overflow');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: true,
            memoryManager,
            maxBufferSize: 5,
            maxRetries: 2,
            retryDelayMs: 1,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('LLM_REQUEST_FAILED');
        expect(result.failure?.internalMessage).toContain('max buffer size');

        const retryingMessages = events
            .filter((e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.RETRYING)
            .map((e) => String((e as StatusMessage).payload.message || ''));
        expect(retryingMessages).toHaveLength(0);
    });

    it('reasoning-only response should keep empty content without fallback copy', async () => {
        const provider = new SequenceProvider([
            createReasoningOnlyResponse('第一轮仅推理'),
            createTextResponse('第二轮最终答案'),
        ]);
        const memoryManager = await createReadyMemoryManager('reasoning-no-fallback');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            thinking: true,
            memoryManager,
            maxLoops: 5,
        });

        const result = await agent.executeWithResult('继续');

        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('第二轮最终答案');
        expect(provider.callCount).toBe(2);

        const assistantMessages = agent.getMessages().filter((message) => message.role === 'assistant');
        const reasoningOnlyMessage = assistantMessages.find((message) => message.reasoning_content === '第一轮仅推理');

        expect(reasoningOnlyMessage).toBeDefined();
        expect(reasoningOnlyMessage?.content).toBe('');
    });

    it('reasoning-only response should not trigger compensation retry and should fail fast by maxLoops', async () => {
        const provider = new SequenceProvider([createReasoningOnlyResponse('这是推理输出')]);
        const memoryManager = await createReadyMemoryManager('reasoning-only');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: true,
            thinking: true,
            memoryManager,
            maxLoops: 2,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('继续');

        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_LOOP_EXCEEDED');

        const compensationStatuses = events.filter(
            (e) =>
                e.type === AgentMessageType.STATUS &&
                e.payload.state === AgentStatus.RETRYING &&
                String((e as StatusMessage).payload.message || '').includes('Compensation retry')
        );
        expect(compensationStatuses).toHaveLength(0);
    });

    it('stream fallback reasoning-only should emit reasoning events but not text events before fast loop fail', async () => {
        const provider = new SequenceProvider([createReasoningOnlyResponse('仅推理，不是正文')]);
        const memoryManager = await createReadyMemoryManager('stream-fallback-reasoning-only');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: true,
            thinking: true,
            memoryManager,
            maxLoops: 2,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('继续');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_LOOP_EXCEEDED');

        const hasReasoningDelta = events.some((e) => e.type === AgentMessageType.REASONING_DELTA);
        const hasTextDelta = events.some((e) => e.type === AgentMessageType.TEXT_DELTA);
        expect(hasReasoningDelta).toBe(true);
        expect(hasTextDelta).toBe(false);
    });

    it('managed-task gate should inject one reminder then fail fast when blocked tasks have no progress', async () => {
        const provider = new SequenceProvider([
            createTextResponse('first summary'),
            createTextResponse('second summary'),
        ]);
        const memoryManager = await createReadyMemoryManager('managed-stall-fail-fast');
        const sessionId = `managed-stall-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await createManagedTask(memoryManager, sessionId, 'managed-stall-task-1', 'pending');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            sessionId,
            maxLoops: 10,
        });

        const result = await agent.executeWithResult('继续');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_LOOP_EXCEEDED');
        expect(provider.callCount).toBe(2);

        const reminderMessages = agent
            .getMessages()
            .filter(
                (message) =>
                    message.role === 'assistant' &&
                    typeof message.content === 'string' &&
                    message.content.includes('[SYSTEM REMINDER]') &&
                    message.content.includes('There are still unfinished tasks')
            );
        expect(reminderMessages).toHaveLength(1);
    });

    it('managed-task gate should continue normally when blocked tasks make progress', async () => {
        const memoryManager = await createReadyMemoryManager('managed-progress');
        const sessionId = `managed-progress-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const taskId = 'managed-progress-task-1';
        await createManagedTask(memoryManager, sessionId, taskId, 'pending');

        const provider = new SequenceProvider([
            createTextResponse('first summary'),
            async () => {
                await createManagedTask(memoryManager, sessionId, taskId, 'completed');
                return createTextResponse('final answer after task done');
            },
        ]);

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            sessionId,
            maxLoops: 10,
        });

        const result = await agent.executeWithResult('继续');
        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('final answer after task done');
        expect(provider.callCount).toBe(2);
    });

    it('background-subtask gate should wait for run completion and avoid extra llm calls', async () => {
        const provider = new SequenceProvider([createTextResponse('final answer after background run')]);
        const memoryManager = await createReadyMemoryManager('background-subtask-wait');
        const sessionId = `background-wait-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const runId = `task_bg_wait_${Date.now()}`;
        const queryCounter = attachSubTaskRunQueryCounter(memoryManager);
        await createBackgroundSubtaskRun(memoryManager, sessionId, runId, 'running');
        const startedAt = Date.now();

        setTimeout(() => {
            void createBackgroundSubtaskRun(memoryManager, sessionId, runId, 'completed');
            notifySubtaskStatus({
                parentSessionId: sessionId,
                runId,
                status: 'completed',
            });
        }, 50);

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            sessionId,
            maxLoops: 10,
        });

        const result = await agent.executeWithResult('继续');
        const elapsed = Date.now() - startedAt;
        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('final answer after background run');
        expect(provider.callCount).toBe(1);
        expect(elapsed).toBeLessThan(2000);
        expect(queryCounter.getCount()).toBeLessThanOrEqual(3);
    });

    it('background-subtask gate should still complete via fallback polling when event is missed', async () => {
        const provider = new SequenceProvider([createTextResponse('final answer via fallback polling')]);
        const memoryManager = await createReadyMemoryManager('background-subtask-fallback');
        const sessionId = `background-fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const runId = `task_bg_fallback_${Date.now()}`;
        const queryCounter = attachSubTaskRunQueryCounter(memoryManager);
        await createBackgroundSubtaskRun(memoryManager, sessionId, runId, 'running');
        const startedAt = Date.now();

        setTimeout(() => {
            void createBackgroundSubtaskRun(memoryManager, sessionId, runId, 'completed');
        }, 50);

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            sessionId,
            maxLoops: 10,
        });

        const result = await agent.executeWithResult('继续');
        const elapsed = Date.now() - startedAt;
        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('final answer via fallback polling');
        expect(provider.callCount).toBe(1);
        expect(elapsed).toBeGreaterThanOrEqual(2000);
        expect(queryCounter.getCount()).toBeLessThanOrEqual(4);
    }, 15000);

    it('retryable errors should fail with max-retries-exceeded and keep detailed retry reason in status', async () => {
        const provider = new SequenceProvider([
            new LLMRetryableError('Gateway timeout', 1, 'TIMEOUT'),
            new LLMRetryableError('Gateway timeout', 1, 'TIMEOUT'),
        ]);
        const memoryManager = await createReadyMemoryManager('retry-exceeded');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            maxRetries: 1,
            retryDelayMs: 1,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');

        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        const retryingMessages = events
            .filter((e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.RETRYING)
            .map((e) => String((e as StatusMessage).payload.message || ''));
        expect(retryingMessages.some((msg) => msg.includes('[TIMEOUT] Gateway timeout'))).toBe(true);
    });

    it('invalid response (missing choices) should emit error + failed status and return failed result', async () => {
        const provider = new SequenceProvider([
            {
                id: 'bad-response',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [],
            } as LLMResponse,
        ]);
        const memoryManager = await createReadyMemoryManager('invalid-response');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('hello');

        expect(result.status).toBe('failed');
        // LLM 返回无效响应时，应该返回 LLM_RESPONSE_INVALID 错误码
        expect(result.failure?.code).toBe('LLM_RESPONSE_INVALID');

        const hasErrorEvent = events.some(
            (e) =>
                e.type === AgentMessageType.ERROR &&
                String(e.payload.error || '').includes('LLM response missing choices')
        );
        expect(hasErrorEvent).toBe(true);

        const failedStatuses = events.filter(
            (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.FAILED
        );
        expect(failedStatuses).toHaveLength(1);
    });

    it('invalid response (choices[0].message missing) should fail fast by maxLoops', async () => {
        const provider = new SequenceProvider([
            {
                id: 'bad-missing-message',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                    },
                ],
            } as unknown as LLMResponse,
        ]);
        const memoryManager = await createReadyMemoryManager('invalid-missing-message');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            maxLoops: 2,
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_LOOP_EXCEEDED');
        expect(provider.callCount).toBe(2);
    });

    it('abnormal message.role should still complete when content is present', async () => {
        const provider = new SequenceProvider([
            {
                id: 'bad-role-response',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'user',
                            content: 'content from abnormal role',
                        },
                        finish_reason: 'stop',
                    },
                ],
            } as unknown as LLMResponse,
        ]);
        const memoryManager = await createReadyMemoryManager('abnormal-role');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('completed');
        expect(result.finalMessage?.role).toBe('assistant');
        expect(result.finalMessage?.content).toBe('content from abnormal role');
    });

    it('invalid message.content type should be normalized to empty and fail by maxLoops', async () => {
        const provider = new SequenceProvider([
            {
                id: 'bad-content-type',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: { foo: 'bar' },
                        },
                        finish_reason: 'stop',
                    },
                ],
            } as unknown as LLMResponse,
        ]);
        const memoryManager = await createReadyMemoryManager('invalid-content-type');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            maxLoops: 2,
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_LOOP_EXCEEDED');
        expect(provider.callCount).toBe(2);
    });

    it('unknown finish_reason should complete when content is non-empty', async () => {
        const provider = new SequenceProvider([
            {
                id: 'unknown-finish-with-content',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'unknown finish reason but has content',
                        },
                        finish_reason: 'unexpected_reason',
                    },
                ],
            } as unknown as LLMResponse,
        ]);
        const memoryManager = await createReadyMemoryManager('unknown-finish-with-content');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('unknown finish reason but has content');
    });

    it('unknown finish_reason with empty content should fail by maxLoops', async () => {
        const provider = new SequenceProvider([
            {
                id: 'unknown-finish-empty',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: '',
                        },
                        finish_reason: 'unexpected_reason',
                    },
                ],
            } as unknown as LLMResponse,
        ]);
        const memoryManager = await createReadyMemoryManager('unknown-finish-empty');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            maxLoops: 2,
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_LOOP_EXCEEDED');
        expect(provider.callCount).toBe(2);
    });

    it('invalid tool_calls response should be excluded from context and marked in history', async () => {
        const provider = new SequenceProvider([createInvalidToolCallResponse()]);
        const memoryManager = await createReadyMemoryManager('invalid-tool-calls');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('LLM_RESPONSE_INVALID');

        const activeAssistantMessages = agent.getMessages().filter((m) => m.role === 'assistant');
        expect(activeAssistantMessages).toHaveLength(0);

        const history = await memoryManager.getFullHistory({ sessionId: agent.getSessionId() });
        const invalidAssistantMessages = history.filter(
            (m) => m.role === 'assistant' && m.excludedFromContext === true && m.excludedReason === 'invalid_response'
        );
        expect(invalidAssistantMessages.length).toBeGreaterThan(0);
    });

    it('should rollback invalid_input tool turn to checkpoint and retry successfully', async () => {
        const invalidToolArgsResponse: LLMResponse = {
            id: `tool-invalid-args-${Date.now()}-${Math.random()}`,
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'call malformed tool',
                        tool_calls: [
                            {
                                id: 'call-bad-args',
                                type: 'function',
                                index: 0,
                                function: {
                                    name: 'read_file',
                                    arguments: '{"filePath":',
                                },
                            },
                        ],
                    },
                    finish_reason: 'tool_calls',
                },
            ],
        };

        const provider = new SequenceProvider([
            invalidToolArgsResponse,
            createTextResponse('recovered after rollback'),
        ]);
        const memoryManager = await createReadyMemoryManager('rollback-invalid-input');

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            maxRetries: 2,
            maxLoops: 4,
        });

        const result = await agent.executeWithResult('hello');
        expect(result.status).toBe('completed');
        expect(String(result.finalMessage?.content || '')).toContain('recovered after rollback');
        expect(provider.callCount).toBe(2);

        const history = await memoryManager.getFullHistory({ sessionId: agent.getSessionId() });
        const invalidInputExcluded = history.filter(
            (m) => m.role === 'assistant' && m.excludedFromContext === true && m.excludedReason === 'invalid_input'
        );
        expect(invalidInputExcluded.length).toBeGreaterThan(0);
    });
});
