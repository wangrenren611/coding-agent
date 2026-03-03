import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../../providers';
import type { AgentOptions } from '../types';

import { Agent } from '../agent';

class MockProvider {
    async generate(): Promise<{
        id: string;
        object: string;
        created: number;
        model: string;
        choices: Array<{
            index: number;
            message: { role: 'assistant'; content: string };
            finish_reason: 'stop';
        }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }> {
        return {
            id: 'mock-id',
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [
                {
                    index: 0,
                    message: { role: 'assistant', content: 'ok' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
    }

    getTimeTimeout(): number {
        return 60000;
    }

    getLLMMaxTokens(): number {
        return 200000;
    }

    getMaxOutputTokens(): number {
        return 8000;
    }
}

describe('Agent MCP integration', () => {
    it('binds injected mcpManager to tool registry and does not initialize in Agent', async () => {
        const setToolRegistry = vi.fn();
        const initialize = vi.fn();
        const disconnectAll = vi.fn();
        const mcpManager = {
            setToolRegistry,
            initialize,
            disconnectAll,
        } as unknown as NonNullable<AgentOptions['mcpManager']>;
        const agent = new Agent({
            provider: new MockProvider() as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
            mcpManager,
        });

        await agent.initialize();
        await agent.execute('hello');
        await agent.close();

        expect(setToolRegistry).toHaveBeenCalledTimes(1);
        expect(initialize).not.toHaveBeenCalled();
        expect(disconnectAll).not.toHaveBeenCalled();
    });

    it('execute can run without mcpManager', async () => {
        const agent = new Agent({
            provider: new MockProvider() as unknown as LLMProvider,
            systemPrompt: 'test',
            stream: false,
        });

        await expect(agent.execute('hello')).resolves.toBeDefined();
        await agent.close();
    });
});
