import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryManager } from './index';
import type { IMemoryManager } from './types';
import { createFakeMongoModuleLoader, resetFakeMongoServer } from './adapters/mongodb/test-utils/fake-mongo-module';

describe('MongoMemoryManager persistence', () => {
    const uri = 'mongodb://localhost:27017/agent_memory_test';
    let memoryManager: IMemoryManager | null = null;

    function createMongoMemory(): IMemoryManager {
        return createMemoryManager({
            type: 'mongodb',
            connectionString: uri,
            config: {
                dbName: 'agent_memory_test',
                collectionPrefix: 'test_',
                moduleLoader: createFakeMongoModuleLoader(),
            },
        });
    }

    beforeEach(() => {
        resetFakeMongoServer();
    });

    afterEach(async () => {
        if (memoryManager) {
            await memoryManager.close();
            memoryManager = null;
        }
    });

    it('should persist and reload session/context/history/task/subtask data', async () => {
        memoryManager = createMongoMemory();
        await memoryManager.initialize();

        const sessionId = await memoryManager.createSession('mongo-session-1', 'mongo system');
        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'mongo-user-1',
            role: 'user',
            content: 'hello mongo',
            type: 'text',
        });
        await memoryManager.saveTask({
            id: 'mongo-task-1',
            taskId: 'mongo-task-1',
            sessionId,
            status: 'pending',
            title: 'mongo task',
        });
        await memoryManager.saveSubTaskRun({
            id: 'mongo-run-1',
            runId: 'mongo-run-1',
            parentSessionId: sessionId,
            childSessionId: `${sessionId}::subtask::mongo-run-1`,
            mode: 'foreground',
            status: 'running',
            description: 'mongo run',
            prompt: 'mongo run',
            subagentType: 'explore',
            startedAt: Date.now(),
            toolsUsed: [],
        });
        await memoryManager.compactContext(sessionId, {
            keepLastN: 0,
            summaryMessage: {
                messageId: 'mongo-summary-1',
                role: 'assistant',
                content: 'summary',
                type: 'summary',
            },
        });

        await memoryManager.close();
        memoryManager = null;

        memoryManager = createMongoMemory();
        await memoryManager.initialize();

        const session = await memoryManager.getSession(sessionId);
        expect(session?.sessionId).toBe(sessionId);

        const context = await memoryManager.getCurrentContext(sessionId);
        expect(context?.messages.some((item) => item.messageId === 'mongo-summary-1')).toBe(true);

        const history = await memoryManager.getFullHistory({ sessionId });
        expect(history.length).toBeGreaterThan(0);

        const tasks = await memoryManager.queryTasks({ sessionId });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].taskId).toBe('mongo-task-1');

        const run = await memoryManager.getSubTaskRun('mongo-run-1');
        expect(run?.runId).toBe('mongo-run-1');

        const records = await memoryManager.getCompactionRecords(sessionId);
        expect(records).toHaveLength(1);
    });
});
