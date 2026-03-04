import { describe, expect, it } from 'vitest';

import {
    LLMProvider,
    type Chunk,
    type LLMGenerateOptions,
    type LLMRequestMessage,
    type LLMResponse,
} from '../../../providers';
import { ToolRegistry } from '../../tool/registry';
import { Agent } from '../agent';

class PromptCacheMockProvider extends LLMProvider {
    public calls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }> = [];

    constructor() {
        super({
            apiKey: 'mock',
            baseURL: 'https://mock.local',
            model: 'base-model',
            max_tokens: 1024,
            LLMMAX_TOKENS: 8192,
            temperature: 0,
        });
    }

    generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
        this.calls.push({
            messages: [...messages],
            options: options ? { ...options } : undefined,
        });

        return Promise.resolve({
            id: `mock-${this.calls.length}`,
            object: 'chat.completion',
            created: Date.now(),
            model: 'base-model',
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

describe('Agent prompt cache v2.1', () => {
    it('should inject dynamic system reminder via user message instead of mutating system prompt', async () => {
        const provider = new PromptCacheMockProvider();
        const toolRegistry = new ToolRegistry({ workingDirectory: process.cwd() });
        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'system prompt',
            promptCache: {
                systemReminderProvider: () => '现在是周三',
            },
        });

        await agent.execute('hello');

        const firstCall = provider.calls[0];
        expect(firstCall).toBeDefined();
        const reminderMessage = firstCall.messages.find(
            (msg) =>
                msg.role === 'user' &&
                typeof msg.content === 'string' &&
                msg.content.includes('<system-reminder>') &&
                msg.content.includes('现在是周三')
        );
        expect(reminderMessage).toBeDefined();
    });

    it('should block in-session model switch when model affinity is enforced in long session', async () => {
        const provider = new PromptCacheMockProvider();
        const toolRegistry = new ToolRegistry({ workingDirectory: process.cwd() });
        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'system prompt',
            promptCache: {
                enforceModelAffinity: true,
            },
        });

        for (let i = 0; i < 5; i += 1) {
            await agent.execute(`turn-${i}`);
        }
        await agent.execute('switch-model', { model: 'haiku-model' });

        const lastCall = provider.calls[provider.calls.length - 1];
        expect(lastCall.options?.model).toBeUndefined();
    });
});
