type JsonObject = Record<string, unknown>;

export interface MongoCollectionLike {
    find(filter: JsonObject): { toArray(): Promise<unknown[]> };
    replaceOne(filter: JsonObject, replacement: JsonObject, options?: JsonObject): Promise<unknown>;
    deleteOne(filter: JsonObject): Promise<unknown>;
}

export interface MongoDbLike {
    collection(name: string): MongoCollectionLike;
}

export interface MongoClientLike {
    connect?: () => Promise<unknown> | unknown;
    db: (name: string) => MongoDbLike;
    close?: () => Promise<unknown> | unknown;
}

type MongoClientConstructor = new (uri: string, options?: JsonObject) => MongoClientLike;

interface MongoModuleShape {
    MongoClient?: MongoClientConstructor;
    default?: {
        MongoClient?: MongoClientConstructor;
    };
}

export interface MongoRuntimeConfig {
    connectionString: string;
    dbName: string;
    collectionPrefix: string;
    moduleName: string;
    clientOptions?: JsonObject;
    moduleLoader?: () => Promise<unknown>;
}

function asObject(value: unknown): JsonObject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value as JsonObject;
}

function readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function resolveDbNameFromConnectionString(connectionString: string): string | undefined {
    try {
        const parsed = new URL(connectionString);
        const pathname = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
        if (!pathname) return undefined;
        return decodeURIComponent(pathname);
    } catch {
        return undefined;
    }
}

export function resolveMongoRuntimeConfig(
    connectionString: string | undefined,
    rawConfig: Record<string, unknown> | undefined
): MongoRuntimeConfig {
    const connectionEnvKey = readString(rawConfig?.connectionEnvKey) || 'MONGODB_URI';
    const dbNameEnvKey = readString(rawConfig?.dbNameEnvKey) || 'MONGODB_DB';
    const collectionPrefixEnvKey = readString(rawConfig?.collectionPrefixEnvKey) || 'MONGODB_COLLECTION_PREFIX';

    const connectionFromConfig = readString(rawConfig?.connectionString);
    const connectionFromEnv = readString(process.env[connectionEnvKey]);
    const resolvedConnectionString = readString(connectionString) || connectionFromConfig || connectionFromEnv;
    if (!resolvedConnectionString) {
        throw new Error(
            `MongoDB backend requires connectionString (mongodb://...) or env ${connectionEnvKey}.`
        );
    }

    const dbNameFromConfig = readString(rawConfig?.dbName);
    const dbNameFromEnv = readString(process.env[dbNameEnvKey]);
    const resolvedDbName =
        dbNameFromConfig || dbNameFromEnv || resolveDbNameFromConnectionString(resolvedConnectionString) || 'agent_memory';
    const collectionPrefix =
        readString(rawConfig?.collectionPrefix) || readString(process.env[collectionPrefixEnvKey]) || 'memory_';
    const moduleName = readString(rawConfig?.moduleName) || 'mongodb';
    const clientOptions = asObject(rawConfig?.clientOptions);
    const moduleLoader = typeof rawConfig?.moduleLoader === 'function' ? (rawConfig.moduleLoader as () => Promise<unknown>) : undefined;

    return {
        connectionString: resolvedConnectionString,
        dbName: resolvedDbName,
        collectionPrefix,
        moduleName,
        clientOptions,
        moduleLoader,
    };
}

function ensureMongoClientConstructor(moduleShape: unknown): MongoClientConstructor {
    const candidate = moduleShape as MongoModuleShape;
    const ctor = candidate.MongoClient || candidate.default?.MongoClient;
    if (typeof ctor !== 'function') {
        throw new Error('MongoDB backend failed to resolve MongoClient from driver module export.');
    }
    return ctor;
}

async function loadMongoModule(config: MongoRuntimeConfig): Promise<unknown> {
    if (config.moduleLoader) {
        return config.moduleLoader();
    }

    const moduleName = config.moduleName;
    try {
        return await import(moduleName);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `MongoDB backend requires npm package "${moduleName}". Install it (e.g. pnpm add mongodb). Original error: ${message}`
        );
    }
}

async function maybeAwait(value: Promise<unknown> | unknown): Promise<void> {
    await value;
}

export class MongoConnection {
    private dbPromise: Promise<MongoDbLike> | null = null;
    private client: MongoClientLike | null = null;

    constructor(private readonly config: MongoRuntimeConfig) {}

    async prepare(): Promise<void> {
        await this.getDb();
    }

    async collection(name: string): Promise<MongoCollectionLike> {
        const db = await this.getDb();
        return db.collection(name);
    }

    async close(): Promise<void> {
        if (!this.client?.close) return;
        await maybeAwait(this.client.close());
        this.client = null;
        this.dbPromise = null;
    }

    private async getDb(): Promise<MongoDbLike> {
        if (!this.dbPromise) {
            this.dbPromise = this.connect();
        }
        return this.dbPromise;
    }

    private async connect(): Promise<MongoDbLike> {
        const moduleShape = await loadMongoModule(this.config);
        const MongoClient = ensureMongoClientConstructor(moduleShape);
        const client = new MongoClient(this.config.connectionString, this.config.clientOptions);
        if (client.connect) {
            await maybeAwait(client.connect());
        }
        this.client = client;
        return client.db(this.config.dbName);
    }
}
