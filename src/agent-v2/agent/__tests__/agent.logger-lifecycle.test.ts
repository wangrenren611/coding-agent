import { describe, it, expect } from 'vitest';

import { Agent } from '../agent';
import { createLogger } from '../../logger';
import { LogLevel, type LogRecord } from '../../logger/types';
import type { LLMProvider } from '../../../providers';

class MinimalProvider {
    async generate() {
        return {
            id: 'test-id',
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
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
    }

    getTimeTimeout() {
        return 60000;
    }

    getLLMMaxTokens() {
        return 100000;
    }

    getMaxOutputTokens() {
        return 8000;
    }
}

describe('Agent Logger Lifecycle', () => {
    it('should not close injected logger when agent closes', async () => {
        const records: LogRecord[] = [];
        const injectedLogger = createLogger({
            service: 'test',
            env: 'test',
            level: LogLevel.INFO,
            console: { enabled: false },
            file: { enabled: false, filepath: './tmp.log' },
        });

        injectedLogger.addTransport({
            name: 'capture',
            config: { enabled: true, level: LogLevel.TRACE },
            write: (record) => {
                records.push(record);
            },
        });

        const agent = new Agent({
            provider: new MinimalProvider() as unknown as LLMProvider,
            systemPrompt: 'test',
            logger: injectedLogger,
        });

        await agent.execute('hello');
        await agent.close();

        injectedLogger.info('after-agent-close');
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(records.some((record) => record.message === 'after-agent-close')).toBe(true);

        await injectedLogger.close();
    });
});
