# Hybrid Memory Configuration Examples

## Purpose

Examples for future multi-tier memory routing (short/mid/long).  
Current implementation includes live `file` + `mongodb` adapters; `mysql`/`redis` are still planned.

## 1. File-only (Current Ready)

```ts
createMemoryManager({
    type: 'file',
    connectionString: '.memory',
});
```

## 2. Planned MySQL-only

```ts
createMemoryManager({
    type: 'mysql',
    connectionString: 'mysql://user:pass@localhost:3306/agent_memory',
    config: {
        poolSize: 10,
    },
});
```

## 3. MongoDB-only (Current Ready)

```ts
createMemoryManager({
    type: 'mongodb',
    // connectionString can be omitted if MONGODB_URI exists in env.
    connectionString: 'mongodb://localhost:27017/agent_memory',
    config: {
        dbName: 'agent_memory',
        collectionPrefix: 'memory_',
        // Optional if project doesn't install default module name:
        // moduleName: 'mongodb',
    },
});
```

Environment fallback (when `connectionString` is omitted):

- `MONGODB_URI` -> Mongo connection URI
- `MONGODB_DB` -> default db name
- `MONGODB_COLLECTION_PREFIX` -> collection name prefix

## 4. Planned Redis-only

```ts
createMemoryManager({
    type: 'redis',
    connectionString: 'redis://localhost:6379/0',
    config: {
        keyPrefix: 'agent:v2:',
        ttlSeconds: 3600,
    },
});
```

## 5. Hybrid (Short/Mid/Long Split)

```ts
createMemoryManager({
    type: 'hybrid',
    config: {
        hybrid: {
            shortTerm: {
                type: 'redis',
                connectionString: 'redis://localhost:6379/1',
                config: { ttlSeconds: 1800 },
            },
            midTerm: {
                type: 'mysql',
                connectionString: 'mysql://user:pass@localhost:3306/agent_memory',
            },
            longTerm: {
                type: 'mongodb',
                connectionString: 'mongodb://localhost:27017/agent_memory_archive',
                config: { collectionPrefix: 'long_' },
            },
        },
    },
});
```

## 6. Recommended Routing Intention

- `shortTerm`: active context window only (hot data, cache-like).
- `midTerm`: durable session/history/task/fact records.
- `longTerm`: durable summaries, knowledge facts, retrievable archives.

Practical note:

- Redis should normally stay in `shortTerm` for hot/ephemeral data.
- Large durable history should be stored in `midTerm`/`longTerm` databases (e.g., MySQL/object/vector store).

## 7. Current Status

- `file`: implemented
- `mysql`: planned (factory recognized, adapter not implemented)
- `redis`: planned (factory recognized, adapter not implemented)
- `mongodb`: implemented (runtime driver required, default module name `mongodb`)
- `hybrid`: implemented for tier routing; currently practical with ready tier adapters (`file`, `mongodb`)
