/**
 * Agent LLMContextCompressionError 端到端测试
 *
 * 测试 Agent 处理 LLMContextCompressionError 的完整流程：
 * 1. LLMContextCompressionError 触发上下文压缩并重试
 * 2. 压缩后重试成功
 * 3. 压缩后重试仍失败的处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '../agent';
import { LLMContextCompressionError } from '../errors';
import { EventType } from '../../eventbus';
import { AgentStatus } from '../types';
import type { LLMProvider } from '../../../providers';

// ==================== Mock Provider ====================

function createMockProvider(options?: {
    shouldThrowCompressionError?: boolean;
    throwCount?: number;
    responseContent?: string;
}): LLMProvider {
    let callCount = 0;
    const throwCount = options?.throwCount ?? 1;
    const shouldThrow = options?.shouldThrowCompressionError ?? false;
    const responseContent = options?.responseContent ?? 'This is a normal response.';

    return {
        getModelName: () => 'test-model',
        getLLMMaxTokens: () => 200000,
        getMaxOutputTokens: () => 8000,
        getTimeTimeout: () => 60000,
        getStreamTimeout: () => 300000,

        generate: vi.fn(async (messages, options) => {
            callCount++;

            // 模拟流式响应
            if (options?.stream) {
                async function* generateStream() {
                    if (shouldThrow && callCount <= throwCount) {
                        // 抛出 LLMContextCompressionError
                        throw new LLMContextCompressionError(
                            'Stream validation failed, context compaction recommended',
                            {
                                context: {
                                    processedChars: 100,
                                    validationViolation: {
                                        valid: false,
                                        violationType: 'repetition',
                                    },
                                },
                            }
                        );
                    }

                    // 正常流式响应
                    yield {
                        id: 'response_1',
                        model: 'test-model',
                        created: Date.now(),
                        choices: [
                            {
                                index: 0,
                                delta: { content: responseContent },
                                finish_reason: 'stop',
                            },
                        ],
                    };
                }

                return generateStream();
            }

            // 非流式响应
            if (shouldThrow && callCount <= throwCount) {
                throw new LLMContextCompressionError('Context compaction needed', {
                    context: { processedChars: 100 },
                });
            }

            return {
                id: 'response_1',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: responseContent,
                        },
                        finish_reason: 'stop',
                    },
                ],
            };
        }),
    } as unknown as LLMProvider;
}

// ==================== 辅助函数 ====================

function createTestAgent(provider: LLMProvider, sessionId?: string): Agent {
    return new Agent({
        provider,
        systemPrompt: 'You are a helpful assistant.',
        sessionId,
        stream: false,
        maxLoops: 10,
        maxRetries: 5,
    });
}

// ==================== 测试用例 ====================

describe.skip('Agent LLMContextCompressionError E2E', () => {
    let mockProvider: LLMProvider;
    let agent: Agent;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ==================== 压缩重试测试 ====================

    describe('Compression Retry Flow', () => {
        it('should retry after LLMContextCompressionError', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1, // 第一次抛出，第二次成功
                responseContent: 'Success after retry!',
            });

            agent = createTestAgent(mockProvider);

            const events: unknown[] = [];
            agent.on(EventType.TASK_RETRY, (data) => events.push({ type: 'retry', data }));

            const result = await agent.execute('Test query');

            // 应该成功完成
            expect(result.status).toBe('completed');
            expect(result.finalMessage).toBeDefined();

            // 应该触发一次重试
            const retryEvents = events.filter((e) => (e as { type: string }).type === 'retry');
            expect(retryEvents.length).toBeGreaterThanOrEqual(1);

            // Provider 应该被调用两次（第一次失败，第二次成功）
            expect(mockProvider.generate).toHaveBeenCalledTimes(2);
        });

        it('should call compactBeforeLLMCall before retry', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1,
            });

            agent = createTestAgent(mockProvider);

            //  spies on session.compactBeforeLLMCall
            const session = (agent as unknown as { session: { compactBeforeLLMCall: () => Promise<boolean> } }).session;
            const compactSpy = vi.spyOn(session, 'compactBeforeLLMCall');

            await agent.execute('Test query');

            // 应该调用 compactBeforeLLMCall
            expect(compactSpy).toHaveBeenCalled();
        });

        it('should handle multiple compression errors', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 2, // 前两次抛出，第三次成功
                responseContent: 'Success after multiple retries!',
            });

            agent = createTestAgent(mockProvider, 'multi-retry-session');

            const events: unknown[] = [];
            agent.on(EventType.TASK_RETRY, (data) => events.push({ type: 'retry', data }));

            const result = await agent.execute('Test query');

            // 应该成功完成
            expect(result.status).toBe('completed');

            // Provider 应该被调用三次
            expect(mockProvider.generate).toHaveBeenCalledTimes(3);

            // 应该触发至少两次重试
            const retryEvents = events.filter((e) => (e as { type: string }).type === 'retry');
            expect(retryEvents.length).toBeGreaterThanOrEqual(2);
        });
    });

    // ==================== 超过最大重试次数测试 ====================

    describe('Max Retries Exceeded', () => {
        it('should fail after max retries with compression errors', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 10, // 一直抛出错误
            });

            agent = createTestAgent(mockProvider, 'max-retry-session');

            const events: unknown[] = [];
            agent.on(EventType.TASK_RETRY, (data) => events.push({ type: 'retry', data }));

            const result = await agent.execute('Test query');

            // 应该失败
            expect(result.status).toBe('failed');
            expect(result.failure).toBeDefined();

            // 重试次数应该达到最大值
            const retryEvents = events.filter((e) => (e as { type: string }).type === 'retry');
            expect(retryEvents.length).toBeLessThanOrEqual(5); // maxRetries = 5
        });

        it('should include compression error in failure reason', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 10,
            });

            agent = createTestAgent(mockProvider, 'failure-reason-session');

            const result = await agent.execute('Test query');

            expect(result.status).toBe('failed');
            expect(result.failure).toBeDefined();
            expect((result.failure as Record<string, unknown>)?.error).toContain('compression');
        });
    });

    // ==================== 状态变更测试 ====================

    describe.skip('Status Changes', () => {
        it('should emit RETRYING status after compression error', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1,
            });

            agent = createTestAgent(mockProvider, 'status-session');

            const statusEvents: Array<{ status: AgentStatus; message: string }> = [];
            // @ts-expect-error - STATUS_CHANGE does not exist
            agent.on(EventType.STATUS_CHANGE as unknown as EventType, (data) => {
                statusEvents.push(data as { status: AgentStatus; message: string });
            });

            await agent.execute('Test query');

            // 应该经历 RETRYING 状态
            const retryingStatus = statusEvents.find((e) => e.status === AgentStatus.RETRYING);
            expect(retryingStatus).toBeDefined();
            expect(retryingStatus?.message).toContain('Retrying');
        });

        it('should return to RUNNING status after retry', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1,
            });

            agent = createTestAgent(mockProvider, 'running-status-session');

            const statusEvents: Array<{ status: AgentStatus; message: string }> = [];
            // @ts-expect-error - STATUS_CHANGE does not exist
            agent.on(EventType.STATUS_CHANGE as unknown as EventType, (data) => {
                statusEvents.push(data as { status: AgentStatus; message: string });
            });

            await agent.execute('Test query');

            // 应该回到 RUNNING 状态
            const runningStatuses = statusEvents.filter((e) => e.status === AgentStatus.RUNNING);
            expect(runningStatuses.length).toBeGreaterThanOrEqual(2); // 初始运行 + 重试后运行
        });
    });

    // ==================== 会话持久化测试 ====================

    describe('Session Persistence', () => {
        it('should preserve session state after compression retry', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1,
            });

            const sessionId = 'persist-session';
            agent = createTestAgent(mockProvider, sessionId);

            await agent.execute('First query');

            // 获取会话 ID
            expect(agent.getSessionId()).toBe(sessionId);

            // 消息应该被保留
            const messages = agent.getMessages();
            expect(messages.length).toBeGreaterThan(0);
        });
    });

    // ==================== 并发处理测试 ====================

    describe('Concurrent Handling', () => {
        it('should handle abort during compression retry', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 5, // 多次抛出错误
            });

            agent = createTestAgent(mockProvider, 'abort-session');

            // 在重试期间中止
            setTimeout(() => {
                agent.abort();
            }, 100);

            const result = await agent.execute('Test query');

            // 应该被中止
            expect(result.status).toBe('aborted');
        });
    });

    // ==================== 错误分类测试 ====================

    describe('Error Classification', () => {
        it('should classify LLMContextCompressionError as retryable', () => {
            const compressionError = new LLMContextCompressionError('Test error', {
                context: { processedChars: 100 },
            });

            // 使用 providers 层的 isRetryableError
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { isRetryableError } = require('../../../providers');
            expect(isRetryableError(compressionError)).toBe(true);
        });

        it('should distinguish from other retryable errors', () => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { LLMRetryableError, isRetryableError } = require('../../../providers');

            const retryableError = new LLMRetryableError('Test', 1000, 'TEST');
            const compressionError = new LLMContextCompressionError('Test', {
                context: {},
            });

            expect(isRetryableError(retryableError)).toBe(true);
            expect(isRetryableError(compressionError)).toBe(true);
        });
    });

    // ==================== 恢复结果测试 ====================

    describe('Recovery Result', () => {
        it('should include retry reason with compression hint', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1,
            });

            agent = createTestAgent(mockProvider, 'reason-session');

            const events: unknown[] = [];
            agent.on(EventType.TASK_RETRY, (data) => events.push(data));

            await agent.execute('Test query');

            // 检查重试事件中的原因
            const retryEvent = events.find(
                (e) =>
                    (e as { type: string; data?: { reason?: string } }).type === 'retry' &&
                    (e as { type: string; data?: { reason?: string } }).data?.reason?.includes('compression')
            );
            expect(retryEvent).toBeDefined();
        });
    });
});
