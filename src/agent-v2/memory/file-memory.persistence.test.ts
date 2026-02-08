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

  it('should persist sub task run records and reload from disk', async () => {
    const parentSessionId = await memoryManager.createSession('session-parent', 'parent system');
    const runId = 'task_123_abc';
    const childSessionId = `${parentSessionId}::subtask::${runId}`;

    await memoryManager.saveSubTaskRun({
      id: runId,
      runId,
      parentSessionId,
      childSessionId,
      mode: 'foreground',
      status: 'completed',
      description: 'Analyze code',
      prompt: 'Summarize files',
      subagentType: 'explore',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      turns: 1,
      toolsUsed: ['glob'],
      output: 'done',
      messages: [
        { messageId: 'system', role: 'system', content: 'sys' },
        { messageId: 'user-1', role: 'user', content: 'hello', type: 'text' },
        { messageId: 'assistant-1', role: 'assistant', content: 'done', type: 'text', finish_reason: 'stop' },
      ],
    });

    const loaded = await memoryManager.getSubTaskRun(runId);
    expect(loaded).toBeTruthy();
    expect(loaded?.status).toBe('completed');
    expect(loaded?.childSessionId).toBe(childSessionId);
    expect(loaded?.messageCount).toBe(3);
    expect(loaded?.messages).toBeUndefined();

    const runFile = path.join(tempDir, 'subtask-runs', `subtask-run-${encodeURIComponent(runId)}.json`);
    const raw = await fs.readFile(runFile, 'utf-8');
    const stored = JSON.parse(raw);
    expect(stored.runId).toBe(runId);
    expect(stored.status).toBe('completed');
    expect(stored.messageCount).toBe(3);
    expect(stored.messages).toBeUndefined();

    await memoryManager.close();
    memoryManager = createMemoryManager({
      type: 'file',
      connectionString: tempDir,
    });
    await memoryManager.initialize();

    const reloaded = await memoryManager.getSubTaskRun(runId);
    expect(reloaded).toBeTruthy();
    expect(reloaded?.status).toBe('completed');
    expect(reloaded?.messageCount).toBe(3);
    expect(reloaded?.messages).toBeUndefined();
  });

  it('should query and delete sub task run records', async () => {
    await memoryManager.saveSubTaskRun({
      id: 'run-1',
      runId: 'run-1',
      parentSessionId: 'p1',
      childSessionId: 'c1',
      mode: 'background',
      status: 'running',
      description: 'job1',
      prompt: 'p1',
      subagentType: 'explore',
      startedAt: Date.now(),
      toolsUsed: [],
      messages: [],
    });
    await memoryManager.saveSubTaskRun({
      id: 'run-2',
      runId: 'run-2',
      parentSessionId: 'p1',
      childSessionId: 'c2',
      mode: 'background',
      status: 'completed',
      description: 'job2',
      prompt: 'p2',
      subagentType: 'plan',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      toolsUsed: ['read_file'],
      messages: [],
    });

    const queried = await memoryManager.querySubTaskRuns({ parentSessionId: 'p1' });
    expect(queried).toHaveLength(2);

    const completed = await memoryManager.querySubTaskRuns({ status: 'completed' });
    expect(completed).toHaveLength(1);
    expect(completed[0].runId).toBe('run-2');

    await memoryManager.deleteSubTaskRun('run-1');
    const deleted = await memoryManager.getSubTaskRun('run-1');
    expect(deleted).toBeNull();
  });

  it('should migrate legacy sub task run files out of tasks directory', async () => {
    const runId = 'legacy-run-1';
    const legacyDir = path.join(tempDir, 'tasks');
    const newDir = path.join(tempDir, 'subtask-runs');
    await fs.mkdir(legacyDir, { recursive: true });

    const legacyFile = path.join(legacyDir, `subtask-run-${encodeURIComponent(runId)}.json`);
    await fs.writeFile(legacyFile, JSON.stringify({
      id: runId,
      runId,
      parentSessionId: 'parent',
      childSessionId: `parent::subtask::${runId}`,
      mode: 'foreground',
      status: 'completed',
      description: 'legacy',
      prompt: 'legacy',
      subagentType: 'explore',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      turns: 1,
      toolsUsed: [],
      output: 'ok',
      messages: [
        { messageId: 'system', role: 'system', content: 'sys' },
      ],
    }, null, 2), 'utf-8');

    await memoryManager.close();
    memoryManager = createMemoryManager({
      type: 'file',
      connectionString: tempDir,
    });
    await memoryManager.initialize();

    const migrated = await memoryManager.getSubTaskRun(runId);
    expect(migrated).toBeTruthy();
    expect(migrated?.messageCount).toBe(1);
    expect(migrated?.messages).toBeUndefined();

    const migratedFile = path.join(newDir, `subtask-run-${encodeURIComponent(runId)}.json`);
    await expect(fs.access(migratedFile)).resolves.toBeUndefined();
    await expect(fs.access(legacyFile)).rejects.toThrow();
  });
});
