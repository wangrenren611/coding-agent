import { describe, expect, it } from 'vitest';
import { Agent } from '../agent';
import {
    LLMProvider,
    type Chunk,
    type LLMGenerateOptions,
    type LLMRequestMessage,
    type LLMResponse,
} from '../../../providers';

class MockToolStreamProvider extends LLMProvider {
    public lastOptions?: LLMGenerateOptions;

    constructor() {
        super({
            apiKey: 'mock',
            baseURL: 'https://mock.local',
            model: 'mock-model',
            max_tokens: 1024,
            LLMMAX_TOKENS: 8192,
            temperature: 0,
        });
    }

    generate(
        _messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
        this.lastOptions = options;

        if (options?.stream) {
            return (async function* (): AsyncGenerator<Chunk> {
                yield {
                    id: 'chunk-1',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: 'tool stream response',
                            },
                        },
                    ],
                };
                yield {
                    id: 'chunk-2',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                            },
                            finish_reason: 'stop',
                        },
                    ],
                };
            })();
        }

        return Promise.resolve({
            id: 'mock-id',
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'non-stream response',
                    },
                    finish_reason: 'stop',
                },
            ],
        });
    }

    getTimeTimeout(): number {
        return 30000;
    }

    getLLMMaxTokens(): number {
        return 8192;
    }

    getMaxOutputTokens(): number {
        return 1024;
    }
}

describe('Agent tool_stream option', () => {
    it('should pass tool_stream as independent option', async () => {
        const provider = new MockToolStreamProvider();
        const agent = new Agent({
            provider,
            systemPrompt: 'test',
            stream: false,
        });

        const message = await agent.execute('hello', { tool_stream: true });

        expect(provider.lastOptions?.tool_stream).toBe(true);
        expect(provider.lastOptions?.stream).toBe(false);
        expect(message.content).toBe('non-stream response');
    });
});
