import type {
    CompactionStore,
    ContextStore,
    HistoryStore,
    MemoryStoreBundle,
    SessionStore,
    SubTaskRunStore,
    TaskStore,
} from '../ports/stores';
import type { MemoryManagerOptions } from '../types';
import type { CompactionRecord, CurrentContext, HistoryMessage, SessionData, SubTaskRunData, TaskData } from '../types';

function buildUnsupportedError(type: string): Error {
    return new Error(`Memory backend "${type}" is not implemented yet.`);
}

class UnsupportedSessionStore implements SessionStore {
    constructor(private readonly type: string) {}
    async prepare(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
    async loadAll(): Promise<Map<string, SessionData>> {
        throw buildUnsupportedError(this.type);
    }
    async save(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
}

class UnsupportedContextStore implements ContextStore {
    constructor(private readonly type: string) {}
    async prepare(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
    async loadAll(): Promise<Map<string, CurrentContext>> {
        throw buildUnsupportedError(this.type);
    }
    async save(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
}

class UnsupportedHistoryStore implements HistoryStore {
    constructor(private readonly type: string) {}
    async prepare(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
    async loadAll(): Promise<Map<string, HistoryMessage[]>> {
        throw buildUnsupportedError(this.type);
    }
    async save(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
}

class UnsupportedCompactionStore implements CompactionStore {
    constructor(private readonly type: string) {}
    async prepare(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
    async loadAll(): Promise<Map<string, CompactionRecord[]>> {
        throw buildUnsupportedError(this.type);
    }
    async save(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
}

class UnsupportedTaskStore implements TaskStore {
    constructor(private readonly type: string) {}
    async prepare(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
    async loadAll(): Promise<Map<string, TaskData>> {
        throw buildUnsupportedError(this.type);
    }
    async saveBySession(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
}

class UnsupportedSubTaskRunStore implements SubTaskRunStore {
    constructor(private readonly type: string) {}
    async prepare(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
    async loadAll(): Promise<Map<string, SubTaskRunData>> {
        throw buildUnsupportedError(this.type);
    }
    async save(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
    async delete(): Promise<void> {
        throw buildUnsupportedError(this.type);
    }
}

export function createUnsupportedStoreBundle(options: MemoryManagerOptions): MemoryStoreBundle {
    const type = options.type;
    return {
        sessions: new UnsupportedSessionStore(type),
        contexts: new UnsupportedContextStore(type),
        histories: new UnsupportedHistoryStore(type),
        compactions: new UnsupportedCompactionStore(type),
        tasks: new UnsupportedTaskStore(type),
        subTaskRuns: new UnsupportedSubTaskRunStore(type),
        close: async () => {},
    };
}
