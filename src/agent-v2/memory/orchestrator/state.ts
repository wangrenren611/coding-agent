import type { CurrentContext, HistoryMessage, SessionData, SubTaskRunData, TaskData, CompactionRecord } from '../types';

export interface MemoryCache {
    sessions: Map<string, SessionData>;
    contexts: Map<string, CurrentContext>;
    histories: Map<string, HistoryMessage[]>;
    compactionRecords: Map<string, CompactionRecord[]>;
    tasks: Map<string, TaskData>;
    subTaskRuns: Map<string, SubTaskRunData>;
}

export function createMemoryCache(): MemoryCache {
    return {
        sessions: new Map(),
        contexts: new Map(),
        histories: new Map(),
        compactionRecords: new Map(),
        tasks: new Map(),
        subTaskRuns: new Map(),
    };
}

export function requireSession(cache: MemoryCache, sessionId: string): SessionData {
    const session = cache.sessions.get(sessionId);
    if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
}

export function requireContext(cache: MemoryCache, sessionId: string): CurrentContext {
    const context = cache.contexts.get(sessionId);
    if (!context) {
        throw new Error(`Context not found for session: ${sessionId}`);
    }
    return context;
}

export function ensureHistoryList(cache: MemoryCache, sessionId: string): HistoryMessage[] {
    const existing = cache.histories.get(sessionId);
    if (existing) return existing;
    const created: HistoryMessage[] = [];
    cache.histories.set(sessionId, created);
    return created;
}

export function normalizeSubTaskRun(raw: SubTaskRunData): SubTaskRunData {
    const messageCount = raw.messageCount ?? (Array.isArray(raw.messages) ? raw.messages.length : 0);
    const rest = { ...raw };
    delete rest.messages;
    return {
        ...rest,
        messageCount,
    };
}
