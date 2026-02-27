/**
 * RATE_LIMIT 重试场景测试
 *
 * 问题描述（来自用户反馈）：
 * 1. 执行多智能体分析任务时，遇到持续的 429 RATE_LIMIT 错误
 * 2. Agent 重试了 20 次后最终失败
 * 3. 用户怀疑 "context 任务应该没有执行完就跳出循环了"
 *
 * 测试目标：
 * 1. 验证 RATE_LIMIT 重试逻辑是否正确
 * 2. 验证重试次数计算是否正确
 * 3. 验证达到最大重试次数时，Agent 是否正确处理未完成的任务
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from './agent';
import { createMemoryManager } from '../memory';
import { LLMRateLimitError } from '../../providers/types/errors';
import type { LLMProvider, LLMResponse } from '../../providers/types';

// Mock Provider - 模拟持续 RATE_LIMIT 错误
class MockRateLimitProvider {
    public callCount = 0;
    public failureCount = 0;
    public maxFailures = Infinity; // 默认无限失败
    public shouldFailWithRateLimit = true;

    async generate(_messages: unknown[]): Promise<LLMResponse> {
        this.callCount++;

        if (this.shouldFailWithRateLimit && this.failureCount < this.maxFailures) {
            this.failureCount++;
            throw new LLMRateLimitError('429 Too Many Requests - 您的账户已达到速率限制', 100); // 100ms 重试延迟
        }

        // 成功响应
        return {
            id: `test-id-${this.callCount}`,
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'Task completed successfully!',
                    },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
    }

    getTimeTimeout() {
        return 60000;
    }

    reset() {
        this.callCount = 0;
        this.failureCount = 0;
        this.shouldFailWithRateLimit = true;
    }
}

describe('RATE_LIMIT 重试场景测试', () => {
    let mockProvider: MockRateLimitProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;
    const sessionId = 'test-rate-limit-' + Date.now();

    beforeEach(async () => {
        mockProvider = new MockRateLimitProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/rate-limit-' + sessionId,
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    it('验证：isRetryExceeded 使用 > 而不是 >=，需要重试次数 > maxRetries 才会触发', async () => {
        // maxRetries = 3，需要 failureCount > 3（即 4 次）才会触发 isRetryExceeded
        // 但由于每次失败后 retryCount++，所以：
        // - 第 1 次失败后 retryCount = 1
        // - 第 2 次失败后 retryCount = 2
        // - 第 3 次失败后 retryCount = 3
        // - 第 4 次失败后 retryCount = 4
        // 此时 4 > 3，isRetryExceeded 返回 true

        mockProvider.maxFailures = 5; // 允许 5 次失败（比 maxRetries 多 2 次）

        const agent = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId: 'test-retry-exceeded-logic',
            maxLoops: 100,
            maxRetries: 3,
            retryDelayMs: 1, // 快速重试
        });

        const result = await agent.executeWithResult('Test query');

        // 应该失败
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        // 验证调用次数
        // 由于 isRetryExceeded 检查在循环开始时进行
        // 第 4 次失败后，retryCount = 4，下次循环开始时 isRetryExceeded = true
        console.log('Provider call count:', mockProvider.callCount);
        console.log('Provider failure count:', mockProvider.failureCount);

        // 预期：4 次 LLM 调用（4 次失败）
        expect(mockProvider.callCount).toBe(4);
        expect(mockProvider.failureCount).toBe(4);
    });

    it('验证：达到最大重试次数时，最后一条消息应该是正确的', async () => {
        // 模拟持续 RATE_LIMIT 错误
        mockProvider.maxFailures = 25; // 比 maxRetries 多

        const agent = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId: 'test-final-message',
            maxLoops: 100,
            maxRetries: 20,
            retryDelayMs: 1,
        });

        const result = await agent.executeWithResult('Test query');

        // 应该失败
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        // 检查消息列表
        const messages = agent.getMessages();
        const lastMessage = messages[messages.length - 1];

        console.log('Messages count:', messages.length);
        console.log('Last message role:', lastMessage?.role);
        console.log('Last message content:', typeof lastMessage?.content === 'string' ? lastMessage.content.substring(0, 100) : lastMessage?.content);

        // 最后一条消息应该是用户消息（因为没有成功的助手响应）
        expect(lastMessage?.role).toBe('user');
    });

    it('关键测试：模拟实际场景 - 工具调用后 RATE_LIMIT，验证 context 状态', async () => {
        // 模拟场景：
        // 1. 第一次 LLM 调用成功，返回工具调用
        // 2. 工具执行成功
        // 3. 第二次 LLM 调用遇到 RATE_LIMIT
        // 4. 持续 RATE_LIMIT 直到重试次数用尽

        let callCount = 0;
        const customProvider = {
            async generate(_messages: unknown[]): Promise<LLMResponse> {
                callCount++;

                if (callCount === 1) {
                    // 第一次调用：返回工具调用
                    return {
                        id: 'test-id-1',
                        object: 'chat.completion',
                        created: Date.now(),
                        model: 'test-model',
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: 'assistant',
                                    content: 'I will help you.',
                                    tool_calls: [
                                        {
                                            id: 'call_test_123',
                                            type: 'function',
                                            function: {
                                                name: 'glob',
                                                arguments: '{"pattern":"**/*.ts"}',
                                            },
                                        },
                                    ],
                                },
                                finish_reason: 'tool_calls',
                            },
                        ],
                        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                    };
                }

                // 后续调用：抛出 RATE_LIMIT 错误
                throw new LLMRateLimitError('429 Too Many Requests', 1);
            },
            getTimeTimeout: () => 60000,
        };

        const agent = new Agent({
            provider: customProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId: 'test-tool-call-rate-limit',
            maxLoops: 100,
            maxRetries: 3,
            retryDelayMs: 1,
        });

        const result = await agent.executeWithResult('List TypeScript files');

        // 应该失败
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        // 检查消息列表
        const messages = agent.getMessages();
        console.log(
            'Messages:',
            messages.map((m) => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content.substring(0, 50) : '[non-string]',
                finish_reason: m.finish_reason,
            }))
        );

        // 应该有：
        // 1. system 消息
        // 2. user 消息
        // 3. assistant 消息（带 tool_calls）
        // 4. tool 消息（工具结果）
        const assistantMessages = messages.filter((m) => m.role === 'assistant');
        const toolMessages = messages.filter((m) => m.role === 'tool');

        expect(assistantMessages.length).toBe(1);
        expect(assistantMessages[0].finish_reason).toBe('tool_calls');
        expect(toolMessages.length).toBe(1);

        console.log('Call count:', callCount);
        // 第一次成功 + 后续 RATE_LIMIT 失败（maxRetries + 1 次）
        // 由于 isRetryExceeded 使用 >，所以 retryCount > maxRetries 时才会触发
        // 预期：1 次成功 + 4 次 RATE_LIMIT（因为 maxRetries = 3，需要 retryCount > 3）
        expect(callCount).toBe(5); // 1 + 4
    });

    it('边界测试：isRetryExceeded 应该在 retryCount > maxRetries 时返回 true', async () => {
        // 这个测试验证 AgentState.isRetryExceeded 的逻辑
        const { AgentState } = await import('./core/agent-state');
        const { DefaultTimeProvider } = await import('./time-provider');

        const state = new AgentState({
            maxLoops: 100,
            maxRetries: 3,
            defaultRetryDelayMs: 100,
            timeProvider: new DefaultTimeProvider(),
        });

        state.startTask();

        // 初始状态
        expect(state.isRetryExceeded()).toBe(false);

        // 记录 1 次可重试错误
        state.recordRetryableError(100);
        expect(state.isRetryExceeded()).toBe(false); // 1 > 3 = false

        // 记录 2 次可重试错误
        state.recordRetryableError(100);
        expect(state.isRetryExceeded()).toBe(false); // 2 > 3 = false

        // 记录 3 次可重试错误
        state.recordRetryableError(100);
        expect(state.isRetryExceeded()).toBe(false); // 3 > 3 = false

        // 记录 4 次可重试错误
        state.recordRetryableError(100);
        expect(state.isRetryExceeded()).toBe(true); // 4 > 3 = true

        console.log('Retry count after 4 errors:', state.retryCount);
        expect(state.retryCount).toBe(4);
    });

    it('实际场景复现：验证 context 任务在重试失败后的状态', async () => {
        // 这个测试尝试复现用户报告的问题：
        // "context 任务应该没有执行完就跳出循环了"

        // 模拟场景：
        // 1. 第一次 LLM 调用成功，启动后台任务
        // 2. 第二次 LLM 调用（处理任务结果时）遇到 RATE_LIMIT
        // 3. 持续 RATE_LIMIT 直到重试次数用尽

        let callCount = 0;
        let taskStarted = false;

        const customProvider = {
            async generate(_messages: unknown[]): Promise<LLMResponse> {
                callCount++;

                if (callCount === 1) {
                    // 第一次调用：返回后台任务工具调用
                    taskStarted = true;
                    return {
                        id: 'test-id-1',
                        object: 'chat.completion',
                        created: Date.now(),
                        model: 'test-model',
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: 'assistant',
                                    content: 'Starting analysis task in background.',
                                    tool_calls: [
                                        {
                                            id: 'call_task_123',
                                            type: 'function',
                                            function: {
                                                name: 'task',
                                                arguments: JSON.stringify({
                                                    description: 'Test task',
                                                    prompt: 'Do something',
                                                    subagent_type: 'general-purpose',
                                                    run_in_background: true,
                                                }),
                                            },
                                        },
                                    ],
                                },
                                finish_reason: 'tool_calls',
                            },
                        ],
                        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                    };
                }

                // 后续调用：抛出 RATE_LIMIT 错误
                throw new LLMRateLimitError('429 Too Many Requests', 1);
            },
            getTimeTimeout: () => 60000,
        };

        const agent = new Agent({
            provider: customProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId: 'test-context-task-rate-limit',
            maxLoops: 100,
            maxRetries: 5,
            retryDelayMs: 1,
        });

        const result = await agent.executeWithResult('Analyze the project');

        console.log('Result status:', result.status);
        console.log('Task started:', taskStarted);
        console.log('Total LLM calls:', callCount);

        // 验证任务失败了
        expect(result.status).toBe('failed');
        expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        // 验证后台任务确实启动了
        expect(taskStarted).toBe(true);

        // 验证消息状态
        const messages = agent.getMessages();
        const assistantMessages = messages.filter((m) => m.role === 'assistant');
        const toolMessages = messages.filter((m) => m.role === 'tool');

        console.log(
            'Messages:',
            messages.map((m) => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content.substring(0, 50) : '[non-string]',
                finish_reason: m.finish_reason,
                tool_calls: m.tool_calls?.length,
            }))
        );

        // 应该有 1 条助手消息（带 tool_calls）
        expect(assistantMessages.length).toBe(1);
        expect(assistantMessages[0].finish_reason).toBe('tool_calls');

        // 应该有 1 条工具消息（任务启动确认）
        expect(toolMessages.length).toBe(1);

        // 验证调用次数：至少有 1 次成功 + (maxRetries + 1) 次失败
        // 注意：subagent 可能也会有额外的 LLM 调用
        // 所以这里只验证最小调用次数
        // 预期：至少 1 + 6 = 7 次（主 Agent）
        expect(callCount).toBeGreaterThanOrEqual(7);
    });

    it('验证：AgentMaxRetriesExceededError 能检测 RATE_LIMIT 错误并提供恢复建议', async () => {
        const { AgentMaxRetriesExceededError } = await import('./errors');

        // 测试 RATE_LIMIT 错误
        const rateLimitError = new AgentMaxRetriesExceededError('[RATE_LIMIT] 429 Too Many Requests');
        expect(rateLimitError.isRateLimit).toBe(true);
        expect(rateLimitError.recoveryHint).toBeDefined();
        expect(rateLimitError.recoveryHint).toContain('Rate limit exceeded');
        expect(rateLimitError.recoveryHint).toContain('sessionId');

        // 测试非 RATE_LIMIT 错误
        const otherError = new AgentMaxRetriesExceededError('[TIMEOUT] Request timeout');
        expect(otherError.isRateLimit).toBe(false);
        expect(otherError.recoveryHint).toBeUndefined();

        // 测试无原因的错误
        const noReasonError = new AgentMaxRetriesExceededError();
        expect(noReasonError.isRateLimit).toBe(false);
        expect(noReasonError.recoveryHint).toBeUndefined();

        console.log('Rate limit error recovery hint:', rateLimitError.recoveryHint);
    });

});
