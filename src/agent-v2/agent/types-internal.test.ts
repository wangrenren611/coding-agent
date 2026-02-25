import { describe, expect, it } from 'vitest';
import type { LLMResponse } from '../../providers';
import { getResponseContent } from './types-internal';

describe('types-internal getResponseContent', () => {
    it('should return reasoning_content when content is empty', () => {
        const response: LLMResponse = {
            id: 'resp-reasoning-only',
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: '',
                        reasoning_content: 'only reasoning text',
                    },
                    finish_reason: 'stop',
                },
            ],
        };

        expect(getResponseContent(response)).toBe('only reasoning text');
    });
});
