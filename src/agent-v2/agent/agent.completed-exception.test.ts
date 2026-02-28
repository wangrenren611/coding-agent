import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from './agent';
import { AgentMessageType, type AgentMessage, type StatusMessage } from './stream-types';
import { AgentStatus } from './types';
import { createMemoryManager } from '../memory';
import { LLMRetryableError } from '../../providers';
import type { LLMProvider, LLMResponse, LLMGenerateOptions, LLMRequestMessage, Chunk } from '../../providers';

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

    it('reasoning-only response should not trigger compensation retry and should complete', async () => {
        const provider = new SequenceProvider([createReasoningOnlyResponse('这是推理输出')]);
        const memoryManager = await createReadyMemoryManager('reasoning-only');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: true,
            thinking: true,
            memoryManager,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('继续');

        expect(result.status).toBe('completed');
        expect(result.finalMessage?.content).toBe('这是推理输出');

        const compensationStatuses = events.filter(
            (e) =>
                e.type === AgentMessageType.STATUS &&
                e.payload.state === AgentStatus.RETRYING &&
                String((e as StatusMessage).payload.message || '').includes('Compensation retry')
        );
        expect(compensationStatuses).toHaveLength(0);
    });

    it('stream fallback reasoning-only should emit reasoning events but not text events', async () => {
        const provider = new SequenceProvider([createReasoningOnlyResponse('仅推理，不是正文')]);
        const memoryManager = await createReadyMemoryManager('stream-fallback-reasoning-only');
        const events: AgentMessage[] = [];

        const agent = new Agent({
            provider: provider as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: true,
            thinking: true,
            memoryManager,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.executeWithResult('继续');
        expect(result.status).toBe('completed');

        const hasReasoningDelta = events.some((e) => e.type === AgentMessageType.REASONING_DELTA);
        const hasTextDelta = events.some((e) => e.type === AgentMessageType.TEXT_DELTA);
        expect(hasReasoningDelta).toBe(true);
        expect(hasTextDelta).toBe(false);
    });

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
});
