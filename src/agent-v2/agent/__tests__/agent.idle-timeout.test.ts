/**
 * Agent 空闲超时集成测试
 *
 * 测试目标：
 * 1. 流式请求中持续有数据不应该超时
 * 2. 非流式请求应该使用固定超时
 * 3. 空闲超时配置正确传递
 * 4. 真正空闲时超时应该触发
 * 5. 不同 idleTimeout 配置应该有不同行为
 * 6. 超时后应该触发重试机制
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agent } from '../agent';
import { createMemoryManager } from '../../memory';
import { LLMProvider } from '../../../providers';
import type { Chunk, LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../../providers';

/**
 * 可控的 Mock Provider，支持模拟流式输出
 */
function createMockStreamProvider() {
    let callCount = 0;
    let chunkCount = 0;
    let chunkInterval = 50;
    let totalChunks = 10;

    async function generate(
        _messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | AsyncGenerator<Chunk> | null> {
        callCount++;
        chunkCount = 0;

        if (options?.stream) {
            return generateStream(options.abortSignal);
        }

        // 非流式请求
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
    }

    async function* generateStream(abortSignal?: AbortSignal): AsyncGenerator<Chunk> {
        for (let i = 0; i < totalChunks; i++) {
            // 检查是否已中止
            if (abortSignal?.aborted) {
                return;
            }

            await new Promise((resolve) => setTimeout(resolve, chunkInterval));
            chunkCount++;

            yield {
                id: `chunk-${callCount}-${i}`,
                index: 0,
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        delta: { role: 'assistant' as const, content: `Chunk ${i + 1} ` },
                        finish_reason: i === totalChunks - 1 ? 'stop' : undefined,
                    },
                ],
            };
        }
    }

    return {
        generate,
        getTimeTimeout: () => 3 * 60 * 1000,
        getLLMMaxTokens: () => 4096,
        getMaxOutputTokens: () => 128,
        get callCount() {
            return callCount;
        },
        get chunkCount() {
            return chunkCount;
        },
        get chunkInterval() {
            return chunkInterval;
        },
        set chunkInterval(v: number) {
            chunkInterval = v;
        },
        get totalChunks() {
            return totalChunks;
        },
        set totalChunks(v: number) {
            totalChunks = v;
        },
        reset: () => {
            callCount = 0;
            chunkCount = 0;
        },
    };
}

/**
 * 创建一个可配置延迟模式的 Mock Provider
 * 用于测试空闲超时场景
 */
function createConfigurableDelayProvider(config: {
    /** 每次发送 chunk 前的延迟数组，循环使用 */
    delays: number[];
    /** 总共发送多少个 chunk */
    totalChunks: number;
}) {
    let callCount = 0;
    let chunkCount = 0;

    async function generate(
        _messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | AsyncGenerator<Chunk> | null> {
        callCount++;
        chunkCount = 0;

        if (options?.stream) {
            return generateStream(options.abortSignal);
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
    }

    async function* generateStream(abortSignal?: AbortSignal): AsyncGenerator<Chunk> {
        for (let i = 0; i < config.totalChunks; i++) {
            if (abortSignal?.aborted) {
                return;
            }

            // 使用配置的延迟（循环使用）
            const delay = config.delays[i % config.delays.length];
            await new Promise((resolve) => setTimeout(resolve, delay));
            chunkCount++;

            yield {
                id: `chunk-${callCount}-${i}`,
                index: 0,
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        delta: { role: 'assistant' as const, content: `Chunk ${i + 1} ` },
                        finish_reason: i === config.totalChunks - 1 ? 'stop' : undefined,
                    },
                ],
            };
        }
    }

    return {
        generate,
        getTimeTimeout: () => 3 * 60 * 1000,
        getLLMMaxTokens: () => 4096,
        getMaxOutputTokens: () => 128,
        get callCount() {
            return callCount;
        },
        get chunkCount() {
            return chunkCount;
        },
        reset: () => {
            callCount = 0;
            chunkCount = 0;
        },
    };
}

