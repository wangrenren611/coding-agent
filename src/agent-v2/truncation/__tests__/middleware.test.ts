/**
 * 截断中间件测试
 */

import { describe, it, expect } from 'vitest';
import { createTruncationMiddleware } from '../middleware';
import { TruncationService } from '../service';
import type { ToolResult } from '../../tool/base';

describe('TruncationMiddleware', () => {
    it('should not modify result when no output', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({ service });

        const result: ToolResult = {
            success: true,
            output: '',
        };

        const modified = await middleware('test', result, { toolName: 'test' });

        expect(modified.output).toBe('');
        expect(modified.metadata?.truncated).toBeUndefined();
    });

    it('should not modify result when already truncated', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({ service });

        const result: ToolResult = {
            success: true,
            output: Array(100).fill('line').join('\n'),
            metadata: { truncated: true }, // already processed
        };

        const modified = await middleware('test', result, { toolName: 'test' });

        // should not call service.output, just return as-is
        expect(modified.metadata?.truncated).toBe(true);
    });

    it('should skip tools in skipTools list', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({
            service,
            skipTools: ['skip_me'],
        });

        const result: ToolResult = {
            success: true,
            output: Array(100).fill('line').join('\n'),
        };

        const modified = await middleware('skip_me', result, { toolName: 'skip_me' });

        expect(modified.metadata?.truncated).toBeUndefined();
    });

    it('should truncate long output', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({ service });

        const result: ToolResult = {
            success: true,
            output: Array(100).fill('line').join('\n'),
        };

        const modified = await middleware('test', result, { toolName: 'test' });

        expect(modified.metadata?.truncated).toBe(true);
        expect(modified.output).toContain('truncated');
    });

    it('should use custom shouldTruncate function', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({
            service,
            shouldTruncate: (toolName, _result) => {
                // only truncate for specific tool
                if (toolName === 'special') {
                    return { maxLines: 2 };
                }
                return false;
            },
        });

        const longOutput = Array(100).fill('line').join('\n');

        // regular tool - should not truncate
        const result1: ToolResult = { success: true, output: longOutput };
        const modified1 = await middleware('regular', result1, { toolName: 'regular' });
        expect(modified1.metadata?.truncated).toBeUndefined();

        // special tool - should truncate with custom limit
        const result2: ToolResult = { success: true, output: longOutput };
        const modified2 = await middleware('special', result2, { toolName: 'special' });
        expect(modified2.metadata?.truncated).toBe(true);
    });

    it('should preserve existing metadata', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({ service });

        const result: ToolResult = {
            success: true,
            output: Array(100).fill('line').join('\n'),
            metadata: { customField: 'value' },
        };

        const modified = await middleware('test', result, { toolName: 'test' });

        expect(modified.metadata?.customField).toBe('value');
        expect(modified.metadata?.truncated).toBe(true);
    });
});
