import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Session } from './index';
import { createMemoryManager } from '../memory';
import type { IMemoryManager } from '../memory';
import type { Message } from './types';
import {
  LLMProvider,
  type Chunk,
  type LLMGenerateOptions,
  type LLMRequestMessage,
  type LLMResponse,
  type Usage,
} from '../../providers';

interface ToolCallShape {
  id: string;
  type: string;
  index: number;
  function: {
    name: string;
    arguments: string;
  };
}

class MockSummaryProvider extends LLMProvider {
  public generateCallCount = 0;

  constructor() {
    super({
      apiKey: 'mock',
      baseURL: 'https://mock.local',
      model: 'mock-model',
      max_tokens: 200,
      LLMMAX_TOKENS: 600,
      temperature: 0,
    });
  }

  generate(
    _messages: LLMRequestMessage[],
    _options?: LLMGenerateOptions
  ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
    this.generateCallCount++;

    return Promise.resolve({
      id: `summary-${this.generateCallCount}`,
      object: 'chat.completion',
      created: Date.now(),
      model: 'mock-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Summary: conversation compressed with key decisions and pending tasks.',
        },
        finish_reason: 'stop',
      }],
    });
  }

  getTimeTimeout(): number {
    return 30000;
  }

  getLLMMaxTokens(): number {
    return 600;
  }

  getMaxOutputTokens(): number {
    return 200;
  }
}

function createUsage(total = 120): Usage {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
    prompt_cache_miss_tokens: Math.floor(total / 2),
    prompt_cache_hit_tokens: 0,
  };
}

function seedSessionWithStructuredMessages(session: Session): void {
  const toolCallId = 'call-search-1';

  session.addMessage({
    messageId: 'user-old-1',
    role: 'user',
    content: `需求背景：${'A'.repeat(800)}`,
    type: 'text',
  });

  session.addMessage({
    messageId: 'assistant-tool-1',
    role: 'assistant',
    content: '我将调用工具搜索项目结构。',
    type: 'tool-call',
    tool_calls: [
      {
        id: toolCallId,
        type: 'function',
        index: 0,
        function: {
          name: 'grep',
          arguments: JSON.stringify({ pattern: 'agent-v2' }),
        },
      },
    ],
    finish_reason: 'tool_calls',
    usage: createUsage(140),
  });

  session.addMessage({
    messageId: 'tool-result-1',
    role: 'tool',
    content: JSON.stringify({ success: true, files: ['src/agent-v2/agent/agent.ts'] }),
    type: 'tool-result',
    tool_call_id: toolCallId,
  });

  session.addMessage({
    messageId: 'user-recent-1',
    role: 'user',
    content: [
      { type: 'text', text: '请结合图片继续分析。' },
      { type: 'image_url', image_url: { url: 'https://example.com/diagram.png', detail: 'high' } },
    ],
    type: 'text',
  });

  session.addMessage({
    messageId: 'assistant-recent-1',
    role: 'assistant',
    content: `这是基于上下文的分析结论：${'B'.repeat(900)}`,
    type: 'text',
    finish_reason: 'stop',
    usage: createUsage(180),
  });
}

function assertMessageShape(message: Message): void {
  expect(typeof message.messageId).toBe('string');
  expect(message.messageId.length).toBeGreaterThan(0);
  expect(['system', 'user', 'assistant', 'tool']).toContain(message.role);

  if (typeof message.content === 'string') {
    expect(message.content.length).toBeGreaterThanOrEqual(0);
  } else {
    expect(Array.isArray(message.content)).toBe(true);
    for (const part of message.content) {
      expect(typeof part.type).toBe('string');
      if (part.type === 'text') {
        expect(typeof part.text).toBe('string');
      }
      if (part.type === 'image_url') {
        expect(typeof part.image_url?.url).toBe('string');
      }
      if (part.type === 'file') {
        expect(
          Boolean(part.file?.file_id || part.file?.file_data || part.file?.filename)
        ).toBe(true);
      }
      if (part.type === 'input_audio') {
        expect(typeof part.input_audio?.data).toBe('string');
        expect(typeof part.input_audio?.format).toBe('string');
      }
      if (part.type === 'input_video') {
        expect(
          Boolean(part.input_video?.url || part.input_video?.file_id || part.input_video?.data)
        ).toBe(true);
      }
    }
  }

  if (message.usage) {
    expect(message.usage.total_tokens).toBeGreaterThan(0);
    expect(message.usage.prompt_tokens).toBeGreaterThanOrEqual(0);
    expect(message.usage.completion_tokens).toBeGreaterThanOrEqual(0);
  }

  const toolMessage = message as Message & {
    tool_calls?: ToolCallShape[];
    tool_call_id?: string;
  };

  if (message.type === 'tool-call') {
    expect(Array.isArray(toolMessage.tool_calls)).toBe(true);
    expect(toolMessage.tool_calls!.length).toBeGreaterThan(0);
    expect(typeof toolMessage.tool_calls![0].function.name).toBe('string');
  }

  if (message.role === 'tool') {
    expect(typeof toolMessage.tool_call_id).toBe('string');
    expect((toolMessage.tool_call_id || '').length).toBeGreaterThan(0);
  }
}

