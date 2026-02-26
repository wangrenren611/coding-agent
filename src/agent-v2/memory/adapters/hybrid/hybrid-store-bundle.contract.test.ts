import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
    CompactionRecord,
    CurrentContext,
    HistoryMessage,
    SessionData,
    SubTaskRunData,
    TaskData,
} from '../../types';
import { createHybridStoreBundle } from './hybrid-store-bundle';
import { createFakeMongoModuleLoader, resetFakeMongoServer } from '../mongodb/test-utils/fake-mongo-module';

describe('Hybrid store bundle contract', () => {
    let tempDir: string;
    let shortPath: string;
    let midPath: string;
    let longPath: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-hybrid-store-contract-'));
        shortPath = path.join(tempDir, 'short');
        midPath = path.join(tempDir, 'mid');
        longPath = path.join(tempDir, 'long');
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
        resetFakeMongoServer();
    });

    it('routes short-term and mid-term aggregates to configured tier backends', async () => {
        const bundle = createHybridStoreBundle({
            type: 'hybrid',
            config: {
                hybrid: {
                    shortTerm: { type: 'file', connectionString: shortPath },
                    midTerm: { type: 'file', connectionString: midPath },
                    longTerm: { type: 'file', connectionString: longPath },
                },
            },
        });

        await Promise.all([
            bundle.sessions.prepare(),
            bundle.contexts.prepare(),
            bundle.histories.prepare(),
            bundle.compactions.prepare(),
            bundle.tasks.prepare(),
            bundle.subTaskRuns.prepare(),
        ]);

        const now = Date.now();
        const session: SessionData = {
            id: 's1',
            sessionId: 's1',
            systemPrompt: 'sys',
            currentContextId: 'c1',
            totalMessages: 1,
            compactionCount: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        };
        const context: CurrentContext = {
            id: 'c1',
            contextId: 'c1',
            sessionId: 's1',
            systemPrompt: 'sys',
            messages: [{ messageId: 'system', role: 'system', content: 'sys' }],
            version: 1,
            createdAt: now,
            updatedAt: now,
        };
        const history: HistoryMessage[] = [{ messageId: 'system', role: 'system', content: 'sys', sequence: 1 }];
        const records: CompactionRecord[] = [];
        const task: TaskData = {
            id: 't1',
            taskId: 't1',
            sessionId: 's1',
            status: 'pending',
            title: 'task',
            createdAt: now,
            updatedAt: now,
        };
        const run: SubTaskRunData = {
            id: 'r1',
            runId: 'r1',
            parentSessionId: 's1',
            childSessionId: 's1::subtask::r1',
            mode: 'foreground',
            status: 'running',
            description: 'run',
            prompt: 'run',
            subagentType: 'explore',
            startedAt: now,
            toolsUsed: [],
            messageCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        await bundle.sessions.save('s1', session);
        await bundle.contexts.save('s1', context);
        await bundle.histories.save('s1', history);
        await bundle.compactions.save('s1', records);
        await bundle.tasks.saveBySession('s1', [task]);
        await bundle.subTaskRuns.save('r1', run);

        await expect(fs.access(path.join(shortPath, 'contexts', 's1.json'))).resolves.toBeUndefined();

        await expect(fs.access(path.join(midPath, 'sessions', 's1.json'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(midPath, 'histories', 's1.json'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(midPath, 'compactions', 's1.json'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(midPath, 'tasks', 'task-list-s1.json'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(midPath, 'subtask-runs', 'subtask-run-r1.json'))).resolves.toBeUndefined();

        await expect(fs.access(path.join(longPath, 'sessions', 's1.json'))).rejects.toThrow();

        await bundle.close();
    });

    it('supports hybrid routing with mongodb as durable mid-term backend', async () => {
        const bundle = createHybridStoreBundle({
            type: 'hybrid',
            config: {
                hybrid: {
                    shortTerm: { type: 'file', connectionString: shortPath },
                    midTerm: {
                        type: 'mongodb',
                        connectionString: 'mongodb://localhost:27017/agent_memory_hybrid_test',
                        config: {
                            dbName: 'agent_memory_hybrid_test',
                            collectionPrefix: 'hybrid_',
                            moduleLoader: createFakeMongoModuleLoader(),
                        },
                    },
                },
            },
        });

        await Promise.all([
            bundle.sessions.prepare(),
            bundle.contexts.prepare(),
            bundle.histories.prepare(),
            bundle.compactions.prepare(),
            bundle.tasks.prepare(),
            bundle.subTaskRuns.prepare(),
        ]);

        const now = Date.now();
        const session: SessionData = {
            id: 'mongo-s1',
            sessionId: 'mongo-s1',
            systemPrompt: 'sys',
            currentContextId: 'mongo-c1',
            totalMessages: 1,
            compactionCount: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        };
        const context: CurrentContext = {
            id: 'mongo-c1',
            contextId: 'mongo-c1',
            sessionId: 'mongo-s1',
            systemPrompt: 'sys',
            messages: [{ messageId: 'system', role: 'system', content: 'sys' }],
            version: 1,
            createdAt: now,
            updatedAt: now,
        };
        const history: HistoryMessage[] = [{ messageId: 'system', role: 'system', content: 'sys', sequence: 1 }];
        const records: CompactionRecord[] = [];
        const task: TaskData = {
            id: 'mongo-t1',
            taskId: 'mongo-t1',
            sessionId: 'mongo-s1',
            status: 'pending',
            title: 'task',
            createdAt: now,
            updatedAt: now,
        };
        const run: SubTaskRunData = {
            id: 'mongo-r1',
            runId: 'mongo-r1',
            parentSessionId: 'mongo-s1',
            childSessionId: 'mongo-s1::subtask::mongo-r1',
            mode: 'foreground',
            status: 'running',
            description: 'run',
            prompt: 'run',
            subagentType: 'explore',
            startedAt: now,
            toolsUsed: [],
            messageCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        await bundle.sessions.save('mongo-s1', session);
        await bundle.contexts.save('mongo-s1', context);
        await bundle.histories.save('mongo-s1', history);
        await bundle.compactions.save('mongo-s1', records);
        await bundle.tasks.saveBySession('mongo-s1', [task]);
        await bundle.subTaskRuns.save('mongo-r1', run);

        await expect(fs.access(path.join(shortPath, 'contexts', 'mongo-s1.json'))).resolves.toBeUndefined();

        const loadedSessions = await bundle.sessions.loadAll();
        const loadedTasks = await bundle.tasks.loadAll();
        const loadedRuns = await bundle.subTaskRuns.loadAll();

        expect(loadedSessions.get('mongo-s1')?.sessionId).toBe('mongo-s1');
        expect(loadedTasks.get('mongo-t1')?.taskId).toBe('mongo-t1');
        expect(loadedRuns.get('mongo-r1')?.runId).toBe('mongo-r1');

        await bundle.close();
    });
});
