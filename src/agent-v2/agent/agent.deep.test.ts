import { describe, expect, it, vi } from 'vitest';
import { Agent } from './agent';
import { AgentStatus } from './types';
import { AgentMessageType, type AgentMessage } from './stream-types';
import { EventType } from '../eventbus';
import { ToolRegistry } from '../tool/registry';
import { BaseTool, z } from '../tool/base';
import { LLMProvider } from '../../providers';
import type {
  Chunk,
  LLMGenerateOptions,
  LLMRequestMessage,
  LLMResponse,
  Tool,
  ToolCall,
  Usage,
} from '../../providers';
import { LLMRetryableError, LLMAbortedError } from '../../providers';
import type { ITimeProvider } from './types-internal';
import type { IMemoryManager, CurrentContext, SessionData } from '../memory/types';

class MockTimeProvider implements ITimeProvider {
  public now = 1700000000000;
  public sleeps: number[] = [];

  getCurrentTime(): number {
    this.now += 1;
    return this.now;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.now += ms;
  }
}

type GenerateStep = (
  messages: LLMRequestMessage[],
  options?: LLMGenerateOptions
) => Promise<LLMResponse | null> | AsyncGenerator<Chunk>;

class ScriptedProvider extends LLMProvider {
  public calls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }> = [];
  private readonly steps: GenerateStep[];
  private readonly timeoutMs: number;

  constructor(steps: GenerateStep[], timeoutMs = 1000) {
    super({
      apiKey: 'mock',
      baseURL: 'https://mock.local',
      model: 'mock-model',
      max_tokens: 1024,
      LLMMAX_TOKENS: 8192,
      temperature: 0,
    });
    this.steps = [...steps];
    this.timeoutMs = timeoutMs;
  }

  generate(
    messages: LLMRequestMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
    this.calls.push({ messages: structuredClone(messages), options });

    const step = this.steps.shift();
    if (!step) {
      throw new Error('No scripted provider step remaining');
    }

    return step(messages, options);
  }

  getTimeTimeout(): number {
    return this.timeoutMs;
  }

  getLLMMaxTokens(): number {
    return 8192;
  }

  getMaxOutputTokens(): number {
    return 1024;
  }
}

function textResponse(content: string, finishReason: 'stop' | 'length' = 'stop', usage?: Usage): LLMResponse {
  return {
    id: 'resp-text',
    object: 'chat.completion',
    created: Date.now(),
    model: 'mock-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
      },
      finish_reason: finishReason,
    }],
    usage,
  };
}

function toolCallResponse(
  toolCalls: ToolCall[],
  content = 'calling tool',
  finishReason: 'tool_calls' | 'stop' = 'tool_calls'
): LLMResponse {
  return {
    id: 'resp-tool',
    object: 'chat.completion',
    created: Date.now(),
    model: 'mock-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        tool_calls: toolCalls,
      },
      finish_reason: finishReason,
    }],
  };
}

function streamFromChunks(chunks: Chunk[]): AsyncGenerator<Chunk> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

function createToolRegistryStub(executeResult: Array<{ tool_call_id: string; name: string; arguments: string; result: any }>) {
  const llmTools: Tool[] = [{
    type: 'function',
    function: {
      name: 'lookup',
      description: 'lookup tool',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
        },
        required: ['q'],
      },
    },
  }];

  const stub = {
    toLLMTools: vi.fn(() => llmTools),
    execute: vi.fn(async () => executeResult),
  };

  return stub as unknown as ToolRegistry;
}

