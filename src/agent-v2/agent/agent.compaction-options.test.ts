import { describe, expect, it } from 'vitest';
import { Agent } from './agent';
import { ToolRegistry } from '../tool/registry';
import {
    LLMProvider,
    type Chunk,
    type LLMGenerateOptions,
    type LLMRequestMessage,
    type LLMResponse,
} from '../../providers';

class MockProvider extends LLMProvider {
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
        if (options?.stream) {
            return (async function* (): AsyncGenerator<Chunk> {
                yield {
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: 'ok',
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
                        content: 'ok',
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

describe('Agent compaction options', () => {
    it('should allow enabling compaction without explicit compactionConfig', () => {
        const provider = new MockProvider();
        const toolRegistry = new ToolRegistry({ workingDirectory: process.cwd() });

        expect(() => {
            new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'test',
                enableCompaction: true,
                stream: false,
            });
        }).not.toThrow();
    });

    it('should accept partial compactionConfig values', () => {
        const provider = new MockProvider();
        const toolRegistry = new ToolRegistry({ workingDirectory: process.cwd() });

        expect(() => {
            new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'test',
                enableCompaction: true,
                compactionConfig: {
                    keepMessagesNum: 8,
                },
                stream: false,
            });
        }).not.toThrow();
    });
});
