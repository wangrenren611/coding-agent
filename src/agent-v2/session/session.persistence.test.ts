import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createMemoryManager } from '../memory';
import type { IMemoryManager } from '../memory/types';
import { Session } from './index';
import type { Usage } from '../../providers';

function createUsage(total = 36): Usage {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
    prompt_cache_miss_tokens: Math.floor(total / 2),
    prompt_cache_hit_tokens: 0,
  };
}

describe('Session persistence queue', () => {
  let tempDir: string;
  let memoryManager: IMemoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-memory-'));
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

  it('should persist streamed message updates as a single history entry after sync', async () => {
    const sessionId = 'session-sync-upsert';
    const usage = createUsage(64);

    const session = new Session({
      sessionId,
      systemPrompt: 'test',
      memoryManager,
    });
    await session.initialize();

    session.addMessage({
      messageId: 'assistant-1',
      role: 'assistant',
      content: 'partial',
      type: 'text',
    });

    session.addMessage({
      messageId: 'assistant-1',
      role: 'assistant',
      content: 'final',
      type: 'text',
      finish_reason: 'stop',
      usage,
    });

    await session.sync();

    const history = await memoryManager.getFullHistory({ sessionId });
    const assistantMessages = history.filter((item) => item.messageId === 'assistant-1');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].content).toBe('final');
    expect(assistantMessages[0].usage).toEqual(usage);
  });

  it('should repair interrupted tool calls after restart and keep repair idempotent', async () => {
    const sessionId = 'session-repair-tool-calls';
    const session = new Session({
      sessionId,
      systemPrompt: 'test',
      memoryManager,
    });
    await session.initialize();

    session.addMessage({
      messageId: 'assistant-tool-1',
      role: 'assistant',
      content: '',
      type: 'tool-call',
      finish_reason: 'tool_calls',
      tool_calls: [
        { id: 'call_1', type: 'function', index: 0, function: { name: 'tool_a', arguments: '{}' } },
        { id: 'call_2', type: 'function', index: 1, function: { name: 'tool_b', arguments: '{}' } },
      ],
    });
    await session.sync();

    await memoryManager.close();
    memoryManager = createMemoryManager({
      type: 'file',
      connectionString: tempDir,
    });
    await memoryManager.initialize();

    const resumed = new Session({
      sessionId,
      systemPrompt: 'test',
      memoryManager,
    });
    await resumed.initialize();

    const firstPassCompacted = await resumed.compactBeforeLLMCall();
    expect(firstPassCompacted).toBe(false);

    const firstPassToolMessages = resumed
      .getMessages()
      .filter((msg) => msg.role === 'tool')
      .map((msg) => msg as { tool_call_id?: string; content: string });
    expect(firstPassToolMessages.map((msg) => msg.tool_call_id)).toEqual(['call_1', 'call_2']);
    for (const toolMessage of firstPassToolMessages) {
      const payload = JSON.parse(toolMessage.content);
      expect(payload.error).toBe('TOOL_CALL_INTERRUPTED');
      expect(payload.interrupted).toBe(true);
    }

    const secondPassCompacted = await resumed.compactBeforeLLMCall();
    expect(secondPassCompacted).toBe(false);
    const secondPassToolMessages = resumed.getMessages().filter((msg) => msg.role === 'tool');
    expect(secondPassToolMessages).toHaveLength(2);
  });

  it('should only repair missing tool results when some tool calls are already completed', async () => {
    const sessionId = 'session-repair-partial-tool-calls';
    const session = new Session({
      sessionId,
      systemPrompt: 'test',
      memoryManager,
    });
    await session.initialize();

    session.addMessage({
      messageId: 'assistant-tool-2',
      role: 'assistant',
      content: '',
      type: 'tool-call',
      finish_reason: 'tool_calls',
      tool_calls: [
        { id: 'call_a', type: 'function', index: 0, function: { name: 'tool_a', arguments: '{}' } },
        { id: 'call_b', type: 'function', index: 1, function: { name: 'tool_b', arguments: '{}' } },
      ],
    });
    session.addMessage({
      messageId: 'tool-result-a',
      role: 'tool',
      type: 'tool-result',
      tool_call_id: 'call_a',
      content: JSON.stringify({ success: true, output: 'ok' }),
    });
    await session.sync();

    await memoryManager.close();
    memoryManager = createMemoryManager({
      type: 'file',
      connectionString: tempDir,
    });
    await memoryManager.initialize();

    const resumed = new Session({
      sessionId,
      systemPrompt: 'test',
      memoryManager,
    });
    await resumed.initialize();
    await resumed.compactBeforeLLMCall();

    const repairedMessages = resumed
      .getMessages()
      .filter((msg) => msg.role === 'tool')
      .map((msg) => msg as { tool_call_id?: string; content: string });
    expect(repairedMessages).toHaveLength(2);
    expect(repairedMessages.map((msg) => msg.tool_call_id)).toEqual(['call_a', 'call_b']);

    const preserved = JSON.parse(repairedMessages[0].content);
    expect(preserved.success).toBe(true);

    const repaired = JSON.parse(repairedMessages[1].content);
    expect(repaired.error).toBe('TOOL_CALL_INTERRUPTED');
    expect(repaired.interrupted).toBe(true);
  });
});
