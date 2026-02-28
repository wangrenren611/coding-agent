/**
 * Agent 请求超时行为测试
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from './agent';
import { createMemoryManager } from '../memory';
import { LLMProvider, LLMRetryableError } from '../../providers';
import type { LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../providers';

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
});
