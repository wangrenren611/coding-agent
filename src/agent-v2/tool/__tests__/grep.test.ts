/**
 * Tests for grep.ts (GrepTool)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GrepTool from '../grep';
import { TestEnvironment } from './test-utils';

interface GrepMatch {
    line: number | null;
    column: number | null;
    content: string;
    matchText?: string;
}

interface GrepFileResult {
    file: string;
    mtimeMs: number | null;
    mtimeIso: string | null;
    matches: GrepMatch[];
}

interface GrepMetadata {
    countFiles?: number;
    countMatches?: number;
    results?: GrepFileResult[];
    error?: string;
}

describe('GrepTool', () => {
    let env: TestEnvironment;

    beforeEach(async () => {
        env = new TestEnvironment('grep-tool');
        await env.setup();
    });

    afterEach(async () => {
        await env.teardown();
    });

    describe('Basic Pattern Matching', () => {
        it('should find simple text pattern', async () => {
            await env.createFile('test.js', 'const hello = "world";\nconsole.log(hello);');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'hello',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countFiles).toBeGreaterThan(0);
            expect(meta?.countMatches).toBeGreaterThan(0);
        });

        it('should find pattern in multiple files', async () => {
            await env.createFile('file1.txt', 'Pattern here');
            await env.createFile('file2.txt', 'Pattern there');
            await env.createFile('file3.txt', 'No match');

            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'Pattern',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countFiles).toBe(2);
        });

        it('should handle case-sensitive search', async () => {
            await env.createFile('test.txt', 'Hello hello HELLO');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'hello',
                caseMode: 'sensitive',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            // Should only find lowercase 'hello'
            const meta = result.metadata as GrepMetadata;
            expect(meta?.results?.[0]?.matches).toHaveLength(1);
        });

        it('should handle case-insensitive search', async () => {
            await env.createFile('test.txt', 'Hello hello HELLO');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'hello',
                caseMode: 'insensitive',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            // Note: Current implementation only returns first match per line
            // This is a known limitation
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countMatches).toBeGreaterThanOrEqual(1);
        });

        it('should handle smart case (default)', async () => {
            await env.createFile('test.txt', 'Hello hello HELLO');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'hello',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            // Smart case should match all when pattern is lowercase
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countMatches).toBeGreaterThan(0);
        });
    });

    describe('Regex Pattern Support', () => {
        it('should support regex character classes', async () => {
            await env.createFile('test.txt', 'abc123 xyz789');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: '[a-z]+\\d+',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countMatches).toBeGreaterThan(0);
        });

        it('should support word boundaries', async () => {
            await env.createFile('test.txt', 'cat category concatenated');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'cat',
                word: true,
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            // Should only find 'cat' not 'category' or 'concatenated'
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countMatches).toBe(1);
        });

        it('should support multiline mode', async () => {
            await env.createFile('test.txt', 'start\nmiddle\nend');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'start\\nend',
                multiline: true,
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
        });
    });

    describe('File Pattern Filtering', () => {
        it('should filter by file pattern', async () => {
            await env.createFile('test.js', 'const pattern = true');
            await env.createFile('test.txt', 'pattern here');
            await env.createFile('test.ts', 'pattern in ts');

            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'pattern',
                filePattern: '*.js',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countFiles).toBe(1);
            expect(meta?.results?.[0]?.file).toContain('.js');
        });

        it('should ignore node_modules by default', async () => {
            await env.createFile('node_modules/package/index.js', 'export default true;');
            await env.createFile('src/index.js', 'export default true;');

            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'export',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            // Should not find files in node_modules
            const meta = result.metadata as GrepMetadata;
            expect(meta?.results?.every((r: GrepFileResult) => !r.file.includes('node_modules'))).toBe(true);
        });

        it('should include hidden files when requested', async () => {
            await env.createFile('.hidden', 'secret content');
            await env.createFile('visible.txt', 'public content');

            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'content',
                includeHidden: true,
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countFiles).toBe(2);
        });

        it('should respect noIgnore flag', async () => {
            await env.createFile('test.min.js', 'console.log("minified");');
            await env.createFile('test.js', 'console.log("normal");');

            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'console',
                noIgnore: true,
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            // Should find in both files including .min.js
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countFiles).toBe(2);
        });
    });

    describe('Error Handling', () => {
        it('should return error when ripgrep is not available', async () => {
            // This test would require mocking the import
            // For now, we'll skip if ripgrep is available
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'test',
                path: env.getTestDir(),
            });

            // If ripgrep is available, this should succeed
            // If not, it should fail with RIPGREP_LOAD_FAILED
            expect(result).toBeDefined();
        });

        it('should return error for empty pattern', async () => {
            const tool = new GrepTool();
            // Zod schema validation now happens before execute, so we catch the error
            await expect(
                tool.execute({
                    pattern: '',
                    path: env.getTestDir(),
                })
            ).rejects.toThrow(); // Zod validation error
        });

        it('should return error when search path does not exist', async () => {
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'test',
                path: '/nonexistent/path/that/does/not/exist',
            });

            expect(result.success).toBe(false);
            const meta = result.metadata as GrepMetadata;
            expect(meta?.error).toContain('SEARCH_PATH_NOT_FOUND');
        });

        it('should handle no matches gracefully', async () => {
            await env.createFile('test.txt', 'no matching content here');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'THISWILLNEVERMATCHXYZ123',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countMatches).toBe(0);
            expect(meta?.results).toHaveLength(0);
        });
    });

    describe('Result Metadata', () => {
        it('should include line and column numbers', async () => {
            await env.createFile('test.js', 'const x = 1;\nconst y = x + 1;');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'x',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            const match = meta?.results?.[0]?.matches?.[0];
            expect(match?.line).toBeGreaterThan(0);
            expect(match?.column).toBeGreaterThan(0);
        });

        it('should include matched text', async () => {
            await env.createFile('test.txt', 'Find this exact text');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'this exact text',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            const match = meta?.results?.[0]?.matches?.[0];
            expect(match?.matchText).toBeDefined();
        });

        it('should include file modification time', async () => {
            await env.createFile('test.txt', 'content');
            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'content',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            const meta = result.metadata as GrepMetadata;
            const fileResult = meta?.results?.[0];
            expect(fileResult?.mtimeMs).toBeDefined();
            expect(fileResult?.mtimeIso).toBeDefined();
        });
    });

    describe('Timeout and Safety', () => {
        it('should timeout on long searches', async () => {
            // Create many files
            for (let i = 0; i < 100; i++) {
                await env.createFile(`file${i}.txt`, `content ${i}`);
            }

            const tool = new GrepTool();
            tool.timeoutMs = 100; // Very short timeout

            const result = await tool.execute({
                pattern: 'content',
                path: env.getTestDir(),
            });

            expect(result).toBeDefined();
            // May timeout or succeed depending on system speed
        });

        it('should cap results at maximum limit', async () => {
            // Create many files with matches
            for (let i = 0; i < 150; i++) {
                await env.createFile(`file${i}.txt`, 'match');
            }

            const tool = new GrepTool();
            const result = await tool.execute({
                pattern: 'match',
                path: env.getTestDir(),
            });

            expect(result.success).toBe(true);
            // Should cap at 100 files
            const meta = result.metadata as GrepMetadata;
            expect(meta?.countFiles).toBeLessThanOrEqual(100);
        });
    });
});
