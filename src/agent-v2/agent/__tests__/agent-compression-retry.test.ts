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
import { AgentMessageType, type AgentMessage, type StatusMessage } from '../stream-types';
import { isRetryableError, LLMRetryableError } from '../../../providers';
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

function createTestAgent(provider: LLMProvider, sessionId?: string, eventCollector?: AgentMessage[]): Agent {
    return new Agent({
        provider,
        systemPrompt: 'You are a helpful assistant.',
        sessionId,
        stream: false,
        maxLoops: 10,
        maxRetries: 5,
        retryDelayMs: 1, // 快速重试
        streamCallback: eventCollector ? (msg) => eventCollector.push(msg) : undefined,
    });
}

// ==================== 测试用例 ====================

describe('Agent LLMContextCompressionError E2E', () => {
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

            const events: AgentMessage[] = [];
            agent = createTestAgent(mockProvider, undefined, events);

            const retryEvents: unknown[] = [];
            agent.on(EventType.TASK_RETRY, (data) => retryEvents.push(data));

            const result = await agent.executeWithResult('Test query');

            // 应该成功完成
            expect(result.status).toBe('completed');
            expect(result.finalMessage).toBeDefined();

            // 应该触发一次重试
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

            // Spy on session.compactBeforeLLMCall
            const session = (agent as unknown as { session: { compactBeforeLLMCall: () => Promise<boolean> } }).session;
            const compactSpy = vi.spyOn(session, 'compactBeforeLLMCall');

            await agent.executeWithResult('Test query');

            // 应该调用 compactBeforeLLMCall
            expect(compactSpy).toHaveBeenCalled();
        });

        it('should handle multiple compression errors', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 2, // 前两次抛出，第三次成功
                responseContent: 'Success after multiple retries!',
            });

            const events: AgentMessage[] = [];
            agent = createTestAgent(mockProvider, 'multi-retry-session', events);

            const retryEvents: unknown[] = [];
            agent.on(EventType.TASK_RETRY, (data) => retryEvents.push(data));

            const result = await agent.executeWithResult('Test query');

            // 应该成功完成
            expect(result.status).toBe('completed');

            // Provider 应该被调用三次
            expect(mockProvider.generate).toHaveBeenCalledTimes(3);

            // 应该触发至少两次重试
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

            const events: AgentMessage[] = [];
            agent = createTestAgent(mockProvider, 'max-retry-session', events);

            const retryEvents: unknown[] = [];
            agent.on(EventType.TASK_RETRY, (data) => retryEvents.push(data));

            const result = await agent.executeWithResult('Test query');

            // 应该失败
            expect(result.status).toBe('failed');
            expect(result.failure).toBeDefined();

            // 重试次数应该达到最大值 (maxRetries=5, 所以最多 6 次调用)
            expect(retryEvents.length).toBeLessThanOrEqual(6);
        });

        it('should include compression error in failure reason', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 10,
            });

            agent = createTestAgent(mockProvider, 'failure-reason-session');

            const result = await agent.executeWithResult('Test query');

            expect(result.status).toBe('failed');
            expect(result.failure).toBeDefined();
            expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');
            expect(result.failure?.userMessage).toContain('maximum retries');
        });
    });

    // ==================== 状态变更测试 ====================

    describe('Status Changes', () => {
        it('should emit RETRYING status after compression error', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1,
            });

            const events: AgentMessage[] = [];
            agent = createTestAgent(mockProvider, 'status-session', events);

            await agent.executeWithResult('Test query');

            // 过滤 RETRYING 状态消息
            const retryingStatuses = events.filter(
                (e) => e.type === AgentMessageType.STATUS && (e as StatusMessage).payload.state === AgentStatus.RETRYING
            );
            expect(retryingStatuses.length).toBeGreaterThan(0);

            // 检查消息内容
            const retryingStatus = retryingStatuses[0] as StatusMessage;
            expect(retryingStatus.payload.message).toBeDefined();
        });

        it('should emit RUNNING status during execution', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1,
            });

            const events: AgentMessage[] = [];
            agent = createTestAgent(mockProvider, 'running-status-session', events);

            await agent.executeWithResult('Test query');

            // 过滤 RUNNING 状态消息
            const runningStatuses = events.filter(
                (e) => e.type === AgentMessageType.STATUS && (e as StatusMessage).payload.state === AgentStatus.RUNNING
            );
            // 应该有至少 1 个 RUNNING 状态
            expect(runningStatuses.length).toBeGreaterThanOrEqual(1);
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

            await agent.executeWithResult('First query');

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
            // 使用一个持续抛出错误的 Provider 来模拟长时间运行
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 100, // 一直抛出错误
            });

            // 使用较长的 retryDelayMs 确保 abort 能够在重试等待期间触发
            agent = new Agent({
                provider: mockProvider,
                systemPrompt: 'You are a helpful assistant.',
                sessionId: 'abort-session',
                stream: false,
                maxLoops: 10,
                maxRetries: 10,
                retryDelayMs: 1000, // 较长的重试延迟
            });

            // 先启动执行
            const execution = agent.executeWithResult('Test query');

            // 等待一小段时间后中止
            setTimeout(() => {
                agent.abort();
            }, 100);

            const result = await execution;

            // 应该被中止
            expect(result.status).toBe('aborted');
            expect(result.failure?.code).toBe('AGENT_ABORTED');
        }, 10000);
    });

    // ==================== 错误分类测试 ====================

    describe('Error Classification', () => {
        it('should classify LLMContextCompressionError as retryable', () => {
            const compressionError = new LLMContextCompressionError('Test error', {
                context: { processedChars: 100 },
            });

            expect(isRetryableError(compressionError)).toBe(true);
        });

        it('should distinguish from other retryable errors', () => {
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
        it('should include retry count in result', async () => {
            mockProvider = createMockProvider({
                shouldThrowCompressionError: true,
                throwCount: 1,
            });

            agent = createTestAgent(mockProvider, 'reason-session');

            const result = await agent.executeWithResult('Test query');

            // 应该成功完成
            expect(result.status).toBe('completed');
            // 应该有重试次数
            expect(result.retryCount).toBeGreaterThanOrEqual(1);
        });
    });
});
