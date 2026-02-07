import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createMemoryManager } from './index';
import type { IMemoryManager } from './types';
import type { Usage } from '../../providers';

function createUsage(total = 30): Usage {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
    prompt_cache_miss_tokens: Math.floor(total / 2),
    prompt_cache_hit_tokens: 0,
  };
}

describe('FileMemoryManager persistence', () => {
  let tempDir: string;
  let memoryManager: IMemoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-memory-'));
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

  it('should upsert streamed assistant message instead of duplicating history entries', async () => {
    const sessionId = await memoryManager.createSession('session-stream-upsert', 'test system');
    const usage = createUsage(28);
    const messageId = 'assistant-stream-1';

    await memoryManager.addMessageToContext(sessionId, {
      messageId,
      role: 'assistant',
      content: 'partial',
      type: 'text',
    });

    await memoryManager.addMessageToContext(sessionId, {
      messageId,
      role: 'assistant',
      content: 'final content',
      type: 'text',
      finish_reason: 'stop',
      usage,
    });

    const history = await memoryManager.getFullHistory({ sessionId });
    const assistantEntries = history.filter((item) => item.messageId === messageId);
    expect(assistantEntries).toHaveLength(1);
    expect(assistantEntries[0].content).toBe('final content');
    expect(assistantEntries[0].usage).toEqual(usage);

    const context = await memoryManager.getCurrentContext(sessionId);
    const contextAssistantEntries = context?.messages.filter((item) => item.messageId === messageId) || [];
    expect(contextAssistantEntries).toHaveLength(1);
    expect(contextAssistantEntries[0].usage).toEqual(usage);
  });

  it('should keep history and context usage in sync on updateMessageInContext', async () => {
    const sessionId = await memoryManager.createSession('session-update-usage', 'test system');
    const messageId = 'assistant-usage-update';
    const usage = createUsage(42);

    await memoryManager.addMessageToContext(sessionId, {
      messageId,
      role: 'assistant',
      content: 'response',
      type: 'text',
    });

    await memoryManager.updateMessageInContext(sessionId, messageId, {
      usage,
      finish_reason: 'stop',
    });

    const context = await memoryManager.getCurrentContext(sessionId);
    const contextMessage = context?.messages.find((item) => item.messageId === messageId);
    expect(contextMessage?.usage).toEqual(usage);

    const history = await memoryManager.getFullHistory({ sessionId });
    const historyMessage = history.find((item) => item.messageId === messageId);
    expect(historyMessage?.usage).toEqual(usage);
    expect(historyMessage?.finish_reason).toBe('stop');
  });
});
