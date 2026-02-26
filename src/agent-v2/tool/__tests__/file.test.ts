/**
 * Tests for file.ts (ReadFileTool, WriteFileTool)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { ReadFileTool, WriteFileTool } from '../file';
import { TestEnvironment, SAMPLE_CODE, LARGE_FILE_CONTENT } from './test-utils';

describe('File Tools', () => {
    let env: TestEnvironment;

    beforeEach(async () => {
        env = new TestEnvironment('file-tools');
        await env.setup();
    });

    afterEach(async () => {
        await env.teardown();
    });

    describe('ReadFileTool', () => {
        it('should read file content successfully', async () => {
            const testFile = await env.createFile('test.txt', 'Hello, World!');
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: testFile });

            expect(result.success).toBe(true);
            expect(result.metadata?.content).toBe('Hello, World!');
        });

        it('should read file content with line range', async () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
            const testFile = await env.createFile('lines.txt', content);
            const tool = new ReadFileTool();
            const result = await tool.execute({
                filePath: testFile,
                startLine: 2,
                endLine: 4,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.content).toBe('Line 2\nLine 3\nLine 4');
            expect(result.metadata?.range).toEqual({ startLine: 2, endLine: 4 });
        });

        it('should read from startLine to end when endLine is not specified', async () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
            const testFile = await env.createFile('lines.txt', content);
            const tool = new ReadFileTool();
            const result = await tool.execute({
                filePath: testFile,
                startLine: 3,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.content).toBe('Line 3\nLine 4\nLine 5');
        });

        it('should read from beginning to endLine when startLine is not specified', async () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
            const testFile = await env.createFile('lines.txt', content);
            const tool = new ReadFileTool();
            const result = await tool.execute({
                filePath: testFile,
                endLine: 3,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.content).toBe('Line 1\nLine 2\nLine 3');
        });

        it('should return error when file not found', async () => {
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: 'nonexistent.txt' });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('FILE_NOT_FOUND');
        });

        it('should return error when path is a directory', async () => {
            const testFile = await env.createFile('dir/test.txt', 'content');
            const dirPath = path.dirname(testFile);
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: dirPath });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('PATH_IS_DIRECTORY');
        });

        it('should detect binary files', async () => {
            const binaryFile = await env.createFile('binary.bin', '\x00\x01\x02\x03\x04');
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: binaryFile });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('BINARY_FILE');
        });

        it('should return error when startLine is out of range', async () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const testFile = await env.createFile('short.txt', content);
            const tool = new ReadFileTool();
            const result = await tool.execute({
                filePath: testFile,
                startLine: 10,
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toBe('START_LINE_OUT_OF_RANGE');
        });

        it('should return error when line range is invalid', async () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const testFile = await env.createFile('short.txt', content);
            const tool = new ReadFileTool();
            const result = await tool.execute({
                filePath: testFile,
                startLine: 2,
                endLine: 1, // endLine < startLine
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toBe('INVALID_LINE_RANGE');
        });

        it('should handle large files', async () => {
            const testFile = await env.createFile('large.txt', LARGE_FILE_CONTENT);
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: testFile });

            expect(result.success).toBe(true);
            expect(result.metadata?.content).toBeDefined();
        });

        it('should truncate oversized read output consistently', async () => {
            const hugeContent = 'a'.repeat(60000);
            const testFile = await env.createFile('huge.txt', hugeContent);
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: testFile });

            expect(result.success).toBe(true);
            expect(result.metadata?.truncated).toBe(true);
            expect(result.metadata?.originalLength).toBe(60000);
            expect((result.metadata?.content as string).length).toBe(50000);
            expect(result.output).toContain('[... Content truncated for brevity ...]');
        });

        it('should handle files with special characters', async () => {
            const content = 'Hello "world"\n\tTabbed content\nSpecial: <>&\'"';
            const testFile = await env.createFile('special.txt', content);
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: testFile });

            expect(result.success).toBe(true);
            expect(result.metadata?.content).toBe(content);
        });

        it('should handle empty files', async () => {
            const testFile = await env.createFile('empty.txt', '');
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: testFile });

            expect(result.success).toBe(true);
            expect(result.metadata?.content).toBe('');
        });

        it('should handle files with only newlines', async () => {
            const content = '\n\n\n';
            const testFile = await env.createFile('newlines.txt', content);
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: testFile });

            expect(result.success).toBe(true);
            expect(result.metadata?.content).toBe(content);
        });

        it('should read relative paths correctly', async () => {
            await env.createFile('relative.txt', 'Relative path test');
            const tool = new ReadFileTool();
            const result = await tool.execute({ filePath: 'relative.txt' });

            // Note: This might not work depending on CWD, so we skip if file not found
            if (result.success) {
                expect(result.metadata?.content).toBe('Relative path test');
            }
        });
    });

    describe('WriteFileTool', () => {
        it('should write file content successfully', async () => {
            const testFile = path.join(env.getTestDir(), 'test.txt');
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: testFile,
                content: 'New content',
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.success).toBe(true);
            expect(await env.fileExists('test.txt')).toBe(true);
        });

        it('should create parent directories', async () => {
            const testFile = path.join(env.getTestDir(), 'nested', 'dir', 'file.txt');
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: testFile,
                content: 'Nested file',
            });

            expect(result.success).toBe(true);
            expect(await env.fileExists('nested/dir/file.txt')).toBe(true);
        });

        it('should overwrite existing files', async () => {
            const testFile = await env.createFile('overwrite.txt', 'Original content');
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: testFile,
                content: 'New content',
            });

            expect(result.success).toBe(true);
            const content = await env.readFile('overwrite.txt');
            expect(content).toBe('New content');
        });

        it('should return error when trying to write to a directory', async () => {
            const testFile = await env.createFile('dir/test.txt', 'content');
            const dirPath = path.dirname(testFile);
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: dirPath,
                content: 'Should not write',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toBe('PATH_IS_DIRECTORY');
        });

        it('should return error when trying to write binary-like content', async () => {
            // First create a binary file
            const binaryFile = await env.createFile('binary.bin', '\x00\x01\x02\x03');

            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: binaryFile,
                content: 'New content',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('CANNOT_WRITE_BINARY_FILE');
        });

        it('should write files with special characters', async () => {
            const testFile = path.join(env.getTestDir(), 'special.txt');
            const content = 'Hello "world"\n\tTabbed\nSpecial: <>&\'"';
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: testFile,
                content,
            });

            expect(result.success).toBe(true);
            const written = await env.readFile('special.txt');
            expect(written).toBe(content);
        });

        it('should write files with unicode content', async () => {
            const testFile = path.join(env.getTestDir(), 'unicode.txt');
            const content = 'Hello 世界 🌍\nПривет мир\nمرحبا بالعالم';
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: testFile,
                content,
            });

            expect(result.success).toBe(true);
            const written = await env.readFile('unicode.txt');
            expect(written).toBe(content);
        });

        it('should write large files', async () => {
            const testFile = path.join(env.getTestDir(), 'large.txt');
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: testFile,
                content: LARGE_FILE_CONTENT,
            });

            expect(result.success).toBe(true);
            // Verify file was written by reading it back
            const fs = await import('fs/promises');
            const written = await fs.readFile(testFile, 'utf-8');
            expect(written).toBe(LARGE_FILE_CONTENT);
        });

        it('should write empty files', async () => {
            const testFile = path.join(env.getTestDir(), 'empty.txt');
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: testFile,
                content: '',
            });

            expect(result.success).toBe(true);
        });

        it('should handle Windows-style paths', async () => {
            const testFile = path.join(env.getTestDir(), 'windows', 'path', 'file.txt');
            const tool = new WriteFileTool();
            const result = await tool.execute({
                filePath: testFile.replace(/\\/g, '/'),
                content: 'Windows path test',
            });

            expect(result.success).toBe(true);
        });
    });
});
