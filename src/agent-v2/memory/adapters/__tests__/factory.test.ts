import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createStoreBundle, isSupportedMemoryManagerType } from '../factory';
import { createFakeMongoModuleLoader, resetFakeMongoServer } from '../mongodb/test-utils/fake-mongo-module';

describe('memory adapter factory', () => {
    let tempDir: string;
    const originalMongoUri = process.env.MONGODB_URI;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-adapter-factory-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
        resetFakeMongoServer();
        if (originalMongoUri === undefined) {
            delete process.env.MONGODB_URI;
        } else {
            process.env.MONGODB_URI = originalMongoUri;
        }
    });

    it('recognizes supported manager types', () => {
        expect(isSupportedMemoryManagerType('file')).toBe(true);
        expect(isSupportedMemoryManagerType('mysql')).toBe(true);
        expect(isSupportedMemoryManagerType('redis')).toBe(true);
        expect(isSupportedMemoryManagerType('mongodb')).toBe(true);
        expect(isSupportedMemoryManagerType('hybrid')).toBe(true);
        expect(isSupportedMemoryManagerType('sqlite')).toBe(false);
    });

    it('builds file bundle and persists a session aggregate', async () => {
        const bundle = createStoreBundle({
            type: 'file',
            connectionString: tempDir,
        });

        await bundle.sessions.prepare();
        const now = Date.now();
        await bundle.sessions.save('s1', {
            id: 's1',
            sessionId: 's1',
            systemPrompt: 'sys',
            currentContextId: 'c1',
            totalMessages: 1,
            compactionCount: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        const loaded = await bundle.sessions.loadAll();
        expect(loaded.get('s1')?.sessionId).toBe('s1');
        await bundle.close();
    });

    it('builds hybrid bundle with default tier file paths', async () => {
        const root = path.join(tempDir, 'hybrid-root');
        const bundle = createStoreBundle({
            type: 'hybrid',
            connectionString: root,
        });

        await bundle.sessions.prepare();
        await bundle.contexts.prepare();
        await bundle.tasks.prepare();

        const now = Date.now();
        await bundle.sessions.save('s1', {
            id: 's1',
            sessionId: 's1',
            systemPrompt: 'sys',
            currentContextId: 'c1',
            totalMessages: 1,
            compactionCount: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        await bundle.tasks.saveBySession('s1', [
            {
                id: 't1',
                taskId: 't1',
                sessionId: 's1',
                status: 'pending',
                title: 'task',
                createdAt: now,
                updatedAt: now,
            },
        ]);

        await bundle.contexts.save('s1', {
            id: 'c1',
            contextId: 'c1',
            sessionId: 's1',
            systemPrompt: 'sys',
            messages: [{ messageId: 'system', role: 'system', content: 'sys' }],
            version: 1,
            createdAt: now,
            updatedAt: now,
        });

        await expect(fs.access(path.join(root, 'mid-term', 'sessions', 's1.json'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(root, 'short-term', 'contexts', 's1.json'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(root, 'mid-term', 'tasks', 'task-list-s1.json'))).resolves.toBeUndefined();
        await bundle.close();
    });

    it('builds mongodb bundle and persists session aggregate with injected driver', async () => {
        const bundle = createStoreBundle({
            type: 'mongodb',
            connectionString: 'mongodb://localhost:27017/agent_memory',
            config: {
                moduleLoader: createFakeMongoModuleLoader(),
                dbName: 'agent_memory_factory_test',
            },
        });

        await bundle.sessions.prepare();

        const now = Date.now();
        await bundle.sessions.save('mongo-s1', {
            id: 'mongo-s1',
            sessionId: 'mongo-s1',
            systemPrompt: 'sys',
            currentContextId: 'mongo-c1',
            totalMessages: 1,
            compactionCount: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        const loaded = await bundle.sessions.loadAll();
        expect(loaded.get('mongo-s1')?.sessionId).toBe('mongo-s1');

        await bundle.close();
    });

    it('surfaces actionable error when mongodb driver module is unavailable', async () => {
        const bundle = createStoreBundle({
            type: 'mongodb',
            connectionString: 'mongodb://localhost:27017/agent_memory',
            config: {
                moduleName: '__missing_mongodb_driver__',
            },
        });

        await expect(bundle.sessions.prepare()).rejects.toThrow(
            'MongoDB backend requires npm package "__missing_mongodb_driver__"'
        );
        await bundle.close();
    });

    it('uses MONGODB_URI fallback when connectionString is omitted', async () => {
        process.env.MONGODB_URI = 'mongodb://localhost:27017/agent_memory_env';

        const bundle = createStoreBundle({
            type: 'mongodb',
            config: {
                dbName: 'agent_memory_env',
                moduleLoader: createFakeMongoModuleLoader(),
            },
        });

        await bundle.sessions.prepare();
        const now = Date.now();
        await bundle.sessions.save('env-s1', {
            id: 'env-s1',
            sessionId: 'env-s1',
            systemPrompt: 'sys',
            currentContextId: 'env-c1',
            totalMessages: 1,
            compactionCount: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        const loaded = await bundle.sessions.loadAll();
        expect(loaded.get('env-s1')?.sessionId).toBe('env-s1');
        await bundle.close();
    });
});
