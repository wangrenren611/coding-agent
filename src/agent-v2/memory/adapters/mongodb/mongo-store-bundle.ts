import type {
    CompactionStore,
    ContextStore,
    HistoryStore,
    MemoryStoreBundle,
    SessionStore,
    SubTaskRunStore,
    TaskStore,
} from '../../ports/stores';
import type {
    CompactionRecord,
    CurrentContext,
    HistoryMessage,
    MemoryManagerOptions,
    SessionData,
    SubTaskRunData,
    TaskData,
} from '../../types';
import { MongoConnection, resolveMongoRuntimeConfig } from './driver';

type JsonObject = Record<string, unknown>;

interface EntityDoc<T> {
    _id: string;
    payload: T;
}

interface TaskListDoc {
    _id: string;
    tasks: TaskData[];
}

function normalizeId(raw: unknown): string | null {
    if (typeof raw === 'string' && raw.length > 0) return raw;
    if (raw && typeof raw === 'object' && 'toString' in raw && typeof raw.toString === 'function') {
        const value = raw.toString();
        return typeof value === 'string' && value.length > 0 ? value : null;
    }
    return null;
}

class MongoStoreContext {
    constructor(
        private readonly connection: MongoConnection,
        private readonly collectionPrefix: string
    ) {}

    async prepare(): Promise<void> {
        await this.connection.prepare();
    }

    async collection(baseName: string) {
        return this.connection.collection(`${this.collectionPrefix}${baseName}`);
    }

    async close(): Promise<void> {
        await this.connection.close();
    }
}

class MongoEntityStore<T> {
    constructor(
        private readonly context: MongoStoreContext,
        private readonly collectionName: string
    ) {}

    async prepare(): Promise<void> {
        await this.context.prepare();
    }

    async loadAll(): Promise<Map<string, T>> {
        const collection = await this.context.collection(this.collectionName);
        const docs = await collection.find({}).toArray();
        const items = new Map<string, T>();

        for (const rawDoc of docs) {
            const doc = rawDoc as Partial<EntityDoc<T>> & JsonObject;
            const id = normalizeId(doc._id);
            if (!id || !('payload' in doc)) continue;
            items.set(id, doc.payload as T);
        }

        return items;
    }

    async save(id: string, payload: T): Promise<void> {
        const collection = await this.context.collection(this.collectionName);
        const replacement: EntityDoc<T> = {
            _id: id,
            payload,
        };
        await collection.replaceOne({ _id: id }, replacement as unknown as JsonObject, { upsert: true });
    }
}

class MongoSessionStore implements SessionStore {
    private readonly delegate: MongoEntityStore<SessionData>;

    constructor(context: MongoStoreContext) {
        this.delegate = new MongoEntityStore<SessionData>(context, 'sessions');
    }

    prepare(): Promise<void> {
        return this.delegate.prepare();
    }

    loadAll(): Promise<Map<string, SessionData>> {
        return this.delegate.loadAll();
    }

    save(sessionId: string, session: SessionData): Promise<void> {
        return this.delegate.save(sessionId, session);
    }
}

class MongoContextStore implements ContextStore {
    private readonly delegate: MongoEntityStore<CurrentContext>;

    constructor(context: MongoStoreContext) {
        this.delegate = new MongoEntityStore<CurrentContext>(context, 'contexts');
    }

    prepare(): Promise<void> {
        return this.delegate.prepare();
    }

    loadAll(): Promise<Map<string, CurrentContext>> {
        return this.delegate.loadAll();
    }

    save(sessionId: string, context: CurrentContext): Promise<void> {
        return this.delegate.save(sessionId, context);
    }
}

class MongoHistoryStore implements HistoryStore {
    private readonly delegate: MongoEntityStore<HistoryMessage[]>;

    constructor(context: MongoStoreContext) {
        this.delegate = new MongoEntityStore<HistoryMessage[]>(context, 'histories');
    }

    prepare(): Promise<void> {
        return this.delegate.prepare();
    }

