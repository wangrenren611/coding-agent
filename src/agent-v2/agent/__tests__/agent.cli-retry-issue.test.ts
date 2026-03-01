/**
 * CLI 场景测试：复现补偿重试超过限制后，重新发送消息仍然失败的问题
 *
 * 问题描述：
 * 1. 用户发送消息，LLM 持续返回空响应，导致补偿重试超过限制
 * 2. 用户重新发送新消息，但仍然失败
 * 3. 原因：Session 状态不一致，空响应消息没有被移除
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '../agent';
import { createMemoryManager } from '../../memory';
import type { LLMResponse } from '../../../providers/types';
import type { LLMProvider } from '../../../providers';

// 延迟函数，等待持久化完成
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mock Provider
class MockProvider {
    public callCount = 0;
    public customResponses: Partial<LLMResponse>[] = [];
    public responseIndex = 0;

    async generate(_messages: unknown[]) {
        this.callCount++;

        // 使用自定义响应队列
        if (this.customResponses.length > 0) {
            const response = this.customResponses[Math.min(this.responseIndex, this.customResponses.length - 1)];
            this.responseIndex++;
            return {
                id: `test-id-${this.callCount}`,
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                ...response,
            } as LLMResponse;
        }

        return {
            id: `test-id-${this.callCount}`,
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant' as const,
                        content: 'Hello! How can I help you?',
                    },
                    finish_reason: 'stop' as const,
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
        this.customResponses = [];
        this.responseIndex = 0;
    }
}

describe('CLI 场景：补偿重试超过限制后重新发送消息', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;
    const sessionId = 'test-cli-session-' + Date.now();

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/cli-retry-issue-' + sessionId,
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    it('复现问题：补偿重试超过限制后，Session 状态应该保持一致', async () => {
        // 场景 1：LLM 持续返回空响应，导致补偿重试超过限制
        mockProvider.customResponses = [
            {
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: '' },
                        finish_reason: 'stop' as const,
                    },
                ],
            },
            {
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: '' },
                        finish_reason: 'stop' as const,
                    },
                ],
            },
        ];

        // 第一次请求
        const agent1 = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId,
            maxLoops: 10,
            maxRetries: 1,
            retryDelayMs: 1,
        });

        const result1 = await agent1.executeWithResult('Hello');

        // 第一次请求应该失败
        expect(result1.status).toBe('failed');

        // 检查 Session 中的消息
        const messagesAfterFirst = agent1.getMessages();
        const assistantMessagesAfterFirst = messagesAfterFirst.filter((m) => m.role === 'assistant');

        console.log(
            '第一次请求后的消息:',
            messagesAfterFirst.map((m) => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content.substring(0, 50) : m.content,
            }))
        );

        // 关键检查：空响应消息是否被移除？
        // 如果问题存在，这里会有空响应消息
        // 如果问题已修复，这里应该没有空响应消息
        console.log('助手消息数量:', assistantMessagesAfterFirst.length);
        console.log(
            '助手消息内容:',
            assistantMessagesAfterFirst.map((m) => m.content)
        );

        const historyAfterFirst = await memoryManager.getFullHistory({ sessionId });
        const emptyAssistantInHistoryAfterFirst = historyAfterFirst.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );
        expect(emptyAssistantInHistoryAfterFirst.length).toBeGreaterThan(0);
        expect(
            emptyAssistantInHistoryAfterFirst.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedFromContext === true
            )
        ).toBe(true);
        expect(
            emptyAssistantInHistoryAfterFirst.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedReason === 'empty_response'
            )
        ).toBe(true);

        // 场景 2：用户重新发送新消息（使用同一个 sessionId）
        mockProvider.reset();
        mockProvider.customResponses = [
            {
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: 'Normal response' },
                        finish_reason: 'stop' as const,
                    },
                ],
            },
        ];

        // 第二次请求 - 使用同一个 sessionId
        const agent2 = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId, // 复用 sessionId
            maxLoops: 10,
            maxRetries: 1,
            retryDelayMs: 1,
        });

        const result2 = await agent2.executeWithResult('New message');

        console.log('第二次请求结果:', result2.status);
        console.log(
            '第二次请求后的消息:',
            agent2.getMessages().map((m) => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content.substring(0, 50) : m.content,
            }))
        );

        // 第二次请求应该成功
        expect(result2.status).toBe('completed');

        // 检查 Session 中是否有空响应消息残留
        const messagesAfterSecond = agent2.getMessages();
        const emptyAssistantMessages = messagesAfterSecond.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );

        console.log('空助手消息数量:', emptyAssistantMessages.length);

        // 如果问题存在，这里会有空响应消息残留
        // 如果问题已修复，这里应该没有空响应消息
        expect(emptyAssistantMessages.length).toBe(0);

        const historyAfterSecond = await memoryManager.getFullHistory({ sessionId });
        const emptyAssistantInHistoryAfterSecond = historyAfterSecond.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );
        expect(emptyAssistantInHistoryAfterSecond.length).toBeGreaterThan(0);
        expect(
            emptyAssistantInHistoryAfterSecond.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedFromContext === true
            )
        ).toBe(true);
        expect(
            emptyAssistantInHistoryAfterSecond.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedReason === 'empty_response'
            )
        ).toBe(true);
    }, 15000);

    it('验证：补偿重试超过限制时，空响应消息应该被移除', async () => {
        mockProvider.customResponses = [
            {
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: '' },
                        finish_reason: 'stop' as const,
                    },
                ],
            },
            {
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: '' },
                        finish_reason: 'stop' as const,
                    },
                ],
            },
        ];

        const agent = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId: 'test-remove-empty-' + Date.now(),
            maxLoops: 10,
            maxRetries: 1,
            retryDelayMs: 1,
        });

        const result = await agent.executeWithResult('Hello');

        // 请求应该失败
        expect(result.status).toBe('failed');

        // 检查 Session 中的消息
        const messages = agent.getMessages();

        // 应该只有：系统消息 + 用户消息
        // 不应该有：空响应助手消息
        const systemMessages = messages.filter((m) => m.role === 'system');
        const userMessages = messages.filter((m) => m.role === 'user');
        const assistantMessages = messages.filter((m) => m.role === 'assistant');

        console.log('消息统计:', {
            total: messages.length,
            system: systemMessages.length,
            user: userMessages.length,
            assistant: assistantMessages.length,
        });

        expect(systemMessages.length).toBe(1);
        expect(userMessages.length).toBe(1);

        // 关键检查：空响应消息应该被移除
        expect(assistantMessages.length).toBe(0);

        const history = await memoryManager.getFullHistory({ sessionId: agent.getSessionId() });
        const emptyAssistantInHistory = history.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );
        expect(emptyAssistantInHistory.length).toBeGreaterThan(0);
        expect(
            emptyAssistantInHistory.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedFromContext === true
            )
        ).toBe(true);
        expect(
            emptyAssistantInHistory.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedReason === 'empty_response'
            )
        ).toBe(true);
    }, 10000);

    it('深度测试：持久化场景 - 从持久化存储恢复后不应有空响应消息', async () => {
        const testSessionId = 'test-persist-session-' + Date.now();

        // 场景 1：第一次请求失败（补偿重试超过限制）
        mockProvider.customResponses = [
            {
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: '' },
                        finish_reason: 'stop' as const,
                    },
                ],
            },
            {
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: '' },
                        finish_reason: 'stop' as const,
                    },
                ],
            },
        ];

        const agent1 = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test System',
            stream: false,
            memoryManager,
            sessionId: testSessionId,
            maxLoops: 10,
            maxRetries: 1,
            retryDelayMs: 1,
        });

        const result1 = await agent1.executeWithResult('First message');
        expect(result1.status).toBe('failed');

        // 等待持久化完成
        await delay(100);

        // 场景 2：创建新的 Agent 实例，从持久化存储恢复 Session
        mockProvider.reset();
        mockProvider.customResponses = [
            {
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: 'Success response' },
                        finish_reason: 'stop' as const,
                    },
                ],
            },
        ];

        const agent2 = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test System', // 必须相同的 systemPrompt 才能正确恢复
            stream: false,
            memoryManager,
            sessionId: testSessionId, // 复用 sessionId
            maxLoops: 10,
            maxRetries: 1,
            retryDelayMs: 1,
        });

        // 等待 Session 初始化（从持久化加载）
        await delay(100);

        // 检查从持久化恢复的消息
        const restoredMessages = agent2.getMessages();
        console.log(
            '从持久化恢复的消息:',
            restoredMessages.map((m) => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content.substring(0, 50) : m.content,
            }))
        );

        // 关键检查：恢复的消息中不应该有空响应消息
        const emptyAssistantMessages = restoredMessages.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );
        console.log('空助手消息数量（恢复后）:', emptyAssistantMessages.length);
        const restoredHistory = await memoryManager.getFullHistory({ sessionId: testSessionId });
        const emptyAssistantInRestoredHistory = restoredHistory.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );
        expect(emptyAssistantInRestoredHistory.length).toBeGreaterThan(0);
        expect(
            emptyAssistantInRestoredHistory.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedFromContext === true
            )
        ).toBe(true);
        expect(
            emptyAssistantInRestoredHistory.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedReason === 'empty_response'
            )
        ).toBe(true);

        // 执行第二次请求
        const result2 = await agent2.executeWithResult('Second message');
        console.log('第二次请求结果:', result2.status);

        // 第二次请求应该成功
        expect(result2.status).toBe('completed');

        // 最终检查：所有消息中不应该有空响应
        const finalMessages = agent2.getMessages();
        const finalEmptyMessages = finalMessages.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );

        console.log('最终空助手消息数量:', finalEmptyMessages.length);
        expect(finalEmptyMessages.length).toBe(0);

        const finalHistory = await memoryManager.getFullHistory({ sessionId: testSessionId });
        const finalEmptyInHistory = finalHistory.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );
        expect(finalEmptyInHistory.length).toBeGreaterThan(0);
        expect(
            finalEmptyInHistory.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedFromContext === true
            )
        ).toBe(true);
        expect(
            finalEmptyInHistory.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedReason === 'empty_response'
            )
        ).toBe(true);
    }, 15000);

    it('边界情况：如果 LLM 持续返回空响应，每次请求都会失败（这是预期行为）', async () => {
        const testSessionId = 'test-always-empty-' + Date.now();

        // 场景：LLM 始终返回空响应（这是 LLM 的问题，不是代码问题）
        const emptyResponse = {
            choices: [
                {
                    index: 0,
                    message: { role: 'assistant' as const, content: '' },
                    finish_reason: 'stop' as const,
                },
            ],
        };

        // 第一次请求
        mockProvider.customResponses = [emptyResponse, emptyResponse];
        const agent1 = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId: testSessionId,
            maxLoops: 10,
            maxRetries: 1,
            retryDelayMs: 1,
        });

        const result1 = await agent1.executeWithResult('First message');
        expect(result1.status).toBe('failed');
        expect(result1.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        // 第二次请求 - 即使 Session 状态正确，如果 LLM 还是返回空响应，仍然会失败
        mockProvider.reset();
        mockProvider.customResponses = [emptyResponse, emptyResponse];
        const agent2 = new Agent({
            provider: mockProvider as unknown as LLMProvider,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            sessionId: testSessionId,
            maxLoops: 10,
            maxRetries: 1,
            retryDelayMs: 1,
        });

        const result2 = await agent2.executeWithResult('Second message');

        // 这是预期行为：如果 LLM 持续返回空响应，每次请求都会失败
        // 但失败原因是普通重试超限，不是 Session 状态问题
        expect(result2.status).toBe('failed');
        expect(result2.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

        // 关键区别：Session 状态应该保持一致，不应该累积空响应消息
        const finalMessages = agent2.getMessages();
        const userMessages = finalMessages.filter((m) => m.role === 'user');
        const assistantMessages = finalMessages.filter((m) => m.role === 'assistant');

        // 应该有 2 条用户消息（两次请求）
        expect(userMessages.length).toBe(2);
        // 不应该有空响应消息残留
        expect(assistantMessages.length).toBe(0);

        const finalHistory = await memoryManager.getFullHistory({ sessionId: testSessionId });
        const finalEmptyInHistory = finalHistory.filter(
            (m) => m.role === 'assistant' && (typeof m.content === 'string' ? m.content === '' : true)
        );
        expect(finalEmptyInHistory.length).toBeGreaterThan(0);
        expect(
            finalEmptyInHistory.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedFromContext === true
            )
        ).toBe(true);
        expect(
            finalEmptyInHistory.every(
                (m: { excludedFromContext?: boolean; excludedReason?: string }) => m.excludedReason === 'empty_response'
            )
        ).toBe(true);

        console.log('最终消息统计:', {
            total: finalMessages.length,
            user: userMessages.length,
            assistant: assistantMessages.length,
        });
    }, 15000);
});
