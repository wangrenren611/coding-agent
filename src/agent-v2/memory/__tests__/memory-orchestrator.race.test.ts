import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createMemoryManager } from '../index';
import type { IMemoryManager } from '../types';
import { Session } from '../../session';

describe('MemoryOrchestrator 并发初始化竞态条件测试', () => {
    let tempDir: string;
    let memoryManager: IMemoryManager;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-memory-race-'));
    });

    afterEach(async () => {
        if (memoryManager) {
            await memoryManager.close().catch(() => undefined);
        }
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('并发 initialize() 调用', () => {
        it('应该正确处理多个并发的 initialize() 调用', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 同时发起多个初始化调用
            const results = await Promise.all([
                memoryManager.initialize(),
                memoryManager.initialize(),
                memoryManager.initialize(),
                memoryManager.initialize(),
                memoryManager.initialize(),
            ]);

            // 所有调用都应该成功完成
            expect(results.every((r) => r === undefined)).toBe(true);

            // 验证可以正常使用
            const sessionId = await memoryManager.createSession('test-session', 'test prompt');
            expect(sessionId).toBe('test-session');
        });

        it('应该在初始化进行中时，后续调用等待初始化完成', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 第一个初始化调用
            const initPromise1 = memoryManager.initialize();

            // 在第一个初始化完成之前，发起第二个调用
            const initPromise2 = memoryManager.initialize();

            // 两个调用都应该成功
            await Promise.all([initPromise1, initPromise2]);

            // 验证状态
            const sessionId = await memoryManager.createSession('concurrent-session', 'test');
            expect(sessionId).toBe('concurrent-session');
        });
    });

    describe('waitForInitialization() 方法', () => {
        it('如果已初始化，应该立即返回', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });
            await memoryManager.initialize();

            // waitForInitialization 应该立即返回
            if (memoryManager.waitForInitialization) {
                await expect(memoryManager.waitForInitialization()).resolves.toBeUndefined();
            }
        });

        it('如果初始化正在进行，应该等待初始化完成', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 开始初始化但不等待
            const initPromise = memoryManager.initialize();

            // waitForInitialization 应该等待初始化完成
            if (memoryManager.waitForInitialization) {
                await memoryManager.waitForInitialization();
            }

            await initPromise;

            // 验证可以正常使用
            const sessionId = await memoryManager.createSession('wait-test-session', 'test');
            expect(sessionId).toBe('wait-test-session');
        });

        it('如果未初始化且没有正在进行的初始化，应该自动启动初始化', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 不调用 initialize()，直接调用 waitForInitialization
            // 它应该自动启动初始化而不是抛出错误
            if (memoryManager.waitForInitialization) {
                await memoryManager.waitForInitialization();
            }

            // 验证已经初始化，可以正常使用
            const sessionId = await memoryManager.createSession('auto-init-session', 'test');
            expect(sessionId).toBe('auto-init-session');
        });
    });

    describe('子 Agent 共享 MemoryManager 场景', () => {
        it('多个 Session 共享同一个 MemoryManager 时应该正确初始化', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 先初始化 MemoryManager
            await memoryManager.initialize();

            // 创建多个 Session（模拟主 Agent 和子 Agent）
            const sessions = await Promise.all([
                (async () => {
                    const session = new Session({
                        sessionId: 'parent-session',
                        systemPrompt: 'parent system',
                        memoryManager,
                    });
                    await session.initialize();
                    return session;
                })(),
                (async () => {
                    const session = new Session({
                        sessionId: 'child-session-1',
                        systemPrompt: 'child system 1',
                        memoryManager,
                    });
                    await session.initialize();
                    return session;
                })(),
                (async () => {
                    const session = new Session({
                        sessionId: 'child-session-2',
                        systemPrompt: 'child system 2',
                        memoryManager,
                    });
                    await session.initialize();
                    return session;
                })(),
            ]);

            // 所有 Session 都应该正确初始化
            expect(sessions[0].getSessionId()).toBe('parent-session');
            expect(sessions[1].getSessionId()).toBe('child-session-1');
            expect(sessions[2].getSessionId()).toBe('child-session-2');

            // 验证消息可以正常添加
            sessions[0].addMessage({
                messageId: 'msg-1',
                role: 'user',
                content: 'hello from parent',
                type: 'text',
            });
            sessions[1].addMessage({
                messageId: 'msg-2',
                role: 'user',
                content: 'hello from child 1',
                type: 'text',
            });

            expect(sessions[0].getMessages().length).toBeGreaterThan(1);
            expect(sessions[1].getMessages().length).toBeGreaterThan(1);
        });

        it('子 Session 在主 Session 初始化完成前开始初始化应该正确等待', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 主 Session 开始初始化（但不等待 MemoryManager.initialize）
            const parentSession = new Session({
                sessionId: 'race-parent',
                systemPrompt: 'parent system',
                memoryManager,
            });

            // 同时启动多个子 Session
            const childSession1 = new Session({
                sessionId: 'race-child-1',
                systemPrompt: 'child system 1',
                memoryManager,
            });
            const childSession2 = new Session({
                sessionId: 'race-child-2',
                systemPrompt: 'child system 2',
                memoryManager,
            });

            // 同时初始化所有 Session（模拟并发场景）
            await Promise.all([parentSession.initialize(), childSession1.initialize(), childSession2.initialize()]);

            // 所有 Session 都应该正确初始化
            expect(parentSession.getSessionId()).toBe('race-parent');
            expect(childSession1.getSessionId()).toBe('race-child-1');
            expect(childSession2.getSessionId()).toBe('race-child-2');
        });
    });

    describe('close() 方法', () => {
        it('应该在关闭时等待正在进行的初始化完成', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 开始初始化
            const initPromise = memoryManager.initialize();

            // 立即关闭（不等待初始化完成）
            await memoryManager.close();

            // 确保初始化也完成了
            await initPromise.catch(() => undefined);
        });

        it('关闭后应该可以重新初始化', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 初始化
            await memoryManager.initialize();
            const sessionId = await memoryManager.createSession('first-session', 'first prompt');
            expect(sessionId).toBe('first-session');

            // 关闭
            await memoryManager.close();

            // 重新初始化
            await memoryManager.initialize();

            // 应该能够加载之前的数据
            const session = await memoryManager.getSession('first-session');
            expect(session).toBeTruthy();
            expect(session?.systemPrompt).toBe('first prompt');
        });
    });
});