function createMemoryManager(overrides: Partial<IMemoryManager> = {}): IMemoryManager {
  const base: IMemoryManager = {
    createSession: vi.fn(async (sessionId?: string) => sessionId || 'new-session'),
    getSession: vi.fn(async () => null as SessionData | null),
    querySessions: vi.fn(async () => []),
    getCurrentContext: vi.fn(async () => null as CurrentContext | null),
    saveCurrentContext: vi.fn(async () => undefined),
    addMessageToContext: vi.fn(async () => undefined),
    updateMessageInContext: vi.fn(async () => undefined),
    clearContext: vi.fn(async () => undefined),
    compactContext: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    getFullHistory: vi.fn(async () => []),
    getCompactionRecords: vi.fn(async () => []),
    saveTask: vi.fn(async () => undefined),
    getTask: vi.fn(async () => null),
    queryTasks: vi.fn(async () => []),
    deleteTask: vi.fn(async () => undefined),
    saveSubTaskRun: vi.fn(async () => undefined),
    getSubTaskRun: vi.fn(async () => null),
    querySubTaskRuns: vi.fn(async () => []),
    deleteSubTaskRun: vi.fn(async () => undefined),
    initialize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };

  return Object.assign(base, overrides);
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 1000,
  intervalMs = 10
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitUntil timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function assertToolCallsClosed(messages: LLMRequestMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i] as LLMRequestMessage & { tool_calls?: ToolCall[] };
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      continue;
    }

    const expected = new Set(message.tool_calls.map((call) => call.id));
    let cursor = i + 1;
    while (cursor < messages.length && messages[cursor]?.role === 'tool') {
      const respondedId = (messages[cursor] as { tool_call_id?: string }).tool_call_id;
      if (respondedId) {
        expected.delete(respondedId);
      }
      cursor++;
    }

    if (expected.size > 0) {
      throw new Error(`Unmatched tool calls: ${Array.from(expected).join(',')}`);
    }
  }
}

