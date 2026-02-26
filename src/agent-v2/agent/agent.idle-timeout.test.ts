/**
 * Agent 空闲超时集成测试
 *
 * 测试目标：
 * 1. 流式请求中持续有数据不应该超时
 * 2. 非流式请求应该使用固定超时
 * 3. 空闲超时配置正确传递
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agent } from './agent';
import { createMemoryManager } from '../memory';
import { LLMProvider } from '../../providers';
import type { Chunk, LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../providers';

/**
 * 可控的 Mock Provider，支持模拟流式输出
 */
class MockStreamProvider extends LLMProvider {
    public callCount = 0;
    public chunkCount = 0;
    public chunkInterval = 50; // 每个 chunk 间隔 50ms
    public totalChunks = 10;

    constructor() {
        super({
            apiKey: 'test-key',
            baseURL: 'https://example.test',
            model: 'test-model',
            max_tokens: 128,
            LLMMAX_TOKENS: 4096,
            temperature: 0,
        });
    }

    async generate(
        _messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
        this.callCount++;
        this.chunkCount = 0;

        if (options?.stream) {
            return this.generateStream(options.abortSignal);
        }

        // 非流式请求
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

    private async *generateStream(abortSignal?: AbortSignal): AsyncGenerator<Chunk> {
        for (let i = 0; i < this.totalChunks; i++) {
            // 检查是否已中止
            if (abortSignal?.aborted) {
                return;
            }

            await new Promise((resolve) => setTimeout(resolve, this.chunkInterval));
            this.chunkCount++;

            yield {
                id: `chunk-${this.callCount}-${i}`,
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        delta: { content: `Chunk ${i + 1} ` },
                        finish_reason: i === this.totalChunks - 1 ? 'stop' : undefined,
                    },
                ],
            };
        }
    }

    getTimeTimeout(): number {
        return 3 * 60 * 1000; // 3 分钟
    }

    getLLMMaxTokens(): number {
        return 4096;
    }

    getMaxOutputTokens(): number {
        return 128;
    }

    reset(): void {
        this.callCount = 0;
        this.chunkCount = 0;
    }
}

describe('Agent 空闲超时集成测试', () => {
    let provider: MockStreamProvider;
    const memoryManagers: Array<ReturnType<typeof createMemoryManager>> = [];

    beforeEach(() => {
        provider = new MockStreamProvider();
    });

    afterEach(async () => {
        for (const memoryManager of memoryManagers) {
            await memoryManager.close();
        }
        memoryManagers.length = 0;
        provider.reset();
    });

    describe('流式请求空闲超时', () => {
        it('持续收到数据时不应该超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 配置：总共 10 个 chunk，每个间隔 50ms，总计约 500ms
            // 空闲超时设置为 200ms，但因为持续有数据，不应该超时
            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 200, // 200ms 空闲超时
                maxRetries: 0,
            });

            provider.totalChunks = 10;
            provider.chunkInterval = 50; // 每 50ms 发送一个 chunk

            const result = await agent.executeWithResult('hello');

            // 应该成功完成
            expect(result.status).toBe('completed');
            // 应该收到所有 10 个 chunk
            expect(provider.chunkCount).toBe(10);
        }, 15000);

        it('较长的流式请求应该能够完成', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 配置：总共 20 个 chunk，每个间隔 100ms，总计约 2 秒
            // 空闲超时设置为 500ms，但因为持续有数据，不应该超时
            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 500, // 500ms 空闲超时
                maxRetries: 0,
            });

            provider.totalChunks = 20;
            provider.chunkInterval = 100; // 每 100ms 发送一个 chunk

            const result = await agent.executeWithResult('hello');

            // 应该成功完成
            expect(result.status).toBe('completed');
            // 应该收到所有 20 个 chunk
            expect(provider.chunkCount).toBe(20);
        }, 30000);
    });

    describe('非流式请求超时', () => {
        it('非流式请求应该正常工作', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: false, // 非流式
                memoryManager,
                requestTimeout: 5000, // 固定 5 秒超时
                idleTimeout: 100, // 空闲超时 100ms（非流式不使用）
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 非流式请求应该快速成功
            expect(result.status).toBe('completed');
        }, 10000);

        it('非流式请求应该使用固定超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: false, // 非流式
                memoryManager,
                requestTimeout: 60000, // 固定 1 分钟超时
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 非流式请求应该成功
            expect(result.status).toBe('completed');
        }, 10000);
    });

    describe('空闲超时配置', () => {
        it('未配置时应该使用默认空闲超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 不配置 idleTimeout，使用默认值（3 分钟）
            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                maxRetries: 0,
            });

            // 正常流式请求应该成功
            provider.totalChunks = 5;
            provider.chunkInterval = 50;

            const result = await agent.executeWithResult('hello');
            expect(result.status).toBe('completed');
        }, 10000);

        it('应该能够配置自定义空闲超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 配置自定义空闲超时
            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 10000, // 10 秒
                maxRetries: 0,
            });

            provider.totalChunks = 5;
            provider.chunkInterval = 100;

            const result = await agent.executeWithResult('hello');
            expect(result.status).toBe('completed');
        }, 15000);
    });
});
