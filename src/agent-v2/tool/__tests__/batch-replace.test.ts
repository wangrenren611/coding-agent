/**
 * Deep tests for batch-replace.ts (BatchReplaceTool)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BatchReplaceTool } from '../batch-replace';
import { TestEnvironment } from './test-utils';

describe('BatchReplaceTool - Deep Tests', () => {
    let env: TestEnvironment;

    beforeEach(async () => {
        env = new TestEnvironment('batch-replace-tool');
        await env.setup();
    });

    afterEach(async () => {
        await env.teardown();
    });

    describe('Basic Batch Replacement', () => {
        it('should replace text on multiple lines', async () => {
            const content = 'Line 1 OLD\nLine 2 OLD\nLine 3 OLD';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'OLD', newText: 'NEW' },
                    { line: 2, oldText: 'OLD', newText: 'NEW' },
                    { line: 3, oldText: 'OLD', newText: 'NEW' },
                ],
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.modifiedCount).toBe(3);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line 1 NEW\nLine 2 NEW\nLine 3 NEW');
        });

        it('should handle mixed successful and failed replacements', async () => {
            const content = 'Line 1 MATCH\nLine 2 NOMATCH\nLine 3 MATCH';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'MATCH', newText: 'NEW' },
                    { line: 2, oldText: 'MISSING', newText: 'NEW' },
                    { line: 3, oldText: 'MATCH', newText: 'NEW' },
                ],
            });

            expect(result.success).toBe(true); // Partial success still returns success
            expect(result.metadata?.modifiedCount).toBe(2);
            expect(result.metadata?.failedCount).toBe(1);
            expect(result.metadata?.hasErrors).toBe(true);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line 1 NEW\nLine 2 NOMATCH\nLine 3 NEW');
        });

        it('should return error for empty replacements array', async () => {
            const content = 'Some content';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [],
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('EMPTY_REPLACEMENTS');
        });
    });

    describe('Original Line Content Preservation', () => {
        it('should use original line content when same line is modified multiple times', async () => {
            const content = 'ORIGINAL_TEXT on this line';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'ORIGINAL_TEXT', newText: 'FIRST_MOD' },
                    { line: 1, oldText: 'ORIGINAL_TEXT', newText: 'SECOND_MOD' }, // Should still find ORIGINAL
                ],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            // Second replacement should also succeed because it uses original content
            expect(modified).toBe('SECOND_MOD on this line');
        });

        it('should handle multiple independent replacements on same line', async () => {
            const content = 'VAR1 + VAR2 + VAR3';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'VAR1', newText: 'A' },
                    { line: 1, oldText: 'VAR2', newText: 'B' },
                    { line: 1, oldText: 'VAR3', newText: 'C' },
                ],
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.modifiedCount).toBe(3);
            const modified = await env.readFile('test.txt');
            // Each replacement uses original line content, last one wins
            // Replacement 3: 'VAR1 + VAR2 + VAR3' → 'VAR1 + VAR2 + C'
            expect(modified).toBe('VAR1 + VAR2 + C');
        });

        it('should preserve original line when replacement fails', async () => {
            const content = 'CORRECT original line';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'WRONG', newText: 'NEW' }, // Will fail
                ],
            });

            expect(result.success).toBe(true); // Still success because file wasn't damaged
            expect(result.metadata?.modifiedCount).toBe(0);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('CORRECT original line'); // Unchanged
        });
    });

    describe('Line Ending Handling', () => {
        it('should preserve Windows line endings (CRLF)', async () => {
            const content = 'Line 1 OLD\r\nLine 2 OLD\r\nLine 3 OLD';
            const testFile = await env.createFile('crlf.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'OLD', newText: 'NEW' },
                    { line: 2, oldText: 'OLD', newText: 'NEW' },
                ],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('crlf.txt');
            expect(modified).toContain('\r\n');
            expect(modified).not.toContain('\n\r\n');
        });

        it('should preserve Unix line endings (LF)', async () => {
            const content = 'Line 1 OLD\nLine 2 OLD\nLine 3 OLD';
            const testFile = await env.createFile('lf.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: 'OLD', newText: 'NEW' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('lf.txt');
            expect(modified).toBe('Line 1 NEW\nLine 2 OLD\nLine 3 OLD');
        });

        it('should handle files with trailing newline', async () => {
            const content = 'Line 1 OLD\nLine 2 OLD\n'; // Trailing newline
            const testFile = await env.createFile('trailing.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: 'OLD', newText: 'NEW' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('trailing.txt');
            expect(modified).toBe('Line 1 NEW\nLine 2 OLD\n');
        });

        it('should handle files without trailing newline', async () => {
            const content = 'Line 1 OLD\nLine 2 OLD'; // No trailing newline
            const testFile = await env.createFile('no-trailing.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 2, oldText: 'OLD', newText: 'NEW' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('no-trailing.txt');
            expect(modified).toBe('Line 1 OLD\nLine 2 NEW');
        });
    });

    describe('Special Characters and Patterns', () => {
        it('should handle dollar signs in replacement text (escape special chars)', async () => {
            const content = 'Price: $100';
            const testFile = await env.createFile('price.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: '$100', newText: '$200' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('price.txt');
            expect(modified).toBe('Price: $200');
        });

        it('should handle multiple dollar signs', async () => {
            const content = '$$ total $$';
            const testFile = await env.createFile('dollars.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: '$$', newText: '$$$' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('dollars.txt');
            // String.replace() only replaces first occurrence by default
            expect(modified).toBe('$$$ total $$');
        });

        it('should handle backreferences in replacement', async () => {
            const content = 'Test value';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: 'Test', newText: '$& modified' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            // $& should be escaped to $$& in the replacement
            expect(modified).toBe('$& modified value');
        });

        it('should handle tabs and spaces', async () => {
            const content = '\tTabbed\t\n    Spaced    ';
            const testFile = await env.createFile('whitespace.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'Tabbed', newText: 'Modified' },
                    { line: 2, oldText: 'Spaced', newText: 'Changed' },
                ],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('whitespace.txt');
            expect(modified).toBe('\tModified\t\n    Changed    ');
        });
    });

    describe('Code Refactoring Scenarios', () => {
        it('should rename variable across multiple lines', async () => {
            const content = `const oldName = 1;
console.log(oldName);
return oldName;`;
            const testFile = await env.createFile('code.js', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'oldName', newText: 'newName' },
                    { line: 2, oldText: 'oldName', newText: 'newName' },
                    { line: 3, oldText: 'oldName', newText: 'newName' },
                ],
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.modifiedCount).toBe(3);
            const modified = await env.readFile('code.js');
            expect(modified).toContain('newName');
        });

        it('should update configuration values', async () => {
            const content = `HOST: localhost
PORT: 3000
DEBUG: false`;
            const testFile = await env.createFile('config.env', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'localhost', newText: 'production.server.com' },
                    { line: 2, oldText: '3000', newText: '8080' },
                    { line: 3, oldText: 'false', newText: 'true' },
                ],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('config.env');
            expect(modified).toContain('production.server.com');
            expect(modified).toContain('8080');
            expect(modified).toContain('true');
        });

        it('should refactor CSS class names', async () => {
            const content = `.old-class { color: red; }
.another-old { font-size: 14px; }
.old-class:hover { color: blue; }`;
            const testFile = await env.createFile('styles.css', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'old-class', newText: 'new-class' },
                    { line: 3, oldText: 'old-class', newText: 'new-class' },
                ],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('styles.css');
            expect(modified).toMatch(/\.new-class { color: red; }/);
            expect(modified).toMatch(/\.new-class:hover { color: blue; }/);
            expect(modified).toContain('.another-old'); // Should remain unchanged
        });

        it('should update import paths', async () => {
            const content = `import { Component } from './old/path/Component';
import { Helper } from './old/path/Helper';
import { Util } from './other/path';`;
            const testFile = await env.createFile('imports.ts', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: './old/path/', newText: './new/path/' },
                    { line: 2, oldText: './old/path/', newText: './new/path/' },
                ],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('imports.ts');
            expect(modified).toContain('./new/path/Component');
            expect(modified).toContain('./new/path/Helper');
            expect(modified).toContain('./other/path'); // Should remain unchanged
        });
    });

    describe('Error Cases', () => {
        it('should return error when file does not exist', async () => {
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: 'nonexistent.txt',
                replacements: [{ line: 1, oldText: 'old', newText: 'new' }],
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('FILE_NOT_FOUND');
        });

        it('should return error for out of range line numbers', async () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'Line', newText: 'Modified' },
                    { line: 10, oldText: 'Line', newText: 'Modified' }, // Out of range
                ],
            });

            expect(result.success).toBe(true); // Still overall success
            expect(result.metadata?.modifiedCount).toBe(1);
            expect(result.metadata?.failedCount).toBe(1);
        });

        it('should return error for line number 0', async () => {
            const content = 'Line 1\nLine 2';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 0, oldText: 'old', newText: 'new' }, // Invalid line number
                ],
            });

            expect(result.success).toBe(true); // Still returns success with error in results
            expect(result.metadata?.modifiedCount).toBe(0);
            expect(result.metadata?.failedCount).toBe(1);
        });

        it('should return error for negative line numbers', async () => {
            const content = 'Line 1';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: -1, oldText: 'old', newText: 'new' }],
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.failedCount).toBe(1);
        });

        it('should handle all replacements failing', async () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'NOTFOUND', newText: 'new' },
                    { line: 2, oldText: 'ALSORNOTFOUND', newText: 'new' },
                    { line: 3, oldText: 'STILLNOTFOUND', newText: 'new' },
                ],
            });

            expect(result.success).toBe(true); // No exception thrown
            expect(result.metadata?.modifiedCount).toBe(0);
            expect(result.metadata?.failedCount).toBe(3);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe(content); // File unchanged
        });
    });

    describe('Performance and Edge Cases', () => {
        it('should handle large number of replacements', async () => {
            const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: PATTERN`);
            const content = lines.join('\n');
            const testFile = await env.createFile('large.txt', content);
            const tool = new BatchReplaceTool();

            const replacements = Array.from({ length: 100 }, (_, i) => ({
                line: i + 1,
                oldText: 'PATTERN',
                newText: 'REPLACED',
            }));

            const result = await tool.execute({
                filePath: testFile,
                replacements,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.modifiedCount).toBe(100);
            const modified = await env.readFile('large.txt');
            expect(modified).toContain('REPLACED');
        });

        it('should handle empty file', async () => {
            const content = '';
            const testFile = await env.createFile('empty.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: 'anything', newText: 'new' }],
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.failedCount).toBe(1);
        });

        it('should handle single line file', async () => {
            const content = 'Single line content';
            const testFile = await env.createFile('single.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: 'Single', newText: 'Modified' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('single.txt');
            expect(modified).toBe('Modified line content');
        });

        it('should handle replacement with empty string', async () => {
            const content = 'Remove THIS word';
            const testFile = await env.createFile('remove.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: 'THIS ', newText: '' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('remove.txt');
            expect(modified).toBe('Remove word');
        });

        it('should handle very long oldText', async () => {
            const longText = 'A'.repeat(1000);
            const content = `${longText} end`;
            const testFile = await env.createFile('long.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [{ line: 1, oldText: longText, newText: 'SHORT' }],
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('long.txt');
            expect(modified).toBe('SHORT end');
        });
    });

    describe('Result Details', () => {
        it('should return detailed results for each replacement', async () => {
            const content = 'Line 1 MATCH\nLine 2 NOMATCH\nLine 3 MATCH';
            const testFile = await env.createFile('test.txt', content);
            const tool = new BatchReplaceTool();
            const result = await tool.execute({
                filePath: testFile,
                replacements: [
                    { line: 1, oldText: 'MATCH', newText: 'NEW' },
                    { line: 2, oldText: 'MISSING', newText: 'NEW' },
                    { line: 3, oldText: 'MATCH', newText: 'NEW' },
                ],
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.results).toHaveLength(3);
            expect(result.metadata?.results[0].success).toBe(true);
            expect(result.metadata?.results[1].success).toBe(false);
            expect(result.metadata?.results[2].success).toBe(true);
            expect(result.metadata?.results[1].message).toContain('not found');
        });
    });
});
