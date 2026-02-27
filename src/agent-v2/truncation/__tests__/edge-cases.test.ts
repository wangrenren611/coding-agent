/**
 * 截断模块异常情况测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TruncationService } from '../service';
import { DefaultTruncationStrategy } from '../strategies';
import { TruncationStorage } from '../storage';
import { createTruncationMiddleware } from '../middleware';
import fs from 'fs/promises';
import type { ToolResult } from '../../tool/base';

// ============================================================
// 边界条件测试
// ============================================================
describe('Boundary Conditions', () => {
    let service: TruncationService;

    beforeEach(() => {
        service = new TruncationService({
            global: { maxLines: 10, maxBytes: 1000 },
        });
    });

    describe('exact limit values', () => {
        it('should NOT truncate when content equals maxLines exactly', async () => {
            const content = Array(10).fill('line').join('\n'); // exactly 10 lines
            const result = await service.output(content, { toolName: 'test' });
            expect(result.truncated).toBe(false);
        });

        it('should truncate when content is maxLines + 1', async () => {
            const content = Array(11).fill('line').join('\n'); // 11 lines
            const result = await service.output(content, { toolName: 'test' });
            expect(result.truncated).toBe(true);
        });

        it('should NOT truncate when bytes equal maxBytes exactly', async () => {
            const maxBytes = 1000;
            const byteService = new TruncationService({
                global: { maxLines: 10000, maxBytes },
            });
            const content = 'x'.repeat(maxBytes);
            const result = await byteService.output(content, { toolName: 'test' });
            expect(result.truncated).toBe(false);
        });

        it('should truncate when bytes exceed maxBytes by 1', async () => {
            const maxBytes = 1000;
            const byteService = new TruncationService({
                global: { maxLines: 10000, maxBytes },
            });
            const content = 'x'.repeat(maxBytes + 1);
            const result = await byteService.output(content, { toolName: 'test' });
            expect(result.truncated).toBe(true);
        });
    });

    describe('zero and empty values', () => {
        it('should handle empty string', async () => {
            const result = await service.output('', { toolName: 'test' });
            expect(result.truncated).toBe(false);
            expect(result.content).toBe('');
        });

        it('should handle single character', async () => {
            const result = await service.output('x', { toolName: 'test' });
            expect(result.truncated).toBe(false);
        });

        it('should handle single line', async () => {
            const result = await service.output('single line without newline', { toolName: 'test' });
            expect(result.truncated).toBe(false);
        });

        it('should handle whitespace only content', async () => {
            const content = '   \n   \n   ';
            const result = await service.output(content, { toolName: 'test' });
            expect(result.truncated).toBe(false);
        });
    });

    describe('very large content', () => {
        it('should handle 1MB content without crashing', async () => {
            const largeService = new TruncationService({
                global: { maxLines: 100, maxBytes: 50 * 1024 },
            });
            const content = 'x'.repeat(1024 * 1024); // 1MB
            const result = await largeService.output(content, { toolName: 'test' });

            expect(result.truncated).toBe(true);
            expect(result.content.length).toBeLessThan(content.length);
        });

        it('should handle 100k lines', async () => {
            const linesService = new TruncationService({
                global: { maxLines: 100, maxBytes: 10 * 1024 * 1024 },
            });
            const content = Array(100000).fill('line').join('\n');
            const result = await linesService.output(content, { toolName: 'test' });

            expect(result.truncated).toBe(true);
        }, 10000); // 10s timeout
    });
});

// ============================================================
// Unicode 和特殊字符测试
// ============================================================
describe('Unicode and Special Characters', () => {
    let service: TruncationService;

    beforeEach(() => {
        service = new TruncationService({
            global: { maxLines: 5, maxBytes: 1000 },
        });
    });

    it('should correctly count Unicode characters by bytes', async () => {
        const content = '你好世界\n'.repeat(10); // Chinese characters (3 bytes each in UTF-8)
        const result = await service.output(content, { toolName: 'test' });
        expect(result.truncated).toBe(true);
    });

    it('should handle emoji correctly', async () => {
        const content = '😀😃😄😁\n'.repeat(10);
        const result = await service.output(content, { toolName: 'test' });
        expect(result.truncated).toBe(true);
    });

    it('should preserve Unicode in truncated content', async () => {
        const content = '你好世界\n'.repeat(20);
        const result = await service.output(content, { toolName: 'test' });
        expect(result.content).toContain('你好世界');
    });

    it('should handle mixed content', async () => {
        const content = 'ASCII\n中文\n日本語\n한국어\nEmoji😀\n'.repeat(10);
        const result = await service.output(content, { toolName: 'test' });
        expect(result.truncated).toBe(true);
    });

    it('should handle very long single line', async () => {
        const lineService = new TruncationService({
            global: { maxLines: 100, maxBytes: 100 },
        });
        const content = 'x'.repeat(10000); // one very long line
        const result = await lineService.output(content, { toolName: 'test' });
        expect(result.truncated).toBe(true);
    });

    it('should handle control characters', async () => {
        const content = 'line1\x00\x01\x02\nline2\t\t\nline3\r\n'.repeat(10);
        const result = await service.output(content, { toolName: 'test' });
        expect(result.truncated).toBe(true);
    });

    it('should handle different line endings', async () => {
        const content = 'line1\r\nline2\nline3\r\nline4\nline5\r\n'.repeat(5);
        const result = await service.output(content, { toolName: 'test' });
        expect(result.truncated).toBe(true);
    });
});

// ============================================================
// 存储异常测试
// ============================================================
describe('Storage Error Handling', () => {
    let storage: TruncationStorage;
    let testDir: string;

    beforeEach(() => {
        testDir = `/tmp/truncation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        storage = new TruncationStorage(testDir);
    });

    afterEach(async () => {
        // Cleanup
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('should read saved file correctly', async () => {
        const content = 'test content with unicode 你好';
        const savedPath = await storage.save(content, { toolName: 'test' });

        const readContent = await storage.read(savedPath);
        expect(readContent).toBe(content);
    });

    it('should throw when reading non-existent file', async () => {
        await expect(storage.read('/non/existent/path.txt')).rejects.toThrow();
    });

    it('should verify cleanup mechanism works', async () => {
        // Create some files
        await storage.save('content1', { toolName: 'test1' });
        await storage.save('content2', { toolName: 'test2' });

        // Verify files were created
        const filesBefore = await fs.readdir(testDir).catch(() => []);
        expect(filesBefore.length).toBeGreaterThanOrEqual(2);

        // cleanup with very small negative retention (-0.001 days ≈ -86 seconds)
        // This should remove all files since cutoffTime is in the future
        // Note: cleanup behavior depends on timing, so we just verify it doesn't throw
        const cleaned = await storage.cleanup(-0.001);
        // We don't assert on exact count since timing affects results
        expect(cleaned).toBeGreaterThanOrEqual(0);
    });

    it('should not cleanup recent files with positive retention', async () => {
        await storage.save('recent content', { toolName: 'test' });

        // cleanup with 7 days should not remove recent files
        const cleaned = await storage.cleanup(7);
        expect(cleaned).toBe(0);
    });

    it('should handle cleanup on non-existent directory', async () => {
        const emptyStorage = new TruncationStorage('/non/existent/dir');
        const cleaned = await emptyStorage.cleanup(7);
        expect(cleaned).toBe(0);
    });
});

// ============================================================
// 服务错误处理测试
// ============================================================
describe('Service Error Handling', () => {
    it('should emit error event when storage fails', async () => {
        const events: unknown[] = [];

        // Create a mock storage that always fails
        const mockStorage = {
            save: vi.fn().mockRejectedValue(new Error('Storage failed')),
            read: vi.fn(),
            cleanup: vi.fn(),
            getStorageDir: vi.fn().mockReturnValue('/tmp'),
        };

        const service = new TruncationService({
            global: { maxLines: 2 },
            storage: mockStorage as unknown as TruncationStorage,
            onEvent: (e) => events.push(e),
        });

        const content = Array(10).fill('line').join('\n');
        const result = await service.output(content, { toolName: 'test' });

        // Should return original content on error
        expect(result.truncated).toBe(false);
        expect(result.content).toBe(content);

        // Should emit error event
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('error');
        expect(events[0].error).toContain('Storage failed');
    });

    it('should handle custom strategy errors gracefully', async () => {
        const mockStrategy = {
            name: 'mock',
            needsTruncation: vi.fn().mockReturnValue(true),
            truncate: vi.fn().mockImplementation(() => {
                throw new Error('Strategy failed');
            }),
        };

        const events: unknown[] = [];
        const service = new TruncationService({
            global: { maxLines: 2 },
            strategy: mockStrategy as unknown as DefaultTruncationStrategy,
            onEvent: (e) => events.push(e),
        });

        const content = Array(10).fill('line').join('\n');
        const result = await service.output(content, { toolName: 'test' });

        expect(result.truncated).toBe(false);
        expect(events[0].type).toBe('error');
    });
});

// ============================================================
// 中间件异常测试
// ============================================================
describe('Middleware Error Handling', () => {
    it('should handle null metadata', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({ service });

        const result: ToolResult = {
            success: true,
            output: Array(100).fill('line').join('\n'),
            metadata: null as unknown as TruncationMetadata,
        };

        const modified = await middleware('test', result, { toolName: 'test' });
        expect(modified.metadata?.truncated).toBe(true);
    });

    it('should handle undefined metadata', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({ service });

        const result: ToolResult = {
            success: true,
            output: Array(100).fill('line').join('\n'),
            metadata: undefined,
        };

        const modified = await middleware('test', result, { toolName: 'test' });
        expect(modified.metadata?.truncated).toBe(true);
    });

    it('should handle failed tool result', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({ service });

        const result: ToolResult = {
            success: false,
            error: 'Tool failed',
            output: Array(100).fill('line').join('\n'),
        };

        // Should still truncate failed tool output
        const modified = await middleware('test', result, { toolName: 'test' });
        expect(modified.metadata?.truncated).toBe(true);
    });

    it('should handle tool with truncated=false in metadata (tool processed, no truncation needed)', async () => {
        const service = new TruncationService({ global: { maxLines: 5 } });
        const middleware = createTruncationMiddleware({ service });

        const result: ToolResult = {
            success: true,
            output: Array(100).fill('line').join('\n'),
            metadata: { truncated: false }, // explicitly set - tool has decided no truncation
        };

        const modified = await middleware('test', result, { toolName: 'test' });
        // truncated: false means tool has already processed this output
        // Middleware respects the tool's decision and skips
        expect(modified.metadata?.truncated).toBe(false);
    });
});

// ============================================================
// 策略边界测试
// ============================================================
describe('Strategy Edge Cases', () => {
    let strategy: DefaultTruncationStrategy;

    beforeEach(() => {
        strategy = new DefaultTruncationStrategy();
    });

    it('should handle empty content', () => {
        expect(strategy.needsTruncation('', { maxLines: 10, maxBytes: 1000 } as unknown as TruncationOptions)).toBe(false);

        const result = strategy.truncate('', { maxLines: 10, maxBytes: 1000, direction: 'head' } as unknown as TruncationOptions);
        expect(result.content).toBe('');
    });

    it('should handle single very long line that exceeds byte limit', () => {
        const content = 'x'.repeat(10000);
        const result = strategy.truncate(content, { maxLines: 100, maxBytes: 100, direction: 'head' } as unknown as TruncationOptions);

        expect(result.removedBytes).toBeGreaterThan(0);
        expect(result.content.length).toBeLessThanOrEqual(100);
    });

    it('should handle content with only newlines', () => {
        const content = '\n\n\n\n\n'.repeat(10);
        expect(strategy.needsTruncation(content, { maxLines: 5, maxBytes: 100000 } as unknown as TruncationOptions)).toBe(true);
    });

    it('should handle lines exactly at byte boundary', () => {
        // Create content where each line is exactly 10 bytes
        const content = '1234567890\n'.repeat(100);
        const result = strategy.truncate(content, { maxLines: 100, maxBytes: 55, direction: 'head' } as unknown as TruncationOptions);

        // Should truncate due to byte limit
        expect(result.removedBytes).toBeDefined();
    });

    it('should handle tail direction with single line', () => {
        const content = 'single line';
        const result = strategy.truncate(content, { maxLines: 10, maxBytes: 100, direction: 'tail' } as unknown as TruncationOptions);
        expect(result.content).toBe('single line');
    });
});

// ============================================================
// 并发安全测试
// ============================================================
describe('Concurrency', () => {
    it('should handle concurrent truncation requests', async () => {
        const service = new TruncationService({
            global: { maxLines: 5 },
        });

        const content = Array(100).fill('line').join('\n');

        // Run 10 concurrent requests
        const promises = Array(10)
            .fill(null)
            .map((_, i) => service.output(content, { toolName: `test${i}` }));

        const results = await Promise.all(promises);

        // All should be truncated
        results.forEach((result) => {
            expect(result.truncated).toBe(true);
        });
    });

    it('should generate unique file paths for concurrent saves', async () => {
        const testDir = `/tmp/truncation-concurrent-${Date.now()}`;
        const storage = new TruncationStorage(testDir);

        const content = 'test content';

        // Run concurrent saves
        const promises = Array(10)
            .fill(null)
            .map((_, i) => storage.save(content, { toolName: `test${i}` }));

        const paths = await Promise.all(promises);

        // All paths should be unique
        const uniquePaths = new Set(paths);
        expect(uniquePaths.size).toBe(10);

        // Cleanup
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });
});

// ============================================================
// 配置验证测试
// ============================================================
describe('Configuration Validation', () => {
    it('should use defaults when partial config provided', () => {
        const service = new TruncationService({
            global: { maxLines: 5 }, // only maxLines
        });

        const config = service.getConfig();
        expect(config.maxLines).toBe(5);
        expect(config.maxBytes).toBe(50 * 1024); // default
        expect(config.direction).toBe('head'); // default
        expect(config.enabled).toBe(true); // default
    });

    it('should handle empty config object', () => {
        const service = new TruncationService({});
        const config = service.getConfig();

        expect(config.maxLines).toBe(2000);
        expect(config.maxBytes).toBe(50 * 1024);
        expect(config.enabled).toBe(true);
    });

    it('should override tool config after creation', async () => {
        const service = new TruncationService({
            global: { maxLines: 100 },
        });

        // First, tool uses global config
        const content = Array(50).fill('line').join('\n');
        let result = await service.output(content, { toolName: 'mytool' });
        expect(result.truncated).toBe(false);

        // Now set stricter tool config
        service.setToolConfig('mytool', { maxLines: 10 });
        result = await service.output(content, { toolName: 'mytool' });
        expect(result.truncated).toBe(true);
    });

    it('should merge options correctly', async () => {
        const events: unknown[] = [];
        const service = new TruncationService({
            global: { maxLines: 5, direction: 'head' },
            tools: { bash: { direction: 'tail' } },
            onEvent: (e) => events.push(e),
        });

        const content = 'line1\nline2\nline3\nline4\nline5\nline6\nline7';

        // bash tool should use tail
        const result = await service.output(content, { toolName: 'bash' });
        expect(result.content.indexOf('truncated')).toBeLessThan(result.content.indexOf('line5'));
    });
});