    loadAll(): Promise<Map<string, HistoryMessage[]>> {
        return this.delegate.loadAll();
    }

    save(sessionId: string, history: HistoryMessage[]): Promise<void> {
        return this.delegate.save(sessionId, history);
    }
}

class MongoCompactionStore implements CompactionStore {
    private readonly delegate: MongoEntityStore<CompactionRecord[]>;

    constructor(context: MongoStoreContext) {
        this.delegate = new MongoEntityStore<CompactionRecord[]>(context, 'compactions');
    }

    prepare(): Promise<void> {
        return this.delegate.prepare();
    }

    loadAll(): Promise<Map<string, CompactionRecord[]>> {
        return this.delegate.loadAll();
    }

    save(sessionId: string, records: CompactionRecord[]): Promise<void> {
        return this.delegate.save(sessionId, records);
    }
}

class MongoTaskStore implements TaskStore {
    constructor(private readonly context: MongoStoreContext) {}

    async prepare(): Promise<void> {
        await this.context.prepare();
    }

    async loadAll(): Promise<Map<string, TaskData>> {
        const collection = await this.context.collection('tasks');
        const docs = await collection.find({}).toArray();
        const items = new Map<string, TaskData>();

        for (const rawDoc of docs) {
            const doc = rawDoc as Partial<TaskListDoc> & JsonObject;
            const sessionId = normalizeId(doc._id);
            if (!sessionId || !Array.isArray(doc.tasks)) continue;

            for (const rawTask of doc.tasks) {
                if (!rawTask || typeof rawTask !== 'object') continue;
                const task = rawTask as TaskData;
                if (!task.taskId) continue;
                const existing = items.get(task.taskId);
                if (existing && existing.sessionId !== sessionId) {
                    console.error(
                        `Task ID collision while loading: ${task.taskId} appears in both ${existing.sessionId} and ${sessionId}. Keeping latest record.`
                    );
                }
                items.set(task.taskId, {
                    ...task,
                    sessionId,
                });
            }
        }

        return items;
    }

    async saveBySession(sessionId: string, tasks: TaskData[]): Promise<void> {
        const collection = await this.context.collection('tasks');
        if (tasks.length === 0) {
            await collection.deleteOne({ _id: sessionId });
            return;
        }

        const sorted = [...tasks]
            .map((task) => ({
                ...task,
                sessionId,
            }))
            .sort((a, b) => a.createdAt - b.createdAt);

        const replacement: TaskListDoc = {
            _id: sessionId,
            tasks: sorted,
        };
        await collection.replaceOne({ _id: sessionId }, replacement as unknown as JsonObject, { upsert: true });
    }
}

class MongoSubTaskRunStore implements SubTaskRunStore {
    private readonly delegate: MongoEntityStore<SubTaskRunData>;

    constructor(private readonly context: MongoStoreContext) {
        this.delegate = new MongoEntityStore<SubTaskRunData>(context, 'subtask_runs');
    }

    prepare(): Promise<void> {
        return this.delegate.prepare();
    }

    loadAll(): Promise<Map<string, SubTaskRunData>> {
        return this.delegate.loadAll();
    }

    save(runId: string, run: SubTaskRunData): Promise<void> {
        return this.delegate.save(runId, run);
    }

    async delete(runId: string): Promise<void> {
        const collection = await this.context.collection('subtask_runs');
        await collection.deleteOne({ _id: runId });
    }
}

export function createMongoStoreBundle(options: MemoryManagerOptions): MemoryStoreBundle {
    const config = resolveMongoRuntimeConfig(options.connectionString, options.config);
    const connection = new MongoConnection(config);
    const context = new MongoStoreContext(connection, config.collectionPrefix);

    return {
        sessions: new MongoSessionStore(context),
        contexts: new MongoContextStore(context),
        histories: new MongoHistoryStore(context),
        compactions: new MongoCompactionStore(context),
        tasks: new MongoTaskStore(context),
        subTaskRuns: new MongoSubTaskRunStore(context),
        close: async () => {
            await context.close();
        },
    };
}
