import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createMemoryManager } from '../index';
import type { IMemoryManager } from '../types';
import type { Usage } from '../../../providers';

function createUsage(total = 30): Usage {
    return {
        prompt_tokens: Math.floor(total / 2),
        completion_tokens: total - Math.floor(total / 2),
        total_tokens: total,
        prompt_cache_miss_tokens: Math.floor(total / 2),
        prompt_cache_hit_tokens: 0,
    };
}

describe('FileMemoryManager persistence', () => {
    let tempDir: string;
    let memoryManager: IMemoryManager;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-memory-'));
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should reject unsupported memory manager types', () => {
        expect(() =>
            createMemoryManager({
                type: 'sqlite',
                connectionString: tempDir,
            })
        ).toThrow('Unsupported memory manager type: sqlite');
    });

    it('should allow mysql type but fail on initialize until adapter is implemented', async () => {
        const mysqlMemory = createMemoryManager({
            type: 'mysql',
            connectionString: 'mysql://localhost:3306/agent_memory',
        });

        await expect(mysqlMemory.initialize()).rejects.toThrow('Memory backend "mysql" is not implemented yet.');
        await mysqlMemory.close();
    });

    it('should fail mongodb initialize with clear install guidance when driver is missing', async () => {
        const mongodbMemory = createMemoryManager({
            type: 'mongodb',
            connectionString: 'mongodb://localhost:27017/agent_memory',
            config: {
                moduleName: '__missing_mongodb_driver__',
            },
        });

        await expect(mongodbMemory.initialize()).rejects.toThrow(
            'MongoDB backend requires npm package "__missing_mongodb_driver__"'
        );
        await mongodbMemory.close();
    });

    it('should route hybrid storage to different file tiers', async () => {
        const shortPath = path.join(tempDir, 'hybrid-short');
        const midPath = path.join(tempDir, 'hybrid-mid');

        const hybridMemory = createMemoryManager({
            type: 'hybrid',
            config: {
                hybrid: {
                    shortTerm: {
                        type: 'file',
                        connectionString: shortPath,
                    },
                    midTerm: {
                        type: 'file',
                        connectionString: midPath,
                    },
                },
            },
        });

        await hybridMemory.initialize();

        const sessionId = await hybridMemory.createSession('hybrid-session', 'hybrid system');
        await hybridMemory.addMessageToContext(sessionId, {
            messageId: 'hybrid-user-1',
            role: 'user',
            content: 'hello',
            type: 'text',
        });
        await hybridMemory.saveTask({
            id: 'hybrid-task-1',
            taskId: 'hybrid-task-1',
            sessionId,
            status: 'pending',
            title: 'hybrid task',
        });
        await hybridMemory.saveSubTaskRun({
            id: 'hybrid-run-1',
            runId: 'hybrid-run-1',
            parentSessionId: sessionId,
            childSessionId: `${sessionId}::subtask::hybrid-run-1`,
            mode: 'foreground',
            status: 'running',
            description: 'hybrid run',
            prompt: 'hybrid run',
            subagentType: 'explore',
            startedAt: Date.now(),
            toolsUsed: [],
        });

        await hybridMemory.compactContext(sessionId, {
            keepLastN: 0,
            summaryMessage: {
                messageId: 'hybrid-summary-1',
                role: 'assistant',
                content: 'summary',
                type: 'summary',
            },
        });

        await hybridMemory.close();

        await expect(
            fs.access(path.join(shortPath, 'contexts', `${encodeURIComponent(sessionId)}.json`))
        ).resolves.toBeUndefined();

        await expect(
            fs.access(path.join(midPath, 'sessions', `${encodeURIComponent(sessionId)}.json`))
        ).resolves.toBeUndefined();
        await expect(
            fs.access(path.join(midPath, 'histories', `${encodeURIComponent(sessionId)}.json`))
        ).resolves.toBeUndefined();

        await expect(
            fs.access(path.join(midPath, 'tasks', `task-list-${encodeURIComponent(sessionId)}.json`))
        ).resolves.toBeUndefined();
        await expect(
            fs.access(path.join(midPath, 'subtask-runs', `subtask-run-${encodeURIComponent('hybrid-run-1')}.json`))
        ).resolves.toBeUndefined();
        await expect(
            fs.access(path.join(midPath, 'compactions', `${encodeURIComponent(sessionId)}.json`))
        ).resolves.toBeUndefined();
    });

    it('should upsert streamed assistant message instead of duplicating history entries', async () => {
        const sessionId = await memoryManager.createSession('session-stream-upsert', 'test system');
        const usage = createUsage(28);
        const messageId = 'assistant-stream-1';

        await memoryManager.addMessageToContext(sessionId, {
            messageId,
            role: 'assistant',
            content: 'partial',
            type: 'text',
        });

        await memoryManager.addMessageToContext(sessionId, {
            messageId,
            role: 'assistant',
            content: 'final content',
            type: 'text',
            finish_reason: 'stop',
            usage,
        });

        const history = await memoryManager.getFullHistory({ sessionId });
        const assistantEntries = history.filter((item) => item.messageId === messageId);
        expect(assistantEntries).toHaveLength(1);
        expect(assistantEntries[0].content).toBe('final content');
        expect(assistantEntries[0].usage).toEqual(usage);

        const context = await memoryManager.getCurrentContext(sessionId);
        const contextAssistantEntries = context?.messages.filter((item) => item.messageId === messageId) || [];
        expect(contextAssistantEntries).toHaveLength(1);
        expect(contextAssistantEntries[0].usage).toEqual(usage);
    });

    it('should keep history and context usage in sync on updateMessageInContext', async () => {
        const sessionId = await memoryManager.createSession('session-update-usage', 'test system');
        const messageId = 'assistant-usage-update';
        const usage = createUsage(42);

        await memoryManager.addMessageToContext(sessionId, {
            messageId,
            role: 'assistant',
            content: 'response',
            type: 'text',
        });

        await memoryManager.updateMessageInContext(sessionId, messageId, {
            usage,
            finish_reason: 'stop',
        });

        const context = await memoryManager.getCurrentContext(sessionId);
        const contextMessage = context?.messages.find((item) => item.messageId === messageId);
        expect(contextMessage?.usage).toEqual(usage);

        const history = await memoryManager.getFullHistory({ sessionId });
        const historyMessage = history.find((item) => item.messageId === messageId);
        expect(historyMessage?.usage).toEqual(usage);
        expect(historyMessage?.finish_reason).toBe('stop');
    });

    it('should persist sub task run records and reload from disk', async () => {
        const parentSessionId = await memoryManager.createSession('session-parent', 'parent system');
        const runId = 'task_123_abc';
        const childSessionId = `${parentSessionId}::subtask::${runId}`;

        await memoryManager.saveSubTaskRun({
            id: runId,
            runId,
            parentSessionId,
            childSessionId,
            mode: 'foreground',
            status: 'completed',
            description: 'Analyze code',
            prompt: 'Summarize files',
            subagentType: 'explore',
            startedAt: Date.now(),
            finishedAt: Date.now(),
            turns: 1,
            toolsUsed: ['glob'],
            output: 'done',
            messages: [
                { messageId: 'system', role: 'system', content: 'sys' },
                { messageId: 'user-1', role: 'user', content: 'hello', type: 'text' },
                { messageId: 'assistant-1', role: 'assistant', content: 'done', type: 'text', finish_reason: 'stop' },
            ],
        });

        const loaded = await memoryManager.getSubTaskRun(runId);
        expect(loaded).toBeTruthy();
        expect(loaded?.status).toBe('completed');
        expect(loaded?.childSessionId).toBe(childSessionId);
        expect(loaded?.messageCount).toBe(3);
        expect(loaded?.messages).toBeUndefined();

        const runFile = path.join(tempDir, 'subtask-runs', `subtask-run-${encodeURIComponent(runId)}.json`);
        const raw = await fs.readFile(runFile, 'utf-8');
        const stored = JSON.parse(raw);
        expect(stored.runId).toBe(runId);
        expect(stored.status).toBe('completed');
        expect(stored.messageCount).toBe(3);
        expect(stored.messages).toBeUndefined();

        await memoryManager.close();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        const reloaded = await memoryManager.getSubTaskRun(runId);
        expect(reloaded).toBeTruthy();
        expect(reloaded?.status).toBe('completed');
        expect(reloaded?.messageCount).toBe(3);
        expect(reloaded?.messages).toBeUndefined();
    });

    it('should query and delete sub task run records', async () => {
        await memoryManager.saveSubTaskRun({
            id: 'run-1',
            runId: 'run-1',
            parentSessionId: 'p1',
            childSessionId: 'c1',
            mode: 'background',
            status: 'running',
            description: 'job1',
            prompt: 'p1',
            subagentType: 'explore',
            startedAt: Date.now(),
            toolsUsed: [],
            messages: [],
        });
        await memoryManager.saveSubTaskRun({
            id: 'run-2',
            runId: 'run-2',
            parentSessionId: 'p1',
            childSessionId: 'c2',
            mode: 'background',
            status: 'completed',
            description: 'job2',
            prompt: 'p2',
            subagentType: 'plan',
            startedAt: Date.now(),
            finishedAt: Date.now(),
            toolsUsed: ['read_file'],
            messages: [],
        });

        const queried = await memoryManager.querySubTaskRuns({ parentSessionId: 'p1' });
        expect(queried).toHaveLength(2);

        const completed = await memoryManager.querySubTaskRuns({ status: 'completed' });
        expect(completed).toHaveLength(1);
        expect(completed[0].runId).toBe('run-2');

        await memoryManager.deleteSubTaskRun('run-1');
        const deleted = await memoryManager.getSubTaskRun('run-1');
        expect(deleted).toBeNull();
    });

    it('should ignore legacy sub task run files in tasks directory', async () => {
        const runId = 'legacy-run-1';
        const legacyDir = path.join(tempDir, 'tasks');
        await fs.mkdir(legacyDir, { recursive: true });

        const legacyFile = path.join(legacyDir, `subtask-run-${encodeURIComponent(runId)}.json`);
        await fs.writeFile(
            legacyFile,
            JSON.stringify(
                {
                    id: runId,
                    runId,
                    parentSessionId: 'parent',
                    childSessionId: `parent::subtask::${runId}`,
                    mode: 'foreground',
                    status: 'completed',
                    description: 'legacy',
                    prompt: 'legacy',
                    subagentType: 'explore',
                    startedAt: Date.now(),
                    finishedAt: Date.now(),
                    turns: 1,
                    toolsUsed: [],
                    output: 'ok',
                    messages: [{ messageId: 'system', role: 'system', content: 'sys' }],
                },
                null,
                2
            ),
            'utf-8'
        );

        await memoryManager.close();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        const loaded = await memoryManager.getSubTaskRun(runId);
        expect(loaded).toBeNull();
        await expect(fs.access(legacyFile)).resolves.toBeUndefined();
    });

    it('should preserve system message and keep session stats consistent after compaction', async () => {
        const sessionId = await memoryManager.createSession('session-compaction-system', 'system prompt');

        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'user-1',
            role: 'user',
            content: 'q1',
            type: 'text',
        });
        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'assistant-1',
            role: 'assistant',
            content: 'a1',
            type: 'text',
        });
        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'user-2',
            role: 'user',
            content: 'q2',
            type: 'text',
        });

        await memoryManager.compactContext(sessionId, {
            keepLastN: 1,
            summaryMessage: {
                messageId: 'summary-1',
                role: 'assistant',
                type: 'summary',
                content: 'summary',
            },
            reason: 'manual',
        });

        const context = await memoryManager.getCurrentContext(sessionId);
        expect(context).toBeTruthy();
        expect(context?.messages[0].role).toBe('system');
        expect(context?.messages[1].messageId).toBe('summary-1');

        const history = await memoryManager.getFullHistory({ sessionId });
        const session = await memoryManager.getSession(sessionId);
        expect(session?.totalMessages).toBe(history.length);
    });

    it('should recover corrupted context file from backup instead of loading empty state', async () => {
        const sessionId = await memoryManager.createSession('session-recover-context', 'system prompt');

        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'user-1',
            role: 'user',
            content: 'hello',
            type: 'text',
        });
        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'assistant-1',
            role: 'assistant',
            content: 'hi',
            type: 'text',
        });
        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'user-2',
            role: 'user',
            content: 'follow-up',
            type: 'text',
        });

        const contextFile = path.join(tempDir, 'contexts', `${encodeURIComponent(sessionId)}.json`);
        await expect(fs.access(`${contextFile}.bak`)).resolves.toBeUndefined();

        await fs.writeFile(contextFile, '', 'utf-8');

        await memoryManager.close();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        const context = await memoryManager.getCurrentContext(sessionId);
        expect(context).toBeTruthy();
        expect(context?.messages.length).toBeGreaterThan(1);
        expect(context?.messages.some((item) => item.messageId === 'user-1')).toBe(true);

        const contextFiles = await fs.readdir(path.join(tempDir, 'contexts'));
        expect(contextFiles.some((name) => name.startsWith(`${encodeURIComponent(sessionId)}.json.corrupt-`))).toBe(
            true
        );
    });

    it('should recover corrupted history file from backup and keep previous records', async () => {
        const sessionId = await memoryManager.createSession('session-recover-history', 'system prompt');

        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'user-1',
            role: 'user',
            content: 'hello',
            type: 'text',
        });
        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'assistant-1',
            role: 'assistant',
            content: 'hi',
            type: 'text',
        });
        await memoryManager.addMessageToContext(sessionId, {
            messageId: 'user-2',
            role: 'user',
            content: 'one more',
            type: 'text',
        });

        const historyFile = path.join(tempDir, 'histories', `${encodeURIComponent(sessionId)}.json`);
        await expect(fs.access(`${historyFile}.bak`)).resolves.toBeUndefined();
        await fs.writeFile(historyFile, '{', 'utf-8');

        await memoryManager.close();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        const history = await memoryManager.getFullHistory({ sessionId });
        expect(history.length).toBeGreaterThan(1);
        expect(history.some((item) => item.messageId === 'assistant-1')).toBe(true);
    });

    it('should reject reusing the same taskId across different sessions', async () => {
        await memoryManager.saveTask({
            id: 'task-same-s1',
            taskId: 'task-same',
            sessionId: 'session-1',
            status: 'pending',
            title: 'task 1',
        });

        await expect(
            memoryManager.saveTask({
                id: 'task-same-s2',
                taskId: 'task-same',
                sessionId: 'session-2',
                status: 'pending',
                title: 'task 2',
            })
        ).rejects.toThrow('Task ID collision detected');
    });
});
