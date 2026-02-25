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
import { Agent } from './agent';
import { createMemoryManager } from '../memory';
import { LLMProvider, LLMRetryableError } from '../../providers';
import type { Chunk, LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../providers';

/**
 * 可控的 Mock Provider
 */
class ControllableProvider extends LLMProvider {
    public callCount = 0;
    public shouldTimeout = false;
    public timeoutCount = 0;
    public maxTimeouts = Infinity;
    private readonly _timeout: number;

    constructor(options: { timeout?: number; shouldTimeout?: boolean; maxTimeouts?: number } = {}) {
        super({
            apiKey: 'test-key',
            baseURL: 'https://example.test',
            model: 'test-model',
            max_tokens: 128,
            LLMMAX_TOKENS: 4096,
            temperature: 0,
            timeout: options.timeout ?? 180000,
        });
        this._timeout = options.timeout ?? 180000;
        this.shouldTimeout = options.shouldTimeout ?? false;
        this.maxTimeouts = options.maxTimeouts ?? Infinity;
    }

    async generate(
        _messages: LLMRequestMessage[],
        _options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
        this.callCount++;

        if (this.shouldTimeout && this.timeoutCount < this.maxTimeouts) {
            this.timeoutCount++;
            throw new LLMRetryableError(`Request timeout after ${this._timeout}ms`, 10, 'TIMEOUT');
        }

        return {
            id: `test-id-${this.callCount}`,
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [
                {
                    index: 0,
                    message: { role: 'assistant', content: `Response ${this.callCount}` },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
    }

    getTimeTimeout(): number {
        return this._timeout;
    }

    getLLMMaxTokens(): number {
        return 4096;
    }

    getMaxOutputTokens(): number {
        return 128;
    }

    reset(): void {
        this.callCount = 0;
        this.timeoutCount = 0;
    }
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
            const provider = new ControllableProvider({ timeout: 300000 }); // 5 分钟
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
            const provider = new ControllableProvider({ timeout: 180000 });
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
            const provider = new ControllableProvider({
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
            expect(provider.callCount).toBe(2); // 第 1 次超时，第 2 次成功
            expect(provider.timeoutCount).toBe(1);
        });

        it('超过最大重试次数应该返回失败', async () => {
            const provider = new ControllableProvider({
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
            // maxRetries=2，所以最多 3 次调用（初始 + 2 次重试）
            expect(provider.callCount).toBeLessThanOrEqual(3);
        });
    });

    describe('requestTimeout 行为测试', () => {
        it('requestTimeout 应用于每次 LLM 调用，总时间可以超过单个超时', async () => {
            const provider = new ControllableProvider({
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
            expect(provider.callCount).toBe(2); // 1 次超时 + 1 次成功
        });
    });

    describe('超时错误类型', () => {
        it('超时应该触发重试机制', async () => {
            const provider = new ControllableProvider({
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
            expect(provider.timeoutCount).toBe(1);
        });
    });
});