describe('Agent deep behavior tests', () => {
  it('should complete non-streaming run and pass messages/options correctly', async () => {
    const provider = new ScriptedProvider([
      async () => textResponse('hello world', 'stop', {
        prompt_tokens: 10,
        completion_tokens: 3,
        total_tokens: 13,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 10,
      }),
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const streamMessages: AgentMessage[] = [];

    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      systemPrompt: 'system prompt',
      streamCallback: (msg) => streamMessages.push(msg),
    });

    const result = await agent.execute('ping');

    expect(result.role).toBe('assistant');
    expect(result.content).toBe('hello world');
    expect(result.type).toBe('text');
    expect(result.finish_reason).toBe('stop');
    expect(result.usage?.total_tokens).toBe(13);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(provider.calls[0]?.messages[1]?.content).toBe('ping');
    expect(provider.calls[0]?.options?.tools).toEqual((toolRegistry as any).toLLMTools());
    expect(provider.calls[0]?.options?.abortSignal).toBeDefined();

    const statuses = streamMessages
      .filter((m) => m.type === AgentMessageType.STATUS)
      .map((m) => (m.type === AgentMessageType.STATUS ? m.payload.state : null));

    expect(statuses).toContain(AgentStatus.RUNNING);
    expect(statuses).toContain(AgentStatus.COMPLETED);
    expect(agent.getStatus()).toBe(AgentStatus.COMPLETED);
    expect(agent.getLoopCount()).toBe(1);
    expect(agent.getRetryCount()).toBe(0);
  });

  it('should execute full tool-call roundtrip and keep message chain intact', async () => {
    const toolCalls: ToolCall[] = [{
      id: 'call_1',
      type: 'function',
      index: 0,
      function: {
        name: 'lookup',
        arguments: '{"q":"docs"}',
      },
    }];

    const provider = new ScriptedProvider([
      async () => toolCallResponse(toolCalls, 'I will use a tool', 'tool_calls'),
      async (messages) => {
        const lastMessage = messages[messages.length - 1];
        expect(lastMessage?.role).toBe('tool');
        expect(lastMessage?.tool_call_id).toBe('call_1');
        return textResponse('tool result consumed');
      },
    ]);

    const toolRegistry = createToolRegistryStub([
      {
        tool_call_id: 'call_1',
        name: 'lookup',
        arguments: '{"q":"docs"}',
        result: {
          success: true,
          output: 'found',
        },
      },
    ]);

    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      systemPrompt: 'system prompt',
    });

    const result = await agent.execute('please use tool');

    expect(result.content).toBe('tool result consumed');
    expect((toolRegistry as any).execute).toHaveBeenCalledTimes(1);
    expect((toolRegistry as any).execute).toHaveBeenCalledWith(
      toolCalls,
      expect.objectContaining({
        sessionId: agent.getSessionId(),
      }),
    );

    const messages = agent.getMessages();
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);

    const assistantToolCall = messages[2];
    expect(assistantToolCall?.type).toBe('tool-call');
    expect(assistantToolCall?.tool_calls).toEqual(toolCalls);

    const toolMessage = messages[3];
    expect(toolMessage?.type).toBe('tool-result');
    expect(toolMessage?.tool_call_id).toBe('call_1');
    expect(typeof toolMessage?.content).toBe('string');
    expect(JSON.parse(String(toolMessage?.content))).toEqual({ success: true, output: 'found' });

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect((toolRegistry as any).execute).toHaveBeenCalledWith(
      toolCalls,
      expect.objectContaining({
        sessionId: agent.getSessionId(),
      }),
    );
  });

  it('should isolate tool context for concurrent agents', async () => {
    const captured: Array<{ label: string; before?: string; after?: string }> = [];
    const captureContextSchema = z.object({
      delayMs: z.number().int().min(0).default(0),
    }).strict();

    class CaptureContextTool extends BaseTool<typeof captureContextSchema> {
      name = 'capture_context';
      description = 'capture tool context session id';
      schema = captureContextSchema;

      constructor(private readonly label: string) {
        super();
      }

      async execute(args: z.infer<typeof captureContextSchema>, context?: any) {
        const before = context?.sessionId;
        if (args.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, args.delayMs));
        }
        const after = context?.sessionId;
        captured.push({ label: this.label, before, after });
        return this.result({
          success: true,
          metadata: { before, after },
          output: `${before || ''}->${after || ''}`,
        });
      }
    }

    const makeAgent = (sessionId: string, label: string) => {
      const provider = new ScriptedProvider([
        async () => toolCallResponse([{
          id: `call_${label}`,
          type: 'function',
          index: 0,
          function: {
            name: 'capture_context',
            arguments: '{"delayMs":30}',
          },
        }]),
        async () => textResponse(`${label} done`),
      ]);

      const registry = new ToolRegistry({ workingDirectory: process.cwd() });
      registry.register([new CaptureContextTool(label)]);

      return new Agent({
        provider,
        toolRegistry: registry,
        stream: false,
        systemPrompt: 'system prompt',
        sessionId,
        memoryManager: createMemoryManager(),
      });
    };

    const agentA = makeAgent('session-A', 'A');
    const agentB = makeAgent('session-B', 'B');

    await Promise.all([
      agentA.execute('run tool'),
      agentB.execute('run tool'),
    ]);

    expect(captured).toHaveLength(2);
    const recordA = captured.find((item) => item.label === 'A');
    const recordB = captured.find((item) => item.label === 'B');
    expect(recordA).toBeDefined();
    expect(recordB).toBeDefined();
    expect(recordA?.before).toBe('session-A');
    expect(recordA?.after).toBe('session-A');
    expect(recordB?.before).toBe('session-B');
    expect(recordB?.after).toBe('session-B');
  });

  it('should sanitize sensitive keys in tool result callback and stored message', async () => {
    const toolCalls: ToolCall[] = [{
      id: 'call_sensitive',
      type: 'function',
      index: 0,
      function: {
        name: 'lookup',
        arguments: '{"q":"secret"}',
      },
    }];

    const provider = new ScriptedProvider([
      async () => toolCallResponse(toolCalls, 'checking secrets', 'tool_calls'),
      async () => textResponse('done'),
    ]);

    const toolRegistry = createToolRegistryStub([
      {
        tool_call_id: 'call_sensitive',
        name: 'lookup',
        arguments: '{"q":"secret"}',
        result: {
          success: true,
          password: 'pwd',
          token: 'tok',
          secret: 'sec',
          apiKey: 'api1',
          api_key: 'api2',
          authorization: 'auth',
          output: 'safe',
        },
      },
    ]);

    const streamMessages: AgentMessage[] = [];
    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      streamCallback: (message) => streamMessages.push(message),
    });

    await agent.execute('run sensitive tool');

    const toolResultEvent = streamMessages.find((msg) => msg.type === AgentMessageType.TOOL_CALL_RESULT);
    expect(toolResultEvent).toBeDefined();
    if (!toolResultEvent || toolResultEvent.type !== AgentMessageType.TOOL_CALL_RESULT) {
      throw new Error('Expected TOOL_CALL_RESULT event');
    }

    expect(toolResultEvent.payload.status).toBe('success');
    const sanitizedEventResult = JSON.parse(String(toolResultEvent.payload.result));
    expect(sanitizedEventResult.password).toBe('[REDACTED]');
    expect(sanitizedEventResult.token).toBe('[REDACTED]');
    expect(sanitizedEventResult.secret).toBe('[REDACTED]');
    expect(sanitizedEventResult.apiKey).toBe('[REDACTED]');
    expect(sanitizedEventResult.api_key).toBe('[REDACTED]');
    expect(sanitizedEventResult.authorization).toBe('[REDACTED]');
    expect(sanitizedEventResult.output).toBe('safe');

    const toolMsg = agent.getMessages().find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const persistedSanitized = JSON.parse(String(toolMsg?.content));
    expect(persistedSanitized.password).toBe('[REDACTED]');
    expect(persistedSanitized.authorization).toBe('[REDACTED]');
    expect(persistedSanitized.output).toBe('safe');
  });

  it('should retry retryable errors and succeed afterwards', async () => {
    const timeProvider = new MockTimeProvider();
    let attempt = 0;
    const provider = new ScriptedProvider([
      async () => {
        attempt += 1;
        throw new LLMRetryableError('temporary failure');
      },
      async () => textResponse('recovered'),
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const streamMessages: AgentMessage[] = [];

    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      timeProvider,
      maxRetries: 3,
      streamCallback: (message) => streamMessages.push(message),
    });

    const result = await agent.execute('retry please');

    expect(result.content).toBe('recovered');
    expect(attempt).toBe(1);
    expect(provider.calls).toHaveLength(2);
    expect(timeProvider.sleeps).toEqual([1000 * 60 * 10]);
    expect(agent.getRetryCount()).toBe(0);

    const retryStatus = streamMessages.find((m) => {
      return m.type === AgentMessageType.STATUS && m.payload.state === AgentStatus.RETRYING;
    });
    expect(retryStatus).toBeDefined();
  });

  it('should use configured retryDelayMs for retryable errors', async () => {
    const timeProvider = new MockTimeProvider();
    const provider = new ScriptedProvider([
      async () => {
        throw new LLMRetryableError('temporary failure');
      },
      async () => textResponse('recovered'),
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      timeProvider,
      maxRetries: 3,
      retryDelayMs: 5000,
    });

    const result = await agent.execute('retry with custom delay');
    expect(result.content).toBe('recovered');
    expect(timeProvider.sleeps).toEqual([5000]);
  });

  it('should honor retryAfter from LLMRetryableError', async () => {
    const timeProvider = new MockTimeProvider();
    const provider = new ScriptedProvider([
      async () => {
        throw new LLMRetryableError('rate limited', 15000);
      },
      async () => textResponse('recovered'),
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      timeProvider,
      maxRetries: 3,
    });

    const result = await agent.execute('retry with retry-after');
    expect(result.content).toBe('recovered');
    expect(timeProvider.sleeps).toEqual([15000]);
  });

  it('should use requestTimeout from Agent options instead of provider default timeout', async () => {
    const provider = new ScriptedProvider([
      async (_messages, options) => {
        return await new Promise<LLMResponse>((resolve, reject) => {
          const signal = options?.abortSignal;
          const timer = setTimeout(() => resolve(textResponse('late response')), 200);

          if (!signal) {
            clearTimeout(timer);
            reject(new Error('Missing abort signal'));
            return;
          }

          const onAbort = () => {
            clearTimeout(timer);
            reject(new LLMRetryableError('request aborted by timeout'));
          };

          if (signal.aborted) {
            onAbort();
            return;
          }

          signal.addEventListener('abort', onAbort, { once: true });
        });
      },
    ], 10_000);

    const toolRegistry = createToolRegistryStub([]);
    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      maxRetries: 0,
      requestTimeout: 20,
    });

    await expect(agent.execute('timeout override')).rejects.toThrow('maximum retries (0)');
  });

  it('should immediately compensate empty stop response without backoff sleep', async () => {
    const timeProvider = new MockTimeProvider();
    const provider = new ScriptedProvider([
      async () => textResponse('', 'stop'),
      async (messages) => {
        const emptyAssistantStops = messages.filter((message) => {
          const candidate = message as LLMRequestMessage & { tool_calls?: ToolCall[] };
          return (
            candidate.role === 'assistant'
            && typeof candidate.content === 'string'
            && candidate.content.length === 0
            && (!Array.isArray(candidate.tool_calls) || candidate.tool_calls.length === 0)
          );
        });
        expect(emptyAssistantStops).toHaveLength(0);
        return textResponse('recovered');
      },
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const streamMessages: AgentMessage[] = [];

    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      timeProvider,
      maxRetries: 0,
      streamCallback: (message) => streamMessages.push(message),
    });

    const result = await agent.execute('retry empty stop');

    expect(result.content).toBe('recovered');
    expect(provider.calls).toHaveLength(2);
    expect(timeProvider.sleeps).toEqual([]);
    expect(agent.getRetryCount()).toBe(0);

    const retryStatus = streamMessages.find((m) => {
      return m.type === AgentMessageType.STATUS && m.payload.state === AgentStatus.RETRYING;
    });
    expect(retryStatus).toBeDefined();
  });

  it('should fail after maximum compensation retries for repeated empty stop responses', async () => {
    const timeProvider = new MockTimeProvider();
    const provider = new ScriptedProvider([
      async () => textResponse('', 'stop'),
      async () => textResponse('', 'stop'),
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
      timeProvider,
      maxRetries: 0,
    });

    await expect(agent.execute('still empty')).rejects.toThrow('maximum compensation retries (1)');
    expect(provider.calls).toHaveLength(2);
    expect(timeProvider.sleeps).toEqual([]);
  });

  it('should keep empty-content assistant tool-call messages when sending next request', async () => {
    const provider = new ScriptedProvider([
      async () => toolCallResponse([
        {
          id: 'call_keep_1',
          type: 'function',
          index: 0,
          function: {
            name: 'lookup',
            arguments: '{"q":"release"}',
          },
        },
      ], '', 'tool_calls'),
      async (messages) => {
        const assistantToolCall = messages.find((message) => {
          const candidate = message as LLMRequestMessage & { tool_calls?: ToolCall[] };
          return (
            candidate.role === 'assistant'
            && Array.isArray(candidate.tool_calls)
            && candidate.tool_calls.some((toolCall) => toolCall.id === 'call_keep_1')
          );
        });
        const toolResult = messages.find((message) => {
          const candidate = message as LLMRequestMessage & { tool_call_id?: string };
          return candidate.role === 'tool' && candidate.tool_call_id === 'call_keep_1';
        });

        expect(assistantToolCall).toBeDefined();
        expect(toolResult).toBeDefined();

        return textResponse('tool chain completed');
      },
    ]);

    const toolRegistry = createToolRegistryStub([
      {
        tool_call_id: 'call_keep_1',
        name: 'lookup',
        arguments: '{"q":"release"}',
        result: {
          success: true,
          output: 'ok',
        },
      },
    ]);

    const agent = new Agent({
      provider,
      toolRegistry,
      stream: false,
    });

    const result = await agent.execute('keep tool call message');
    expect(result.content).toBe('tool chain completed');
  });

  it('should fail after max retries and emit TASK_FAILED event', async () => {
    const timeProvider = new MockTimeProvider();
    const provider = new ScriptedProvider([
      async () => {
        throw new LLMRetryableError('attempt 1');
      },
      async () => {
        throw new LLMRetryableError('attempt 2');
      },
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const agent = new Agent({
      provider,
      toolRegistry,
      timeProvider,
      maxRetries: 1,
    });

    const taskFailedEvents: any[] = [];
    agent.on(EventType.TASK_FAILED, (event) => taskFailedEvents.push(event));

    await expect(agent.execute('always fail')).rejects.toThrow('maximum retries (1)');

    expect(agent.getStatus()).toBe(AgentStatus.FAILED);
    expect(provider.calls).toHaveLength(2);
    expect(timeProvider.sleeps).toEqual([1000 * 60 * 10]);
    expect(taskFailedEvents).toHaveLength(1);
    expect(taskFailedEvents[0]).toMatchObject({
      totalLoops: 2,
      totalRetries: 2,
    });
  });

  it('should fail fast for non-retryable error and expose safe status message', async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new Error('raw crash');
      },
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const streamMessages: AgentMessage[] = [];

    const agent = new Agent({
      provider,
      toolRegistry,
      streamCallback: (message) => streamMessages.push(message),
      maxRetries: 3,
    });

    await expect(agent.execute('cause crash')).rejects.toThrow('raw crash');

    expect(agent.getStatus()).toBe(AgentStatus.FAILED);
    expect(provider.calls).toHaveLength(1);
    expect(agent.getRetryCount()).toBe(0);

    const failedStatus = streamMessages.find((m) => {
      return m.type === AgentMessageType.STATUS && m.payload.state === AgentStatus.FAILED;
    });
    expect(failedStatus).toBeDefined();
    expect((failedStatus as any).payload.message).toBe('An unexpected error occurred. Please try again.');
  });

  it('should produce streaming text lifecycle messages and final usage', async () => {
    const usage: Usage = {
      prompt_tokens: 8,
      completion_tokens: 2,
      total_tokens: 10,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 8,
    };

    const provider = new ScriptedProvider([
      async (_messages, options) => {
        expect(options?.stream).toBe(true);
        return streamFromChunks([
          {
            index: 0,
            id: 'chunk-1',
            created: Date.now(),
            model: 'mock-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Hel',
              },
            }],
          },
          {
            index: 0,
            id: 'chunk-2',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: 'lo',
              },
            }],
          },
          {
            index: 0,
            id: 'chunk-3',
            usage,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: '',
              },
              finish_reason: 'stop',
            }],
          },
        ]);
      },
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const callbackEvents: AgentMessage[] = [];

    const agent = new Agent({
      provider,
      toolRegistry,
      stream: true,
      streamCallback: (message) => callbackEvents.push(message),
    });

    const result = await agent.execute('say hello');

    expect(result.role).toBe('assistant');
    expect(result.content).toBe('Hello');
    expect(result.finish_reason).toBe('stop');
    expect(result.usage?.total_tokens).toBe(10);

    const eventTypes = callbackEvents.map((event) => event.type);
    expect(eventTypes).toContain(AgentMessageType.TEXT_START);
    expect(eventTypes).toContain(AgentMessageType.TEXT_DELTA);
    expect(eventTypes).toContain(AgentMessageType.TEXT_COMPLETE);

    const allDeltaText = callbackEvents
      .filter((event) => event.type === AgentMessageType.TEXT_DELTA)
      .map((event) => (event.type === AgentMessageType.TEXT_DELTA ? event.payload.content : ''))
      .join('');
    expect(allDeltaText).toBe('Hello');
  });

  it('should handle streaming tool-call flow and emit created payload with content', async () => {
    const provider = new ScriptedProvider([
      async () => {
        return streamFromChunks([
          {
            index: 0,
            id: 'tool-stream-1',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Checking ',
              },
            }],
          },
          {
            index: 0,
            id: 'tool-stream-2',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  id: 'call_stream_1',
                  type: 'function',
                  index: 0,
                  function: {
                    name: 'lookup',
                    arguments: '{"q":"release"}',
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
          },
        ]);
      },
      async () => {
        return streamFromChunks([
          {
            index: 0,
            id: 'tool-stream-3',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Done',
              },
              finish_reason: 'stop',
            }],
          },
        ]);
      },
    ]);

    const toolRegistry = createToolRegistryStub([
      {
        tool_call_id: 'call_stream_1',
        name: 'lookup',
        arguments: '{"q":"release"}',
        result: {
          success: true,
          output: 'ok',
        },
      },
    ]);

    const callbackEvents: AgentMessage[] = [];
    const agent = new Agent({
      provider,
      toolRegistry,
      stream: true,
      streamCallback: (message) => callbackEvents.push(message),
    });

    const result = await agent.execute('stream tool flow');

    expect(result.content).toBe('Done');
    expect((toolRegistry as any).execute).toHaveBeenCalledTimes(1);

    const created = callbackEvents.find((event) => event.type === AgentMessageType.TOOL_CALL_CREATED);
    expect(created).toBeDefined();
    if (!created || created.type !== AgentMessageType.TOOL_CALL_CREATED) {
      throw new Error('Expected TOOL_CALL_CREATED event');
    }

    expect(created.payload.content).toBe('Checking ');
    expect(created.payload.tool_calls).toHaveLength(1);
    expect(created.payload.tool_calls[0]).toMatchObject({
      callId: 'call_stream_1',
      toolName: 'lookup',
      args: '{"q":"release"}',
    });
  });

  it('should preserve assistant tool_calls when finish_reason arrives in a later chunk', async () => {
    const provider = new ScriptedProvider([
      async () => {
        return streamFromChunks([
          {
            index: 0,
            id: 'tool-split-1',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Checking ',
              },
            }],
          },
          {
            index: 0,
            id: 'tool-split-2',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  id: 'call_stream_split_1',
                  type: 'function',
                  index: 0,
                  function: {
                    name: 'lookup',
                    arguments: '{"q":"release"}',
                  },
                }],
              },
            }],
          },
          {
            index: 0,
            id: 'tool-split-3',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: '',
              },
              finish_reason: 'tool_calls',
            }],
          },
        ]);
      },
      async (messages) => {
        const assistantWithToolCall = messages.find(
          (m) =>
            m.role === 'assistant' &&
            Array.isArray((m as { tool_calls?: unknown[] }).tool_calls) &&
            ((m as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0
        );
        const toolMessage = messages.find(
          (m) =>
            m.role === 'tool' &&
            typeof (m as { tool_call_id?: unknown }).tool_call_id === 'string'
        );

        expect(assistantWithToolCall).toBeDefined();
        expect(toolMessage).toBeDefined();

        const toolCalls = (assistantWithToolCall as { tool_calls: ToolCall[] }).tool_calls;
        const toolCallIds = toolCalls.map((call) => call.id);
        const toolCallId = (toolMessage as { tool_call_id: string }).tool_call_id;
        expect(toolCallIds).toContain(toolCallId);
        expect(toolCallIds).toContain('call_stream_split_1');

        return streamFromChunks([
          {
            index: 0,
            id: 'tool-split-4',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Done',
              },
              finish_reason: 'stop',
            }],
          },
        ]);
      },
    ]);

    const toolRegistry = createToolRegistryStub([
      {
        tool_call_id: 'call_stream_split_1',
        name: 'lookup',
        arguments: '{"q":"release"}',
        result: {
          success: true,
          output: 'ok',
        },
      },
    ]);

    const agent = new Agent({
      provider,
      toolRegistry,
      stream: true,
    });

    const result = await agent.execute('stream split tool flow');

    expect(result.content).toBe('Done');
    expect((toolRegistry as any).execute).toHaveBeenCalledTimes(1);
    expect(provider.calls).toHaveLength(2);
  });

  it('should reject invalid user input content parts', async () => {
    const provider = new ScriptedProvider([
      async () => textResponse('unused'),
    ]);
    const toolRegistry = createToolRegistryStub([]);
    const agent = new Agent({ provider, toolRegistry });

    await expect(agent.execute([{ type: 'file', file: {} }])).rejects.toThrow('file part must include file_id or file_data');
    await expect(agent.execute([{ type: 'input_audio', input_audio: { data: '', format: 'mp3' } }])).rejects.toThrow('input_audio part must include data and format');
    await expect(agent.execute([{ type: 'text', text: 'ok' }, { type: 'unknown' as any }])).rejects.toThrow('Unsupported content part type: unknown');

    expect(provider.calls).toHaveLength(0);
  });

  it('should abort in-flight execution and keep final status as ABORTED', async () => {
    const provider = new ScriptedProvider([
      async (_messages, options) => {
        return new Promise((_, reject) => {
          const signal = options?.abortSignal;
          if (!signal) {
            reject(new Error('abort signal missing'));
            return;
          }

          if (signal.aborted) {
            reject(new LLMAbortedError('aborted before start'));
            return;
          }

          signal.addEventListener('abort', () => {
            reject(new LLMAbortedError('aborted by test'));
          }, { once: true });
        });
      },
    ], 60000);

    const toolRegistry = createToolRegistryStub([]);
    const callbackEvents: AgentMessage[] = [];

    const agent = new Agent({
      provider,
      toolRegistry,
      streamCallback: (message) => callbackEvents.push(message),
    });

    const pending = agent.execute('long running');
    await waitUntil(() => provider.calls.length === 1);
    agent.abort();

    await expect(pending).rejects.toThrow('aborted by test');
    expect(agent.getStatus()).toBe(AgentStatus.ABORTED);

    const abortedEvent = callbackEvents.find((event) => {
      return event.type === AgentMessageType.STATUS && event.payload.state === AgentStatus.ABORTED;
    });
    expect(abortedEvent).toBeDefined();
  });

  it('should not fail main flow when session sync persistence throws', async () => {
    const provider = new ScriptedProvider([
      async () => textResponse('ok after sync failure'),
    ]);

    const memoryManager = createMemoryManager({
      getCurrentContext: vi.fn(async () => {
        throw new Error('sync failed');
      }),
    });

    const toolRegistry = createToolRegistryStub([]);
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const agent = new Agent({
        provider,
        toolRegistry,
        memoryManager,
      });

      const result = await agent.execute('persist this');

      expect(result.content).toBe('ok after sync failure');
      expect(logSpy).toHaveBeenCalled();
      expect(agent.getStatus()).toBe(AgentStatus.COMPLETED);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('should auto-repair interrupted tool-call chain before first resumed LLM request', async () => {
    const now = Date.now();
    const sessionId = 'session-resume-interrupted-tool';
    const pendingToolCallId = 'call_resume_1';
    const existingSession: SessionData = {
      id: sessionId,
      sessionId,
      systemPrompt: 'system',
      currentContextId: 'ctx-1',
      totalMessages: 2,
      compactionCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const existingContext: CurrentContext = {
      id: 'ctx-1',
      contextId: 'ctx-1',
      sessionId,
      systemPrompt: 'system',
      messages: [
        {
          messageId: 'system',
          role: 'system',
          content: 'system',
        },
        {
          messageId: 'assistant-pending-tool',
          role: 'assistant',
          content: 'need tool',
          type: 'tool-call',
          finish_reason: 'tool_calls',
          tool_calls: [
            {
              id: pendingToolCallId,
              type: 'function',
              index: 0,
              function: {
                name: 'lookup',
                arguments: '{"q":"resume"}',
              },
            },
          ],
        },
      ],
      version: 1,
      createdAt: now,
      updatedAt: now,
      stats: {
        totalMessagesInHistory: 2,
        compactionCount: 0,
      },
    };

    const memoryManager = createMemoryManager({
      getSession: vi.fn(async () => existingSession),
      getCurrentContext: vi.fn(async () => existingContext),
    });

    const provider = new ScriptedProvider([
      async (messages) => {
        expect(() => assertToolCallsClosed(messages)).not.toThrow();
        const repairedTool = messages.find((msg) => {
          return msg.role === 'tool' && (msg as { tool_call_id?: string }).tool_call_id === pendingToolCallId;
        });
        expect(repairedTool).toBeDefined();

        const parsed = JSON.parse(String(repairedTool?.content));
        expect(parsed.error).toBe('TOOL_CALL_INTERRUPTED');
        expect(parsed.interrupted).toBe(true);
        return textResponse('resume ok');
      },
    ]);

    const toolRegistry = createToolRegistryStub([]);
    const agent = new Agent({
      provider,
      toolRegistry,
      memoryManager,
      sessionId,
      systemPrompt: 'system',
    });

    const result = await agent.execute('continue');

    expect(result.content).toBe('resume ok');
    expect(provider.calls).toHaveLength(1);
  });
});
