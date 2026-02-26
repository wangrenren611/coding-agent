import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFileStoreBundle } from './file-store-bundle';
import type {
    CompactionRecord,
    CurrentContext,
    HistoryMessage,
    SessionData,
    SubTaskRunData,
    TaskData,
} from '../../types';

describe('File store bundle contract', () => {
    let tempDir: string;
    let basePath: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-file-store-contract-'));
        basePath = path.join(tempDir, 'memory');
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should persist and load all aggregates through store ports', async () => {
        const bundle = createFileStoreBundle(basePath);
        await Promise.all([
            bundle.sessions.prepare(),
            bundle.contexts.prepare(),
            bundle.histories.prepare(),
            bundle.compactions.prepare(),
            bundle.tasks.prepare(),
            bundle.subTaskRuns.prepare(),
        ]);

        const session: SessionData = {
            id: 's1',
            sessionId: 's1',
            systemPrompt: 'sys',
            currentContextId: 'c1',
            totalMessages: 1,
            compactionCount: 0,
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        const context: CurrentContext = {
            id: 'c1',
            contextId: 'c1',
            sessionId: 's1',
            systemPrompt: 'sys',
            messages: [{ messageId: 'system', role: 'system', content: 'sys' }],
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        const history: HistoryMessage[] = [{ messageId: 'system', role: 'system', content: 'sys', sequence: 1 }];
        const records: CompactionRecord[] = [];
        const task: TaskData = {
            id: 't1',
            taskId: 't1',
            sessionId: 's1',
            status: 'pending',
            title: 'task',
            createdAt: Date.now(),
            updatedAt: Date.now(),
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
            startedAt: Date.now(),
            toolsUsed: [],
            messageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await bundle.sessions.save('s1', session);
        await bundle.contexts.save('s1', context);
        await bundle.histories.save('s1', history);
        await bundle.compactions.save('s1', records);
        await bundle.tasks.saveBySession('s1', [task]);
        await bundle.subTaskRuns.save('r1', run);

        const sessions = await bundle.sessions.loadAll();
        const contexts = await bundle.contexts.loadAll();
        const histories = await bundle.histories.loadAll();
        const compactions = await bundle.compactions.loadAll();
        const tasks = await bundle.tasks.loadAll();
        const runs = await bundle.subTaskRuns.loadAll();

        expect(sessions.get('s1')?.sessionId).toBe('s1');
        expect(contexts.get('s1')?.contextId).toBe('c1');
        expect(histories.get('s1')?.length).toBe(1);
        expect(compactions.get('s1')?.length).toBe(0);
        expect(tasks.get('t1')?.taskId).toBe('t1');
        expect(runs.get('r1')?.runId).toBe('r1');

        await bundle.tasks.saveBySession('s1', []);
        const reloadedTasks = await bundle.tasks.loadAll();
        expect(reloadedTasks.size).toBe(0);

        await bundle.close();
    });
});
