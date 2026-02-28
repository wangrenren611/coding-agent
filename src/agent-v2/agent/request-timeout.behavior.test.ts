/**
 * Agent 请求超时行为测试
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from './agent';
import { createMemoryManager } from '../memory';
import { LLMProvider, LLMRetryableError } from '../../providers';
import type { Chunk, LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../providers';

function createTimeoutThenSuccessProvider(timeoutMs: number) {
    let callCount = 0;

    const provider = {
        generate: async (
            _messages: LLMRequestMessage[],
            _options?: LLMGenerateOptions
        ): Promise<LLMResponse | null> => {
            callCount++;

            if (callCount === 1) {
                throw new LLMRetryableError(`Request timeout after ${timeoutMs}ms`, timeoutMs, 'TIMEOUT');
            }

            return {
                id: 'ok',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant' as const,
                            content: 'ok',
                        },
                        finish_reason: 'stop',
                    },
                ],
                usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                    total_tokens: 2,
                },
            };
        },
        getTimeTimeout: () => timeoutMs,
        getLLMMaxTokens: () => 4096,
        getMaxOutputTokens: () => 128,
    };

    return provider as unknown as LLMProvider;
}

function createStalledStreamProvider(providerTimeoutMs: number) {
    const provider = {
        generate: async (
            _messages: LLMRequestMessage[],
            options?: LLMGenerateOptions
        ): Promise<LLMResponse | AsyncGenerator<Chunk> | null> => {
            if (!options?.stream) {
                return {
                    id: 'ok-non-stream',
                    object: 'chat.completion',
                    created: Date.now(),
                    model: 'test-model',
                    choices: [
                        {
                            index: 0,
                            message: { role: 'assistant' as const, content: 'ok' },
                            finish_reason: 'stop',
                        },
                    ],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                };
            }

            return (async function* () {
                // 发送一个初始 chunk，随后一直阻塞直到被上游中止。
                yield {
                    id: 'chunk-1',
                    index: 0,
                    object: 'chat.completion.chunk',
                    created: Date.now(),
                    model: 'test-model',
                    choices: [
                        {
                            index: 0,
                            delta: { role: 'assistant' as const, content: 'partial ' },
                        },
                    ],
                };

                await new Promise<void>((resolve) => {
                    if (options.abortSignal?.aborted) {
                        resolve();
                        return;
                    }
                    options.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
                });
            })();
        },
        getTimeTimeout: () => providerTimeoutMs,
        getLLMMaxTokens: () => 4096,
        getMaxOutputTokens: () => 128,
    };

    return provider as unknown as LLMProvider;
}

describe('Agent requestTimeout behavior', () => {
    const memoryManagers: Array<ReturnType<typeof createMemoryManager>> = [];

    afterEach(async () => {
        for (const memoryManager of memoryManagers) {
            await memoryManager.close();
        }
        memoryManagers.length = 0;
    });

    it('requestTimeout applies per LLM call, total execute time can exceed one timeout', async () => {
        const timeoutMs = 120;
        const provider = createTimeoutThenSuccessProvider(timeoutMs);
        const memoryManager = createMemoryManager({
            type: 'file',
            connectionString: `/tmp/agent-timeout-behavior-${Date.now()}`,
        });
        memoryManagers.push(memoryManager);
        await memoryManager.initialize();

        const agent = new Agent({
            provider,
            systemPrompt: 'test',
            stream: false,
            memoryManager,
            requestTimeout: timeoutMs,
            maxRetries: 1,
        });

        const startedAt = Date.now();
        const message = await agent.execute('hello');
        const elapsedMs = Date.now() - startedAt;

        expect(message.role).toBe('assistant');
        // callCount is not accessible from the closure, but we can verify the behavior
        expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs);
    });

    it('requestTimeout should also cap total duration in streaming mode', async () => {
        const requestTimeoutMs = 120;
        const idleTimeoutMs = 5000;
        const provider = createStalledStreamProvider(10_000);
        const memoryManager = createMemoryManager({
            type: 'file',
            connectionString: `/tmp/agent-timeout-behavior-stream-${Date.now()}`,
        });
        memoryManagers.push(memoryManager);
        await memoryManager.initialize();

        const agent = new Agent({
            provider,
            systemPrompt: 'test',
            stream: true,
            memoryManager,
            requestTimeout: requestTimeoutMs,
            idleTimeout: idleTimeoutMs,
            maxRetries: 0,
        });

        const startedAt = Date.now();
        const result = await agent.executeWithResult('hello');
        const elapsedMs = Date.now() - startedAt;

        expect(result.status).toBe('failed');
        // requestTimeout 应先于 5s idleTimeout 生效。
        expect(elapsedMs).toBeGreaterThanOrEqual(requestTimeoutMs);
        expect(elapsedMs).toBeLessThan(idleTimeoutMs);
    });

    it('idleTimeout: 1000*60*5 should take effect in streaming mode', async () => {
        const idleTimeoutMs = 1000 * 60 * 5;
        const requestTimeoutMs = 120;
        const provider = createStalledStreamProvider(10_000);
        const memoryManager = createMemoryManager({
            type: 'file',
            connectionString: `/tmp/agent-idle-5min-${Date.now()}`,
        });
        memoryManagers.push(memoryManager);
        await memoryManager.initialize();

        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        try {
            const agent = new Agent({
                provider,
                systemPrompt: 'test',
                stream: true,
                memoryManager,
                idleTimeout: idleTimeoutMs,
                requestTimeout: requestTimeoutMs,
                maxRetries: 0,
            });

            const result = await agent.executeWithResult('hello');
            expect(result.status).toBe('failed');
            const timeoutDelays = timeoutSpy.mock.calls
                .map((call) => (typeof call[1] === 'number' ? call[1] : NaN))
                .filter((delay) => Number.isFinite(delay));
            expect(timeoutDelays).toContain(idleTimeoutMs);
        } finally {
            timeoutSpy.mockRestore();
        }
    }, 10000);
});
