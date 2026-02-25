import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from './agent';
import { createMemoryManager } from '../memory';
import { LLMProvider, LLMRetryableError } from '../../providers';
import type { Chunk, LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../providers';

class TimeoutThenSuccessProvider extends LLMProvider {
    private readonly timeoutMs: number;
    callCount = 0;

    constructor(timeoutMs: number) {
        super({
            apiKey: 'test-key',
            baseURL: 'https://example.test',
            model: 'test-model',
            max_tokens: 128,
            LLMMAX_TOKENS: 4096,
            temperature: 0,
            timeout: timeoutMs,
        });
        this.timeoutMs = timeoutMs;
    }

    async generate(
        _messages: LLMRequestMessage[],
        _options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
        this.callCount++;

        if (this.callCount === 1) {
            throw new LLMRetryableError(`Request timeout after ${this.timeoutMs}ms`, this.timeoutMs, 'TIMEOUT');
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
                        role: 'assistant',
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
    }

    getTimeTimeout(): number {
        return this.timeoutMs;
    }

    getLLMMaxTokens(): number {
        return 4096;
    }

    getMaxOutputTokens(): number {
        return 128;
    }
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
        const provider = new TimeoutThenSuccessProvider(timeoutMs);
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
        expect(provider.callCount).toBe(2);
        expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs);
    });
});
