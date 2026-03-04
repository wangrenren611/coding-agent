import { describe, expect, it } from 'vitest';

import type { Tool } from '../../../../providers';
import type { Message } from '../../../session/types';
import { PromptCacheMonitorV2, normalizeToolsForPromptCacheV2 } from '../prompt-cache';

function createSystemMessage(content: string): Message {
    return {
        messageId: 'system',
        role: 'system',
        content,
    };
}

describe('prompt-cache v2', () => {
    it('should normalize and sort tools deterministically', () => {
        const tools: Tool[] = [
            {
                type: 'function',
                function: {
                    name: 'write_file',
                    description: 'write file',
                    parameters: {
                        z: 1,
                        a: {
                            c: true,
                            b: false,
                        },
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'bash',
                    description: 'run shell',
                    parameters: {
                        b: '2',
                        a: '1',
                    },
                },
            },
        ];

        const normalized = normalizeToolsForPromptCacheV2(tools);
        expect(normalized.map((tool) => tool.function.name)).toEqual(['bash', 'write_file']);
        expect(Object.keys(normalized[0].function.parameters)).toEqual(['a', 'b']);
        expect(Object.keys(normalized[1].function.parameters)).toEqual(['a', 'z']);
        expect(Object.keys(normalized[1].function.parameters.a as Record<string, unknown>)).toEqual(['b', 'c']);
    });

    it('should track prefix changes by system+tools prefix hash', () => {
        const monitor = new PromptCacheMonitorV2();
        const tools: Tool[] = [
            {
                type: 'function',
                function: {
                    name: 'bash',
                    description: 'run shell',
                    parameters: { cmd: { type: 'string' } },
                },
            },
        ];

        const baseMessages: Message[] = [
            createSystemMessage('system-v1'),
            { messageId: 'u-1', role: 'user', content: 'hello' },
        ];

        const first = monitor.prepare('model-a', baseMessages, tools);
        expect(first.prefixChanged).toBe(false);
        expect(first.prefixChurnRate).toBe(0);

        const second = monitor.prepare('model-a', baseMessages, tools);
        expect(second.prefixChanged).toBe(false);
        expect(second.prefixChurnRate).toBe(0);

        const third = monitor.prepare(
            'model-a',
            [createSystemMessage('system-v2'), { messageId: 'u-1', role: 'user', content: 'hello' }],
            tools
        );
        expect(third.prefixChanged).toBe(true);
        expect(third.prefixChurnRate).toBe(0.5);
    });

    it('should accumulate cache hit/miss usage and compute weighted hit rate', () => {
        const monitor = new PromptCacheMonitorV2();
        const tools: Tool[] = [];
        const messages: Message[] = [createSystemMessage('system')];

        monitor.prepare('model-a', messages, tools);
        monitor.recordUsage({
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_cache_hit_tokens: 60,
            prompt_cache_miss_tokens: 40,
        });

        monitor.prepare('model-a', messages, tools);
        const snapshot = monitor.recordUsage({
            prompt_tokens: 80,
            completion_tokens: 10,
            total_tokens: 90,
            prompt_cache_hit_tokens: 20,
            prompt_cache_miss_tokens: 60,
        });

        expect(snapshot.promptTokensTotal).toBe(180);
        expect(snapshot.promptCacheHitTokensTotal).toBe(80);
        expect(snapshot.promptCacheMissTokensTotal).toBe(100);
        expect(snapshot.promptCacheHitRate).toBeCloseTo(80 / 180, 8);
    });
});
