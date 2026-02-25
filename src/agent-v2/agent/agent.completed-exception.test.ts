import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from './agent';
import { AgentMessageType, type AgentMessage } from './stream-types';
import { AgentStatus } from './types';
import { createMemoryManager } from '../memory';
import { LLMRetryableError } from '../../providers';
import type {
  LLMResponse,
  LLMGenerateOptions,
  LLMRequestMessage,
  Chunk,
} from '../../providers';

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
      provider: provider as any,
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
      provider: provider as any,
      systemPrompt: 'test',
      stream: false,
      memoryManager,
    });

    const result = await agent.executeWithResult('hello');

    expect(result.status).toBe('completed');
    expect(result.finalMessage?.content).toBe('partial but valid');
  });

  it('tool failure warning path should still complete when next turn returns final text', async () => {
    const provider = new SequenceProvider([
      createToolCallResponse('unknown_tool', { x: 1 }),
      createTextResponse('final answer after tool warning'),
    ]);
    const memoryManager = await createReadyMemoryManager('tool-failure-complete');
    const events: AgentMessage[] = [];

    const agent = new Agent({
      provider: provider as any,
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
        String(e.payload.message || '').includes('Tool execution partially or fully failed')
    );
    expect(warnStatuses.length).toBeGreaterThan(0);

    const completedStatuses = events.filter(
      (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.COMPLETED
    );
    expect(completedStatuses).toHaveLength(1);
  });

  it('empty assistant response should fail after compensation retries and emit retrying status', async () => {
    const provider = new SequenceProvider([createTextResponse(''), createTextResponse('')]);
    const memoryManager = await createReadyMemoryManager('compensation-fail');
    const events: AgentMessage[] = [];

    const agent = new Agent({
      provider: provider as any,
      systemPrompt: 'test',
      stream: false,
      memoryManager,
      maxCompensationRetries: 1,
      streamCallback: (msg) => events.push(msg),
    });

    const result = await agent.executeWithResult('hello');

    expect(result.status).toBe('failed');
    expect(result.failure?.internalMessage || result.failure?.userMessage).toContain(
      'maximum compensation retries'
    );

    const compensationRetryStatuses = events.filter(
      (e) =>
        e.type === AgentMessageType.STATUS &&
        e.payload.state === AgentStatus.RETRYING &&
        String(e.payload.message || '').includes('Compensation retry')
    );
    expect(compensationRetryStatuses).toHaveLength(1);

    const failedStatuses = events.filter(
      (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.FAILED
    );
    expect(failedStatuses).toHaveLength(1);
  });

  it('retryable errors should fail with max-retries-exceeded and keep detailed retry reason in status', async () => {
    const provider = new SequenceProvider([
      new LLMRetryableError('Gateway timeout', 1, 'TIMEOUT'),
      new LLMRetryableError('Gateway timeout', 1, 'TIMEOUT'),
    ]);
    const memoryManager = await createReadyMemoryManager('retry-exceeded');
    const events: AgentMessage[] = [];

    const agent = new Agent({
      provider: provider as any,
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
      .filter(
        (e) => e.type === AgentMessageType.STATUS && e.payload.state === AgentStatus.RETRYING
      )
      .map((e) => String(e.payload.message || ''));
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
      provider: provider as any,
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
});
