import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createMemoryManager } from '../memory';
import type { IMemoryManager } from '../memory/types';
import { Session } from './index';

describe('Session 子 Agent 共享 MemoryManager 初始化问题', () => {
    let tempDir: string;
    let memoryManager: IMemoryManager;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-subagent-init-'));
    });

    afterEach(async () => {
        if (memoryManager) {
            await memoryManager.close().catch(() => undefined);
        }
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('子 Agent Session 使用共享 MemoryManager 的场景', () => {
        it('子 Agent Session 在主 Agent MemoryManager 关闭后不应抛出初始化错误', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });
            await memoryManager.initialize();

            // 主 Agent Session
            const parentSession = new Session({
                sessionId: 'parent-session',
                systemPrompt: 'parent system',
                memoryManager,
            });
            await parentSession.initialize();

            // 子 Agent Session（共享同一个 MemoryManager）
            const childSession = new Session({
                sessionId: 'parent-session::subtask::child-1',
                systemPrompt: 'child system',
                memoryManager,
            });
            await childSession.initialize();

            // 子 Agent 添加消息（正常情况）
            childSession.addMessage({
                messageId: 'msg-child-1',
                role: 'user',
                content: 'hello from child',
                type: 'text',
            });

            await childSession.sync();

            // 验证消息已添加
            const messages = childSession.getMessages();
            expect(messages.some((m) => m.messageId === 'msg-child-1')).toBe(true);
        });

        it('MemoryManager 被意外关闭后，Session 操作应该优雅处理', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });
            await memoryManager.initialize();

            const session = new Session({
                sessionId: 'test-session-close',
                systemPrompt: 'test system',
                memoryManager,
            });
            await session.initialize();

            // 添加消息
            session.addMessage({
                messageId: 'msg-before-close',
                role: 'user',
                content: 'before close',
                type: 'text',
            });

            // 关闭 MemoryManager
            await memoryManager.close();

            // 尝试在关闭后添加消息
            // 这应该不会抛出 "MemoryOrchestrator not initialized" 错误
            // 而是应该优雅地处理（例如通过 waitForInitialization 重新初始化）
            session.addMessage({
                messageId: 'msg-after-close',
                role: 'user',
                content: 'after close',
                type: 'text',
            });

            // 等待持久化队列完成
            // 由于 MemoryManager 已关闭，这可能会失败，但不应抛出未捕获的异常
            await new Promise((resolve) => setTimeout(resolve, 100));
        });

        it('并发场景：多个子 Agent 同时初始化并添加消息', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });
            await memoryManager.initialize();

            // 创建多个子 Agent Session 并同时初始化
            const sessions = await Promise.all(
                Array.from({ length: 5 }, (_, i) => {
                    const session = new Session({
                        sessionId: `concurrent-parent::subtask::child-${i}`,
                        systemPrompt: `child system ${i}`,
                        memoryManager,
                    });
                    return session.initialize().then(() => session);
                })
            );

            // 所有 Session 同时添加消息
            await Promise.all(
                sessions.map((session, i) => {
                    session.addMessage({
                        messageId: `msg-concurrent-${i}`,
                        role: 'user',
                        content: `message ${i}`,
                        type: 'text',
                    });
                    return session.sync();
                })
            );

            // 验证所有消息都已添加
            for (let i = 0; i < 5; i++) {
                const messages = sessions[i].getMessages();
                expect(messages.some((m) => m.messageId === `msg-concurrent-${i}`)).toBe(true);
            }
        });
    });

    describe('Session.doPersist 确保初始化问题', () => {
        it('doPersist 应该在 MemoryManager 重新初始化后正确工作', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            const session = new Session({
                sessionId: 'test-dopersist-reinit',
                systemPrompt: 'test system',
                memoryManager,
            });

            // 初始化 Session
            await session.initialize();

            // 添加第一条消息
            session.addMessage({
                messageId: 'msg-first',
                role: 'user',
                content: 'first message',
                type: 'text',
            });
            await session.sync();

            // 关闭 MemoryManager
            await memoryManager.close();

            // 重新初始化 MemoryManager
            await memoryManager.initialize();

            // 添加第二条消息（这会触发 doPersist，应该能自动等待初始化）
            session.addMessage({
                messageId: 'msg-second',
                role: 'user',
                content: 'second message',
                type: 'text',
            });

            // 等待持久化完成
            await session.sync();

            // 验证消息已添加
            const messages = session.getMessages();
            expect(messages.some((m) => m.messageId === 'msg-first')).toBe(true);
            expect(messages.some((m) => m.messageId === 'msg-second')).toBe(true);
        });

        it('子 Agent 创建时，如果主 Agent 还未初始化 MemoryManager，应该正确等待', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 不先初始化 MemoryManager，直接创建 Session
            const parentSession = new Session({
                sessionId: 'parent-no-init',
                systemPrompt: 'parent system',
                memoryManager,
            });

            // 同时创建子 Session（模拟 TaskTool 创建子 Agent）
            const childSession = new Session({
                sessionId: 'parent-no-init::subtask::child-1',
                systemPrompt: 'child system',
                memoryManager,
            });

            // 同时初始化两个 Session
            await Promise.all([parentSession.initialize(), childSession.initialize()]);

            // 两个 Session 都应该能正常添加消息
            parentSession.addMessage({
                messageId: 'msg-parent',
                role: 'user',
                content: 'from parent',
                type: 'text',
            });

            childSession.addMessage({
                messageId: 'msg-child',
                role: 'user',
                content: 'from child',
                type: 'text',
            });

            await Promise.all([parentSession.sync(), childSession.sync()]);

            // 验证
            expect(parentSession.getMessages().some((m) => m.messageId === 'msg-parent')).toBe(true);
            expect(childSession.getMessages().some((m) => m.messageId === 'msg-child')).toBe(true);
        });
    });

    describe('复现原始错误场景', () => {
        it('模拟子 Agent 执行期间 MemoryOrchestrator 未初始化的情况', async () => {
            memoryManager = createMemoryManager({
                type: 'file',
                connectionString: tempDir,
            });

            // 创建主 Session 并初始化
            const parentSession = new Session({
                sessionId: 'agent-43',
                systemPrompt: 'main agent',
                memoryManager,
            });
            await parentSession.initialize();

            // 创建子 Session（模拟子 Agent）
            const childSession = new Session({
                sessionId: 'agent-43::subtask::task-1',
                systemPrompt: 'sub agent',
                memoryManager,
            });

            // 初始化子 Session
            await childSession.initialize();

            // 子 Session 添加多条消息（模拟 LLM 响应更新）
            childSession.addMessage({
                messageId: 'assistant-1',
                role: 'assistant',
                content: 'partial content',
                type: 'text',
            });

            // 模拟更新消息（这会触发 doPersist 的 update 操作）
            childSession.addMessage({
                messageId: 'assistant-1',
                role: 'assistant',
                content: 'final content',
                type: 'text',
                finish_reason: 'stop',
            });

            // 等待持久化完成
            await childSession.sync();

            // 验证消息已正确更新
            const messages = childSession.getMessages();
            const assistantMsg = messages.find((m) => m.messageId === 'assistant-1');
            expect(assistantMsg).toBeDefined();
            expect(assistantMsg?.content).toBe('final content');
        });
    });
});