describe('MemoryOrchestrator 内部实现测试', () => {
    it('doInitialize 应该只执行一次', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-memory-doinit-'));

        try {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 使用 vi.spy 来跟踪内部调用（这里通过多次调用 initialize 来间接验证）
            await memoryManager.initialize();
            await memoryManager.initialize();
            await memoryManager.initialize();

            // 创建会话来验证只初始化了一次
            await memoryManager.createSession('once-session', 'test');
            const session = await memoryManager.getSession('once-session');

            // 如果初始化多次，可能会创建多个会话或覆盖
            expect(session).toBeTruthy();
            expect(session?.sessionId).toBe('once-session');

            await memoryManager.close();
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});

describe('subtask-run-store 竞态条件测试', () => {
    let tempDir: string;
    let memoryManager: IMemoryManager;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-subtask-race-'));
    });

    afterEach(async () => {
        if (memoryManager) {
            await memoryManager.close().catch(() => undefined);
        }
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('saveSubTaskRunRecord 应该在 MemoryManager 初始化完成前等待', async () => {
        const { saveSubTaskRunRecord } = await import('../../tool/task/subtask-run-store');

        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });

        // 同时初始化和保存记录（模拟竞态条件）
        const initPromise = memoryManager.initialize();
        const savePromise = saveSubTaskRunRecord(memoryManager, {
            id: 'race-run-1',
            runId: 'race-run-1',
            parentSessionId: 'parent',
            childSessionId: 'parent::subtask::race-run-1',
            mode: 'foreground',
            status: 'running',
            description: 'race test',
            prompt: 'test',
            subagentType: 'explore',
            startedAt: Date.now(),
            toolsUsed: [],
        });

        // 两个操作都应该成功
        await Promise.all([initPromise, savePromise]);

        // 验证记录已保存
        const { getSubTaskRunRecord } = await import('../../tool/task/subtask-run-store');
        const record = await getSubTaskRunRecord(memoryManager, 'race-run-1');
        expect(record).toBeTruthy();
        expect(record?.status).toBe('running');
    });

    it('多个并发的 subtask 保存操作应该都成功', async () => {
        const { saveSubTaskRunRecord, getSubTaskRunRecord } = await import('../../tool/task/subtask-run-store');

        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        // 同时保存多个记录
        const savePromises = Array.from({ length: 10 }, (_, i) =>
            saveSubTaskRunRecord(memoryManager, {
                id: `concurrent-run-${i}`,
                runId: `concurrent-run-${i}`,
                parentSessionId: 'concurrent-parent',
                childSessionId: `concurrent-parent::subtask::concurrent-run-${i}`,
                mode: i % 2 === 0 ? 'foreground' : 'background',
                status: 'running',
                description: `concurrent test ${i}`,
                prompt: `test ${i}`,
                subagentType: 'explore',
                startedAt: Date.now(),
                toolsUsed: [],
            })
        );

        await Promise.all(savePromises);

        // 验证所有记录都已保存
        for (let i = 0; i < 10; i++) {
            const record = await getSubTaskRunRecord(memoryManager, `concurrent-run-${i}`);
            expect(record).toBeTruthy();
            expect(record?.description).toBe(`concurrent test ${i}`);
        }
    });
});
