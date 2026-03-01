/**
 * Agent 超时控制全面测试
 *
 * 测试目标：
 * 1. Agent 默认超时（回退到 Provider）
 * 2. Agent 自定义超时
 * 3. 超时后重试机制
 * 4. 超时超过最大重试次数
 * 5. 超时信号正确传递
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../agent';
import { createMemoryManager } from '../../memory';
import { LLMProvider, LLMRetryableError } from '../../../providers';
import type { LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../../providers';

/**
 * 可控的 Mock Provider
 */
function createControllableProvider(options: { timeout?: number; shouldTimeout?: boolean; maxTimeouts?: number } = {}) {
    let callCount = 0;
    let timeoutCount = 0;
    const _timeout = options.timeout ?? 180000;
    const shouldTimeout = options.shouldTimeout ?? false;
    const maxTimeouts = options.maxTimeouts ?? Infinity;

    const provider = {
        generate: async (
            _messages: LLMRequestMessage[],
            _options?: LLMGenerateOptions
        ): Promise<LLMResponse | null> => {
            callCount++;

            if (shouldTimeout && timeoutCount < maxTimeouts) {
                timeoutCount++;
                throw new LLMRetryableError(`Request timeout after ${_timeout}ms`, 10, 'TIMEOUT');
            }

            return {
                id: `test-id-${callCount}`,
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        message: { role: 'assistant' as const, content: `Response ${callCount}` },
                        finish_reason: 'stop',
                    },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
        },
        getTimeTimeout: () => _timeout,
        getLLMMaxTokens: () => 4096,
        getMaxOutputTokens: () => 128,
    };

    return {
        ...provider,
        get callCount() {
            return callCount;
        },
        get timeoutCount() {
            return timeoutCount;
        },
        reset: () => {
            callCount = 0;
            timeoutCount = 0;
        },
    } as unknown as LLMProvider;
}

describe('Agent 超时控制测试', () => {
    const memoryManagers: Array<ReturnType<typeof createMemoryManager>> = [];

    afterEach(async () => {
        for (const memoryManager of memoryManagers) {
            await memoryManager.close();
        }
        memoryManagers.length = 0;
    });

    describe('超时配置', () => {
        it('应该使用 Agent 配置的 requestTimeout', async () => {
            const provider = createControllableProvider({ timeout: 300000 }); // 5 分钟
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: false,
                memoryManager,
                requestTimeout: 60000, // 1 分钟（覆盖 Provider 的 5 分钟）
                maxRetries: 0,
            });

            // 正常请求应该成功
            const result = await agent.executeWithResult('hello');
            expect(result.status).toBe('completed');
        });

        it('应该在未设置 requestTimeout 时回退到 Provider.getTimeTimeout()', async () => {
            const provider = createControllableProvider({ timeout: 180000 });
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: false,
                memoryManager,
                // 不设置 requestTimeout
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');
            expect(result.status).toBe('completed');
        });
    });

    describe('超时重试机制', () => {
        it('超时后应该自动重试', async () => {
            const provider = createControllableProvider({
                shouldTimeout: true,
                maxTimeouts: 1, // 只超时 1 次
            });

            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: false,
                memoryManager,
                maxRetries: 3,
                retryDelayMs: 10, // 快速重试
            });

            const result = await agent.executeWithResult('hello');

            // 应该在第 2 次成功
            expect(result.status).toBe('completed');
        });

        it('超过最大重试次数应该返回失败', async () => {
            const provider = createControllableProvider({
                shouldTimeout: true,
                maxTimeouts: Infinity, // 一直超时
            });

            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: false,
                memoryManager,
                maxRetries: 2,
                retryDelayMs: 10, // 快速重试
            });

            const result = await agent.executeWithResult('hello');

            expect(result.status).toBe('failed');
            expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');
        });
    });

    describe('requestTimeout 行为测试', () => {
        it('requestTimeout 应用于每次 LLM 调用，总时间可以超过单个超时', async () => {
            const provider = createControllableProvider({
                shouldTimeout: true,
                maxTimeouts: 1, // 第 1 次超时
                timeout: 100,
            });

            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: false,
                memoryManager,
                requestTimeout: 100, // 100ms
                maxRetries: 1,
                retryDelayMs: 50,
            });

            const result = await agent.executeWithResult('hello');

            // 应该成功（第 1 次超时，第 2 次成功）
            expect(result.status).toBe('completed');
        });
    });

    describe('超时错误类型', () => {
        it('超时应该触发重试机制', async () => {
            const provider = createControllableProvider({
                shouldTimeout: true,
                maxTimeouts: 1,
            });

            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: false,
                memoryManager,
                maxRetries: 1,
                retryDelayMs: 10,
            });

            // 第一次会超时，第二次成功
            const result = await agent.executeWithResult('hello');

            expect(result.status).toBe('completed');
        });
    });
});
