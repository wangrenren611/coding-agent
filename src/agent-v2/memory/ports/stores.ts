import type { CompactionRecord, CurrentContext, HistoryMessage, SessionData, SubTaskRunData, TaskData } from '../types';

export interface SessionStore {
    prepare(): Promise<void>;
    loadAll(): Promise<Map<string, SessionData>>;
    save(sessionId: string, session: SessionData): Promise<void>;
}

export interface ContextStore {
    prepare(): Promise<void>;
    loadAll(): Promise<Map<string, CurrentContext>>;
    save(sessionId: string, context: CurrentContext): Promise<void>;
}

export interface HistoryStore {
    prepare(): Promise<void>;
    loadAll(): Promise<Map<string, HistoryMessage[]>>;
    save(sessionId: string, history: HistoryMessage[]): Promise<void>;
}

export interface CompactionStore {
    prepare(): Promise<void>;
    loadAll(): Promise<Map<string, CompactionRecord[]>>;
    save(sessionId: string, records: CompactionRecord[]): Promise<void>;
}

export interface TaskStore {
    prepare(): Promise<void>;
    loadAll(): Promise<Map<string, TaskData>>;
    saveBySession(sessionId: string, tasks: TaskData[]): Promise<void>;
}

export interface SubTaskRunStore {
    prepare(): Promise<void>;
    loadAll(): Promise<Map<string, SubTaskRunData>>;
    save(runId: string, run: SubTaskRunData): Promise<void>;
    delete(runId: string): Promise<void>;
}

export interface MemoryStoreBundle {
    sessions: SessionStore;
    contexts: ContextStore;
    histories: HistoryStore;
    compactions: CompactionStore;
    tasks: TaskStore;
    subTaskRuns: SubTaskRunStore;
    close(): Promise<void>;
}