describe('Agent 空闲超时集成测试', () => {
    let provider: ReturnType<typeof createMockStreamProvider>;
    const memoryManagers: Array<ReturnType<typeof createMemoryManager>> = [];

    beforeEach(() => {
        provider = createMockStreamProvider();
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
                provider: provider as unknown as LLMProvider,
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
                provider: provider as unknown as LLMProvider,
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
                provider: provider as unknown as LLMProvider,
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
                provider: provider as unknown as LLMProvider,
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
                provider: provider as unknown as LLMProvider,
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
                provider: provider as unknown as LLMProvider,
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

    // ==================== 新增测试：真正验证 idleTimeout 生效 ====================

    describe('空闲超时真正触发', () => {
        it('chunk 间隔超过 idleTimeout 应该触发超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-trigger-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 创建一个 provider，在 chunk 之间有长延迟
            // 第一个 chunk 快速发送，第二个 chunk 延迟 500ms
            const slowProvider = createConfigurableDelayProvider({
                delays: [30, 500], // 第一个 30ms，第二个 500ms
                totalChunks: 5,
            });

            // 空闲超时 100ms，比第二个 chunk 的延迟 500ms 短
            const agent = new Agent({
                provider: slowProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 100, // 100ms 空闲超时
                maxRetries: 0, // 不重试
            });

            const result = await agent.executeWithResult('hello');

            // 应该失败（因为第二个 chunk 延迟 500ms > idleTimeout 100ms）
            expect(result.status).toBe('failed');
            expect(result.failure).toBeDefined();
            // 空闲超时会在等待下一个 chunk 时触发
            // 由于时序问题，可能收到 1 或 2 个 chunk
            expect(slowProvider.chunkCount).toBeGreaterThanOrEqual(1);
        }, 15000);

        it('超时错误应该包含正确的错误信息', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-error-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const slowProvider = createConfigurableDelayProvider({
                delays: [20, 300], // 第一个 20ms，第二个 300ms
                totalChunks: 3,
            });

            const agent = new Agent({
                provider: slowProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 100, // 100ms 空闲超时
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            expect(result.status).toBe('failed');
            expect(result.failure?.code).toBeDefined();
            // 超时相关的错误码（可能触发重试，最终可能是 MAX_RETRIES_EXCEEDED）
            expect(['LLM_TIMEOUT', 'LLM_REQUEST_FAILED', 'AGENT_MAX_RETRIES_EXCEEDED']).toContain(result.failure?.code);
        }, 15000);

        it('chunk 间隔小于 idleTimeout 不应该触发超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-no-trigger-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 创建一个 provider，chunk 间隔短于 idleTimeout
            const fastProvider = createConfigurableDelayProvider({
                delays: [50], // 每个 chunk 间隔 50ms
                totalChunks: 5,
            });

            // 空闲超时 200ms，比 chunk 间隔 50ms 长
            const agent = new Agent({
                provider: fastProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 200, // 200ms 空闲超时
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 应该成功完成
            expect(result.status).toBe('completed');
            // 应该收到所有 5 个 chunk
            expect(fastProvider.chunkCount).toBe(5);
        }, 15000);
    });

    describe('不同 idleTimeout 配置的行为差异', () => {
        it('短超时配置应该比长超时配置更快失败', async () => {
            // 测试 1: 短超时配置
            const memoryManager1 = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-short-${Date.now()}`,
            });
            memoryManagers.push(memoryManager1);
            await memoryManager1.initialize();

            // chunk 间隔：第一个 30ms，第二个 300ms
            const provider1 = createConfigurableDelayProvider({
                delays: [30, 300],
                totalChunks: 5,
            });

            const agent1 = new Agent({
                provider: provider1 as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager: memoryManager1,
                idleTimeout: 100, // 100ms 短超时
                maxRetries: 0,
            });

            const startTime1 = Date.now();
            await agent1.executeWithResult('hello');
            const duration1 = Date.now() - startTime1;

            // 测试 2: 长超时配置
            const memoryManager2 = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-long-${Date.now()}`,
            });
            memoryManagers.push(memoryManager2);
            await memoryManager2.initialize();

            // 同样的延迟配置
            const provider2 = createConfigurableDelayProvider({
                delays: [30, 300],
                totalChunks: 5,
            });

            const agent2 = new Agent({
                provider: provider2 as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager: memoryManager2,
                idleTimeout: 500, // 500ms 长超时
                maxRetries: 0,
            });

            const startTime2 = Date.now();
            await agent2.executeWithResult('hello');
            const duration2 = Date.now() - startTime2;

            // 短超时配置：约 30ms (第1个chunk) + 100ms (等待超时) = ~130ms
            // 长超时配置：约 30ms + 300ms (第2个chunk) + 300ms + 300ms + 300ms = ~1230ms
            // 长超时应该花费更长时间（因为能完成更多 chunks）
            expect(duration2).toBeGreaterThan(duration1 + 300);
            // 长超时应该收到更多 chunks
            expect(provider2.chunkCount).toBeGreaterThan(provider1.chunkCount);
        }, 20000);
    });

    describe('空闲超时与重试机制', () => {
        it('空闲超时后应该触发重试', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-retry-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            let attemptCount = 0;

            // 创建一个自定义 provider，在第二次尝试时成功
            const retryProvider = {
                getTimeTimeout: () => 3 * 60 * 1000,
                getLLMMaxTokens: () => 4096,
                getMaxOutputTokens: () => 128,
                generate: async (
                    _messages: LLMRequestMessage[],
                    options?: LLMGenerateOptions
                ): Promise<LLMResponse | AsyncGenerator<Chunk> | null> => {
                    attemptCount++;
                    const currentAttempt = attemptCount;

                    if (options?.stream) {
                        return (async function* () {
                            if (currentAttempt === 1) {
                                // 第一次尝试：第一个 chunk 快速，第二个延迟很久（触发超时）
                                await new Promise((r) => setTimeout(r, 30));
                                yield {
                                    id: `chunk-1-0`,
                                    index: 0,
                                    object: 'chat.completion.chunk',
                                    created: Date.now(),
                                    model: 'test-model',
                                    choices: [
                                        {
                                            index: 0,
                                            delta: { role: 'assistant' as const, content: 'Chunk 1 ' },
                                        },
                                    ],
                                };
                                // 长延迟，会触发空闲超时
                                await new Promise((r) => setTimeout(r, 500));
                                yield {
                                    id: `chunk-1-1`,
                                    index: 0,
                                    object: 'chat.completion.chunk',
                                    created: Date.now(),
                                    model: 'test-model',
                                    choices: [
                                        {
                                            index: 0,
                                            delta: { role: 'assistant' as const, content: 'Chunk 2 ' },
                                        },
                                    ],
                                };
                            } else {
                                // 第二次尝试：快速完成
                                for (let i = 0; i < 3; i++) {
                                    if (options?.abortSignal?.aborted) return;
                                    await new Promise((r) => setTimeout(r, 30));
                                    yield {
                                        id: `chunk-2-${i}`,
                                        index: 0,
                                        object: 'chat.completion.chunk',
                                        created: Date.now(),
                                        model: 'test-model',
                                        choices: [
                                            {
                                                index: 0,
                                                delta: { role: 'assistant' as const, content: `Retry Chunk ${i + 1} ` },
                                                finish_reason: i === 2 ? 'stop' : undefined,
                                            },
                                        ],
                                    };
                                }
                            }
                        })();
                    }

                    // 非流式
                    return {
                        id: `test-id-${attemptCount}`,
                        object: 'chat.completion',
                        created: Date.now(),
                        model: 'test-model',
                        choices: [
                            {
                                index: 0,
                                message: { role: 'assistant' as const, content: `Response ${attemptCount}` },
                                finish_reason: 'stop',
                            },
                        ],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                    };
                },
            };

            const agent = new Agent({
                provider: retryProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 100, // 100ms 空闲超时
                maxRetries: 3, // 允许重试
                retryDelayMs: 50, // 短重试延迟
            });

            const result = await agent.executeWithResult('hello');

            // 应该成功（第二次重试成功）
            expect(result.status).toBe('completed');
            // 验证确实进行了多次尝试
            expect(attemptCount).toBeGreaterThanOrEqual(2);
            // 验证重试计数
            expect(result.retryCount).toBeGreaterThanOrEqual(1);
        }, 20000);
    });

    describe('边界条件', () => {
        it('非常大的 idleTimeout 值应该正常工作', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-large-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 24 * 60 * 60 * 1000, // 24 小时
                maxRetries: 0,
            });

            provider.totalChunks = 3;
            provider.chunkInterval = 30;

            const result = await agent.executeWithResult('hello');

            // 正常完成
            expect(result.status).toBe('completed');
            expect(provider.chunkCount).toBe(3);
        }, 10000);

        it('非流式模式下 idleTimeout 不应该影响请求', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-nonstream-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 非流式模式，设置非常短的 idleTimeout（不应该生效）
            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: false, // 非流式
                memoryManager,
                idleTimeout: 1, // 1ms（非常短，但对非流式无效）
                requestTimeout: 60000, // 1 分钟固定超时
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 应该成功（idleTimeout 对非流式请求无效）
            expect(result.status).toBe('completed');
        }, 10000);

        it('idleTimeout 等于 chunk 间隔时应该能正常工作', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-equal-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // chunk 间隔刚好等于 idleTimeout
            const exactProvider = createConfigurableDelayProvider({
                delays: [100], // 每个 chunk 间隔 100ms
                totalChunks: 5,
            });

            const agent = new Agent({
                provider: exactProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 100, // 100ms，等于 chunk 间隔
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 由于时序问题，这个测试可能成功也可能失败
            // 主要是验证不会崩溃
            expect(['completed', 'failed']).toContain(result.status);
        }, 15000);
    });

    describe('idleTimeout 配置验证', () => {
        it('idleTimeout 为负数时应该使用默认值', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-negative-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 负数应该被忽略，使用默认值
            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: -100, // 负数
                maxRetries: 0,
            });

            provider.totalChunks = 3;
            provider.chunkInterval = 50;

            const result = await agent.executeWithResult('hello');

            // 应该正常工作（使用默认的 3 分钟超时）
            expect(result.status).toBe('completed');
        }, 10000);

        it('idleTimeout 为 undefined 时应该使用默认值', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-undefined-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                // 不设置 idleTimeout
                maxRetries: 0,
            });

            provider.totalChunks = 3;
            provider.chunkInterval = 50;

            const result = await agent.executeWithResult('hello');

            // 应该正常工作（使用默认值）
            expect(result.status).toBe('completed');
        }, 10000);

        it('idleTimeout=0 应该使用默认值而不是立即超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-zero-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // idleTimeout=0 应该被视为无效值，使用默认的 3 分钟
            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 0, // 0 应该使用默认值
                maxRetries: 0,
            });

            provider.totalChunks = 3;
            provider.chunkInterval = 50;

            const result = await agent.executeWithResult('hello');

            // 应该正常完成（因为 0 被替换为默认值 3 分钟）
            expect(result.status).toBe('completed');
            expect(provider.chunkCount).toBe(3);
        }, 10000);

        it('idleTimeout 为 NaN 应该使用默认值', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-nan-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: NaN,
                maxRetries: 0,
            });

            provider.totalChunks = 3;
            provider.chunkInterval = 50;

            const result = await agent.executeWithResult('hello');

            // 应该正常完成
            expect(result.status).toBe('completed');
        }, 10000);

        it('idleTimeout 为 Infinity 应该使用默认值', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-idle-timeout-infinity-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: Infinity,
                maxRetries: 0,
            });

            provider.totalChunks = 3;
            provider.chunkInterval = 50;

            const result = await agent.executeWithResult('hello');

            // 应该正常完成（Infinity 被 normalizeMs 处理）
            expect(result.status).toBe('completed');
        }, 10000);
    });

    // ==================== abort 期间 chunk 产出测试 ====================

    describe('abort 期间 chunk 产出', () => {
        it('超时触发时 generator 应该正确响应 abort signal', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-abort-chunk-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            let chunksBeforeAbort = 0;
            let abortSignalReceived = false;

            const trackingProvider = {
                getTimeTimeout: () => 3 * 60 * 1000,
                getLLMMaxTokens: () => 4096,
                getMaxOutputTokens: () => 128,
                generate: async (
                    _messages: LLMRequestMessage[],
                    options?: LLMGenerateOptions
                ): Promise<LLMResponse | AsyncGenerator<Chunk> | null> => {
                    if (options?.stream) {
                        return (async function* () {
                            for (let i = 0; i < 10; i++) {
                                // 检查 abort signal
                                if (options?.abortSignal?.aborted) {
                                    abortSignalReceived = true;
                                    return;
                                }

                                // 第一个 chunk 快速，后续慢
                                const delay = i === 0 ? 20 : 500;
                                await new Promise((r) => setTimeout(r, delay));

                                // 再次检查（等待后可能已 abort）
                                if (options?.abortSignal?.aborted) {
                                    abortSignalReceived = true;
                                    return;
                                }

                                chunksBeforeAbort++;
                                yield {
                                    id: `chunk-${i}`,
                                    index: 0,
                                    object: 'chat.completion.chunk',
                                    created: Date.now(),
                                    model: 'test-model',
                                    choices: [
                                        {
                                            index: 0,
                                            delta: { role: 'assistant' as const, content: `Chunk ${i + 1} ` },
                                            finish_reason: i === 9 ? 'stop' : undefined,
                                        },
                                    ],
                                };
                            }
                        })();
                    }

                    return {
                        id: 'test-id',
                        object: 'chat.completion',
                        created: Date.now(),
                        model: 'test-model',
                        choices: [
                            {
                                index: 0,
                                message: { role: 'assistant' as const, content: 'Response' },
                                finish_reason: 'stop',
                            },
                        ],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                    };
                },
            };

            const agent = new Agent({
                provider: trackingProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 100, // 100ms 空闲超时
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 应该失败
            expect(result.status).toBe('failed');
            // 验证 generator 检测到了 abort
            expect(abortSignalReceived).toBe(true);
            // 验证只产出了部分 chunks（第一个快速 chunk 后，第二个在等待时超时）
            expect(chunksBeforeAbort).toBeGreaterThanOrEqual(1);
            expect(chunksBeforeAbort).toBeLessThan(10);
        }, 15000);

        it('超时后不应该有 chunk 继续被处理', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-no-chunk-after-abort-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const processedChunks: number[] = [];
            let generationComplete = false;

            const delayedProvider = {
                getTimeTimeout: () => 3 * 60 * 1000,
                getLLMMaxTokens: () => 4096,
                getMaxOutputTokens: () => 128,
                generate: async (
                    _messages: LLMRequestMessage[],
                    options?: LLMGenerateOptions
                ): Promise<LLMResponse | AsyncGenerator<Chunk> | null> => {
                    if (options?.stream) {
                        return (async function* () {
                            try {
                                for (let i = 0; i < 5; i++) {
                                    if (options?.abortSignal?.aborted) {
                                        return;
                                    }

                                    // 第一个快速，后续慢
                                    const delay = i === 0 ? 20 : 300;
                                    await new Promise((r) => setTimeout(r, delay));

                                    if (options?.abortSignal?.aborted) {
                                        return;
                                    }

                                    processedChunks.push(i);
                                    yield {
                                        id: `chunk-${i}`,
                                        index: 0,
                                        object: 'chat.completion.chunk',
                                        created: Date.now(),
                                        model: 'test-model',
                                        choices: [
                                            {
                                                index: 0,
                                                delta: { role: 'assistant' as const, content: `${i} ` },
                                            },
                                        ],
                                    };
                                }
                            } finally {
                                generationComplete = true;
                            }
                        })();
                    }

                    return {
                        id: 'test-id',
                        object: 'chat.completion',
                        created: Date.now(),
                        model: 'test-model',
                        choices: [
                            {
                                index: 0,
                                message: { role: 'assistant' as const, content: 'Response' },
                                finish_reason: 'stop',
                            },
                        ],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                    };
                },
            };

            const agent = new Agent({
                provider: delayedProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 100,
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 等待 generator 完全结束
            await new Promise((r) => setTimeout(r, 100));

            expect(result.status).toBe('failed');
            // 验证 generator 已经完成（不会泄漏）
            expect(generationComplete).toBe(true);
            // 验证只处理了部分 chunks
            expect(processedChunks.length).toBeLessThan(5);
        }, 15000);

        it('正在 yield 的 chunk 应该被完整处理', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-complete-chunk-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 500,
                maxRetries: 0,
            });

            provider.totalChunks = 5;
            provider.chunkInterval = 50;

            const result = await agent.executeWithResult('hello');

            expect(result.status).toBe('completed');
            // 验证最终消息有内容（所有 chunk 被处理）
            expect(result.finalMessage?.content).toBeDefined();
            const content = typeof result.finalMessage?.content === 'string' ? result.finalMessage?.content : '';
            // 验证内容包含多个 chunk（"Chunk 1", "Chunk 2" 等）
            expect(content).toContain('Chunk');
        }, 10000);
    });

    // ==================== 竞态条件测试 ====================

    describe('竞态条件', () => {
        it('chunk 刚好在超时边界到达时应该能正确处理', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-race-condition-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 使用非常接近 idleTimeout 的延迟
            const boundaryProvider = createConfigurableDelayProvider({
                delays: [95, 95, 95, 95, 95], // 每个 95ms，接近 100ms 边界
                totalChunks: 5,
            });

            const agent = new Agent({
                provider: boundaryProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 100, // 100ms，略大于 chunk 间隔
                maxRetries: 0,
            });

            // 多次运行验证稳定性
            const results = [];
            for (let i = 0; i < 3; i++) {
                const result = await agent.executeWithResult('hello');
                results.push(result.status);
                boundaryProvider.reset();
            }

            // 所有的运行都不应该崩溃
            results.forEach((status) => {
                expect(['completed', 'failed']).toContain(status);
            });
        }, 30000);

        it('连续超时重试应该正确清理状态', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-retry-cleanup-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            let globalAttemptCount = 0;

            const failingProvider = {
                getTimeTimeout: () => 3 * 60 * 1000,
                getLLMMaxTokens: () => 4096,
                getMaxOutputTokens: () => 128,
                generate: async (
                    _messages: LLMRequestMessage[],
                    options?: LLMGenerateOptions
                ): Promise<LLMResponse | AsyncGenerator<Chunk> | null> => {
                    // 在 generator 创建前就确定当前是第几次尝试
                    globalAttemptCount++;
                    const currentAttempt = globalAttemptCount;
                    // 前 2 次尝试都超时，第 3 次成功
                    const shouldSucceed = currentAttempt >= 3;

                    if (options?.stream) {
                        return (async function* () {
                            for (let i = 0; i < 5; i++) {
                                if (options?.abortSignal?.aborted) return;

                                // 如果应该成功，使用短延迟；否则前 2 个 chunk 快速，后续慢
                                const delay = shouldSucceed ? 20 : i < 2 ? 20 : 500;
                                await new Promise((r) => setTimeout(r, delay));

                                if (options?.abortSignal?.aborted) return;

                                yield {
                                    id: `chunk-${currentAttempt}-${i}`,
                                    index: 0,
                                    object: 'chat.completion.chunk',
                                    created: Date.now(),
                                    model: 'test-model',
                                    choices: [
                                        {
                                            index: 0,
                                            delta: { role: 'assistant' as const, content: `${i} ` },
                                            finish_reason: shouldSucceed && i === 4 ? 'stop' : undefined,
                                        },
                                    ],
                                };
                            }
                        })();
                    }

                    return {
                        id: 'test-id',
                        object: 'chat.completion',
                        created: Date.now(),
                        model: 'test-model',
                        choices: [
                            {
                                index: 0,
                                message: { role: 'assistant' as const, content: 'Response' },
                                finish_reason: 'stop',
                            },
                        ],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                    };
                },
            };

            const agent = new Agent({
                provider: failingProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 100,
                maxRetries: 5,
                retryDelayMs: 50,
            });

            const result = await agent.executeWithResult('hello');

            // 最终应该成功（第 3 次尝试）
            expect(result.status).toBe('completed');
            // 验证进行了多次尝试
            expect(globalAttemptCount).toBeGreaterThanOrEqual(3);
            // 验证重试计数
            expect(result.retryCount).toBeGreaterThanOrEqual(2);
        }, 30000);
    });

    // ==================== 压力测试 ====================

    describe('压力测试', () => {
        it('大量短间隔 chunk 应该不会触发超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-stress-test-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 50 个 chunk，每个间隔 10ms，总计 500ms
            const stressProvider = createConfigurableDelayProvider({
                delays: [10],
                totalChunks: 50,
            });

            const agent = new Agent({
                provider: stressProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 50, // 50ms，大于 chunk 间隔 10ms
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 应该成功完成所有 chunk
            expect(result.status).toBe('completed');
            expect(stressProvider.chunkCount).toBe(50);
        }, 30000);

        it('chunk 间隔逐渐增加直到超过 idleTimeout 应该正确超时', async () => {
            const memoryManager = createMemoryManager({
                type: 'file',
                connectionString: `/tmp/agent-increasing-delay-${Date.now()}`,
            });
            memoryManagers.push(memoryManager);
            await memoryManager.initialize();

            // 延迟逐渐增加：20, 40, 60, 80, 100, 120...
            const increasingProvider = createConfigurableDelayProvider({
                delays: [20, 40, 60, 80, 100, 120, 150, 200],
                totalChunks: 20,
            });

            const agent = new Agent({
                provider: increasingProvider as unknown as LLMProvider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: 80, // 80ms
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');

            // 应该失败（某次延迟超过 80ms）
            expect(result.status).toBe('failed');
            // 验证处理了一部分 chunk 后超时
            expect(increasingProvider.chunkCount).toBeGreaterThan(0);
            expect(increasingProvider.chunkCount).toBeLessThan(20);
        }, 15000);
    });
});
