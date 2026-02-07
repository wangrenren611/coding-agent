import { describe, expect, it, vi } from 'vitest';
import { Session } from './index';
import type { IMemoryManager, SessionData } from '../memory/types';

function createMockMemoryManager(overrides: Partial<IMemoryManager> = {}): IMemoryManager {
  const base: IMemoryManager = {
    createSession: vi.fn(async (sessionId?: string) => sessionId || 'new-session'),
    getSession: vi.fn(async () => null as SessionData | null),
    querySessions: vi.fn(async () => []),
    updateSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => undefined),
    getCurrentContext: vi.fn(async () => null),
    saveCurrentContext: vi.fn(async () => undefined),
    addMessageToContext: vi.fn(async () => undefined),
    addMessagesToContext: vi.fn(async () => undefined),
    updateMessageInContext: vi.fn(async () => undefined),
    clearContext: vi.fn(async () => undefined),
    compactContext: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    getFullHistory: vi.fn(async () => []),
    addMessageToHistory: vi.fn(async () => undefined),
    addMessagesToHistory: vi.fn(async () => undefined),
    getArchivedMessages: vi.fn(async () => []),
    getCompactionRecords: vi.fn(async () => []),
    getCompactionRecord: vi.fn(async () => null),
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
    isHealthy: vi.fn(async () => true),
  };

  return Object.assign(base, overrides);
}

describe('Session lifecycle', () => {
  it('should initialize only once even with concurrent calls', async () => {
    const memoryManager = createMockMemoryManager();
    const session = new Session({
      sessionId: 'session-init-idempotent',
      systemPrompt: 'system',
      memoryManager,
    });

    await Promise.all([
      session.initialize(),
      session.initialize(),
      session.initialize(),
    ]);
    await session.initialize();

    expect(memoryManager.getSession).toHaveBeenCalledTimes(1);
    expect(memoryManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('should throw when compaction is enabled without provider', () => {
    expect(() => {
      new Session({
        systemPrompt: 'system',
        enableCompaction: true,
      });
    }).toThrow('Session compaction requires a provider');
  });
});
