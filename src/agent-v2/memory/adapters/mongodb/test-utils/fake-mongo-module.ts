type JsonObject = Record<string, unknown>;

type DocumentState = Map<string, JsonObject>;
type CollectionCatalog = Map<string, DocumentState>;
type DatabaseCatalog = Map<string, CollectionCatalog>;
type ServerState = Map<string, DatabaseCatalog>;

const SERVER_STATE: ServerState = new Map();

function deepClone<T>(value: T): T {
    return structuredClone(value);
}

function ensureCollectionState(uri: string, dbName: string, collectionName: string): DocumentState {
    const serverKey = uri;
    const dbKey = dbName;

    let server = SERVER_STATE.get(serverKey);
    if (!server) {
        server = new Map<string, CollectionCatalog>();
        SERVER_STATE.set(serverKey, server);
    }

    let database = server.get(dbKey);
    if (!database) {
        database = new Map<string, DocumentState>();
        server.set(dbKey, database);
    }

    let collectionState = database.get(collectionName);
    if (!collectionState) {
        collectionState = new Map<string, JsonObject>();
        database.set(collectionName, collectionState);
    }

    return collectionState;
}

class FakeCursor {
    constructor(private readonly docs: JsonObject[]) {}

    async toArray(): Promise<JsonObject[]> {
        return this.docs.map((doc) => deepClone(doc));
    }
}

class FakeCollection {
    constructor(private readonly state: DocumentState) {}

    find(filter: JsonObject): FakeCursor {
        if (typeof filter._id === 'string') {
            const doc = this.state.get(filter._id);
            return new FakeCursor(doc ? [doc] : []);
        }
        return new FakeCursor(Array.from(this.state.values()));
    }

    async replaceOne(filter: JsonObject, replacement: JsonObject, options?: JsonObject): Promise<void> {
        const filterId = typeof filter._id === 'string' ? filter._id : undefined;
        const replacementId = typeof replacement._id === 'string' ? replacement._id : undefined;
        const id = replacementId || filterId;

        if (!id) {
            if (options?.upsert) return;
            throw new Error('FakeMongo: replaceOne requires string _id');
        }

        this.state.set(id, deepClone({ ...replacement, _id: id }));
    }

    async deleteOne(filter: JsonObject): Promise<void> {
        if (typeof filter._id !== 'string') return;
        this.state.delete(filter._id);
    }
}

class FakeDb {
    constructor(
        private readonly uri: string,
        private readonly dbName: string
    ) {}

    collection(name: string): FakeCollection {
        return new FakeCollection(ensureCollectionState(this.uri, this.dbName, name));
    }
}

class FakeMongoClient {
    constructor(
        private readonly uri: string,
        private readonly _options?: JsonObject
    ) {}

    async connect(): Promise<void> {
        return;
    }

    db(name: string): FakeDb {
        return new FakeDb(this.uri, name);
    }

    async close(): Promise<void> {
        return;
    }
}

export function resetFakeMongoServer(): void {
    SERVER_STATE.clear();
}

export function createFakeMongoModuleLoader(): () => Promise<unknown> {
    return async () => ({
        MongoClient: FakeMongoClient,
    });
}
