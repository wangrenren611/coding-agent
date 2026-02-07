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
});