function assertMessageListShape(messages: Message[]): void {
  expect(messages.length).toBeGreaterThan(0);
  for (const message of messages) {
    assertMessageShape(message);
  }
}

describe('Session compaction message structure (simulated data)', () => {
  let tempDir: string;
  let memoryManager: IMemoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-compact-structure-'));
    memoryManager = createMemoryManager({
      type: 'file',
      connectionString: tempDir,
    });
    await memoryManager.initialize();
  });

  afterEach(async () => {
    await memoryManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should keep in-memory message field structure valid before/after pre-LLM compaction', async () => {
    const provider = new MockSummaryProvider();
    const session = new Session({
      systemPrompt: '你是测试助手',
      enableCompaction: true,
      provider,
      compactionConfig: {
        maxTokens: 260,
        maxOutputTokens: 120,
        keepMessagesNum: 3,
        triggerRatio: 0.9,
      },
    });

    seedSessionWithStructuredMessages(session);
    const beforeMessages = session.getMessages();
    assertMessageListShape(beforeMessages);

    const compacted = await session.compactBeforeLLMCall();
    expect(compacted).toBe(true);
    expect(provider.generateCallCount).toBe(1);

    const afterMessages = session.getMessages();
    assertMessageListShape(afterMessages);

    expect(afterMessages[0].role).toBe('system');
    expect(afterMessages[0].messageId).toBe('system');

    const summary = afterMessages.find((message) => message.type === 'summary');
    expect(summary).toBeDefined();
    expect(summary?.role).toBe('assistant');
    expect(typeof summary?.content).toBe('string');
    expect(String(summary?.content).length).toBeGreaterThan(0);

    const assistantTool = afterMessages.find((message) => message.messageId === 'assistant-tool-1');
    const toolResult = afterMessages.find((message) => message.messageId === 'tool-result-1');
    expect(assistantTool).toBeDefined();
    expect(toolResult).toBeDefined();
    expect(afterMessages.findIndex((m) => m.messageId === 'assistant-tool-1'))
      .toBeLessThan(afterMessages.findIndex((m) => m.messageId === 'tool-result-1'));
  });

  it('should keep persisted context/history/compaction record structure valid after compaction+sync', async () => {
    const provider = new MockSummaryProvider();
    const session = new Session({
      sessionId: 'session-compact-structure-persisted',
      systemPrompt: '你是测试助手',
      memoryManager,
      enableCompaction: true,
      provider,
      compactionConfig: {
        maxTokens: 260,
        maxOutputTokens: 120,
        keepMessagesNum: 3,
        triggerRatio: 0.9,
      },
    });

    await session.initialize();
    seedSessionWithStructuredMessages(session);

    const compacted = await session.compactBeforeLLMCall();
    expect(compacted).toBe(true);
    await session.sync();

    const sessionId = session.getSessionId();
    const context = await memoryManager.getCurrentContext(sessionId);
    expect(context).toBeTruthy();
    assertMessageListShape(context!.messages);
    expect(context!.messages[0].role).toBe('system');

    const history = await memoryManager.getFullHistory({ sessionId });
    expect(history.length).toBeGreaterThan(0);
    for (const historyMessage of history) {
      assertMessageShape(historyMessage);
      expect(historyMessage.sequence).toBeGreaterThan(0);
    }

    const summaryInHistory = history.find((message) => message.isSummary);
    expect(summaryInHistory).toBeDefined();
    expect(summaryInHistory?.type).toBe('summary');

    const records = await memoryManager.getCompactionRecords(sessionId);
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record.reason).toBe('token_limit');
    expect(record.archivedMessageIds.length).toBeGreaterThan(0);
    expect(record.summaryMessageId).toBeTruthy();
    expect(record.metadata?.tokenCountBefore).toBeDefined();
    expect(record.metadata?.tokenCountAfter).toBeDefined();
  });
});

