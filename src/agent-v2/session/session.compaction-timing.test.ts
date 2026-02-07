import { describe, expect, it } from 'vitest';
import { Session } from './index';
import {
  LLMProvider,
  type Chunk,
  type LLMGenerateOptions,
  type LLMRequestMessage,
  type LLMResponse,
} from '../../providers';

class MockCompactionProvider extends LLMProvider {
  public generateCallCount = 0;

  constructor() {
    super({
      apiKey: 'mock',
      baseURL: 'https://mock.local',
      model: 'mock-model',
      max_tokens: 128,
      LLMMAX_TOKENS: 256,
      temperature: 0,
    });
  }

  generate(
    _messages: LLMRequestMessage[],
    _options?: LLMGenerateOptions
  ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
    this.generateCallCount++;
    return Promise.resolve({
      id: 'compact-id',
      object: 'chat.completion',
      created: Date.now(),
      model: 'mock-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'summary-content',
        },
        finish_reason: 'stop',
      }],
    });
  }

  getTimeTimeout(): number {
    return 30000;
  }

  getLLMMaxTokens(): number {
    return 256;
  }

  getMaxOutputTokens(): number {
    return 128;
  }
}

describe('Session compaction timing', () => {
  it('should not auto-compact on addMessage', async () => {
    const provider = new MockCompactionProvider();
    const session = new Session({
      systemPrompt: 'system',
      enableCompaction: true,
      provider,
      compactionConfig: {
        maxTokens: 120,
        maxOutputTokens: 60,
        keepMessagesNum: 1,
        triggerRatio: 0.9,
      },
    });

    session.addMessage({
      messageId: 'u1',
      role: 'user',
      content: 'x'.repeat(1200),
      type: 'text',
    });
    session.addMessage({
      messageId: 'u2',
      role: 'user',
      content: 'y'.repeat(1200),
      type: 'text',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(provider.generateCallCount).toBe(0);
  });

  it('should compact before next LLM call when threshold is reached', async () => {
    const provider = new MockCompactionProvider();
    const session = new Session({
      systemPrompt: 'system',
      enableCompaction: true,
      provider,
      compactionConfig: {
        maxTokens: 120,
        maxOutputTokens: 60,
        keepMessagesNum: 1,
        triggerRatio: 0.9,
      },
    });

    session.addMessage({
      messageId: 'u1',
      role: 'user',
      content: 'x'.repeat(1200),
      type: 'text',
    });
    session.addMessage({
      messageId: 'u2',
      role: 'user',
      content: 'y'.repeat(1200),
      type: 'text',
    });

    const compacted = await session.compactBeforeLLMCall();

    expect(compacted).toBe(true);
    expect(provider.generateCallCount).toBe(1);
    expect(session.getMessages().some((message) => message.type === 'summary')).toBe(true);
  });
});

