/**
 * 截断服务测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TruncationService } from '../service';
import { DefaultTruncationStrategy } from '../strategies';
import { TruncationStorage } from '../storage';
import type { TruncationEvent } from '../types';

describe('TruncationService', () => {
    let service: TruncationService;
    let events: TruncationEvent[];

    beforeEach(() => {
        events = [];
        service = new TruncationService({
            global: {
                maxLines: 10,
                maxBytes: 1000,
                direction: 'head',
            },
            onEvent: (event) => events.push(event),
        });
    });

    describe('output', () => {
        it('should not truncate when content is within limits', async () => {
            const content = 'line1\nline2\nline3';
            const result = await service.output(content, { toolName: 'test' });

            expect(result.truncated).toBe(false);
            expect(result.content).toBe(content);
        });

        it('should truncate when content exceeds maxLines', async () => {
            const content = Array(20).fill('line').join('\n');
            const result = await service.output(content, { toolName: 'test' });

            expect(result.truncated).toBe(true);
            expect(result.content).toContain('truncated');
            expect(result.content).toContain('Full output saved to:');
        });

        it('should emit truncated event when truncation occurs', async () => {
            const content = Array(20).fill('line').join('\n');
            await service.output(content, { toolName: 'test' });

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('truncated');
            expect(events[0].toolName).toBe('test');
            expect(events[0].outputPath).toBeDefined();
        });

        it('should emit skipped event when no truncation needed', async () => {
            const content = 'short content';
            await service.output(content, { toolName: 'test' });

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('skipped');
        });

        it('should respect tool-specific config', async () => {
            const customService = new TruncationService({
                global: { maxLines: 100 },
                tools: { bash: { maxLines: 5 } },
            });

            const content = Array(10).fill('line').join('\n');
            const result = await customService.output(content, { toolName: 'bash' });

            expect(result.truncated).toBe(true);
        });

        it('should skip truncation when disabled', async () => {
            const disabledService = new TruncationService({
                global: { enabled: false },
            });

            const content = Array(100).fill('line').join('\n');
            const result = await disabledService.output(content, { toolName: 'test' });

            expect(result.truncated).toBe(false);
        });

        it('should use tail direction correctly', async () => {
            const tailService = new TruncationService({
                global: { maxLines: 3, direction: 'tail' },
            });

            const content = 'line1\nline2\nline3\nline4\nline5';
            const result = await tailService.output(content, { toolName: 'test' });

            expect(result.truncated).toBe(true);
            // tail direction should have truncation message at top
            expect(result.content.indexOf('truncated')).toBeLessThan(result.content.indexOf('line3'));
        });

        it('should allow per-call options override', async () => {
            const content = Array(20).fill('line').join('\n');

            // skip truncation via options
            const result = await service.output(content, {
                toolName: 'test',
                options: { skip: true },
            });

            expect(result.truncated).toBe(false);
        });
    });

    describe('updateConfig', () => {
        it('should update global config', async () => {
            service.updateConfig({ maxLines: 5 });

            const content = Array(10).fill('line').join('\n');
            const result = await service.output(content, { toolName: 'test' });

            expect(result.truncated).toBe(true);
        });
    });

    describe('setToolConfig', () => {
        it('should set tool-specific config', async () => {
            service.setToolConfig('grep', { maxLines: 3 });

            const content = Array(8).fill('line').join('\n');
            const result = await service.output(content, { toolName: 'grep' });

            expect(result.truncated).toBe(true);
        });
    });
});

describe('DefaultTruncationStrategy', () => {
    let strategy: DefaultTruncationStrategy;

    beforeEach(() => {
        strategy = new DefaultTruncationStrategy();
    });

    describe('needsTruncation', () => {
        it('should return false for content within limits', () => {
            const content = 'short content';
            expect(strategy.needsTruncation(content, { maxLines: 100, maxBytes: 10000 } as unknown as TruncationOptions)).toBe(false);
        });

        it('should return true when lines exceed limit', () => {
            const content = Array(200).fill('line').join('\n');
            expect(strategy.needsTruncation(content, { maxLines: 100, maxBytes: 100000 } as unknown as TruncationOptions)).toBe(true);
        });

        it('should return true when bytes exceed limit', () => {
            const content = 'x'.repeat(10000);
            expect(strategy.needsTruncation(content, { maxLines: 100, maxBytes: 1000 } as unknown as TruncationOptions)).toBe(true);
        });
    });

    describe('truncate', () => {
        it('should truncate to maxLines', () => {
            const content = Array(100).fill('line').join('\n');
            const result = strategy.truncate(content, { maxLines: 10, maxBytes: 100000, direction: 'head' } as unknown as TruncationOptions);

            const resultLines = result.content.split('\n');
            expect(resultLines.length).toBe(10);
            expect(result.removedLines).toBe(90);
        });

        it('should respect byte limit', () => {
            const content = 'x'.repeat(10000);
            const result = strategy.truncate(content, { maxLines: 100, maxBytes: 100, direction: 'head' } as unknown as TruncationOptions);

            expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(100);
            expect(result.removedBytes).toBeGreaterThan(0);
        });

        it('should keep head when direction is head', () => {
            const content = 'line1\nline2\nline3\nline4\nline5';
            const result = strategy.truncate(content, { maxLines: 2, maxBytes: 10000, direction: 'head' } as unknown as TruncationOptions);

            expect(result.content).toBe('line1\nline2');
        });

        it('should keep tail when direction is tail', () => {
            const content = 'line1\nline2\nline3\nline4\nline5';
            const result = strategy.truncate(content, { maxLines: 2, maxBytes: 10000, direction: 'tail' } as unknown as TruncationOptions);

            expect(result.content).toBe('line4\nline5');
        });
    });
});

describe('TruncationStorage', () => {
    let storage: TruncationStorage;
    const testDir = '/tmp/truncation-test-' + Date.now();

    beforeEach(() => {
        storage = new TruncationStorage(testDir);
    });

    it('should save and read content', async () => {
        const content = 'test content';
        const path = await storage.save(content, { toolName: 'test' });

        expect(path).toContain('test');
        expect(path).toContain('.txt');

        const read = await storage.read(path);
        expect(read).toBe(content);
    });

    it('should generate unique filenames', async () => {
        const content = 'test content';
        const path1 = await storage.save(content, { toolName: 'test' });
        const path2 = await storage.save(content, { toolName: 'test' });

        expect(path1).not.toBe(path2);
    });

    it('should return storage directory', () => {
        expect(storage.getStorageDir()).toBe(testDir);
    });
});
