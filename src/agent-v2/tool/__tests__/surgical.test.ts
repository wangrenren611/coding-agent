/**
 * Deep tests for surgical.ts (SurgicalEditTool - precise text replacement)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SurgicalEditTool } from '../surgical';
import { TestEnvironment } from './test-utils';

describe('SurgicalEditTool - Deep Tests', () => {
    let env: TestEnvironment;

    beforeEach(async () => {
        env = new TestEnvironment('surgical-tool');
        await env.setup();
    });

    afterEach(async () => {
        await env.teardown();
    });

    describe('Basic Text Replacement', () => {
        it('should replace exact single-line text match', async () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'Line 2',
                newText: 'Modified Line 2',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line 1\nModified Line 2\nLine 3\nLine 4');
        });

        it('should replace text in middle of line', async () => {
            const content = 'function OLD_NAME() {\n  return true;\n}';
            const testFile = await env.createFile('code.js', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'function OLD_NAME() {', // Full line content
                newText: 'function NEW_NAME() {',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('code.js');
            expect(modified).toBe('function NEW_NAME() {\n  return true;\n}');
        });

        it('should replace text at end of line', async () => {
            const content = 'const x = 1;// comment\nconst y = 2;';
            const testFile = await env.createFile('code.js', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'const x = 1;// comment', // Full line content
                newText: 'const x = 1;// updated comment',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('code.js');
            expect(modified).toBe('const x = 1;// updated comment\nconst y = 2;');
        });
    });

    describe('Multi-line Replacement', () => {
        it('should replace two consecutive lines', async () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'Line 2\nLine 3',
                newText: 'New Line 2\nNew Line 3',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line 1\nNew Line 2\nNew Line 3\nLine 4');
        });

        it('should replace three consecutive lines', async () => {
            const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'Line 2\nLine 3\nLine 4',
                newText: 'REPLACED',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line 1\nREPLACED\nLine 5');
        });

        it('should replace multiline function with different number of lines', async () => {
            const content = `function oldFunc() {
    return 1;
}`;
            const testFile = await env.createFile('code.js', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'function oldFunc() {\n    return 1;\n}',
                newText: 'const newFunc = () => 42;',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('code.js');
            expect(modified).toBe('const newFunc = () => 42;');
        });

        it('should replace single line with multiple lines', async () => {
            const content = 'Line 1\nOLD LINE\nLine 3';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'OLD LINE',
                newText: 'New Line A\nNew Line B\nNew Line C',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line 1\nNew Line A\nNew Line B\nNew Line C\nLine 3');
        });

        it('should replace multiple lines with single line', async () => {
            const content = 'Line 1\nLine A\nLine B\nLine C\nLine 5';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'Line A\nLine B\nLine C',
                newText: 'SINGLE LINE',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line 1\nSINGLE LINE\nLine 5');
        });
    });

    describe('Code Pattern Replacement', () => {
        it('should replace function name in declaration', async () => {
            const content = 'function calculateSum(a, b) {\n    return a + b;\n}';
            const testFile = await env.createFile('math.js', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'function calculateSum(a, b) {', // Full line content
                newText: 'function addNumbers(a, b) {',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('math.js');
            expect(modified).toBe('function addNumbers(a, b) {\n    return a + b;\n}');
        });

        it('should replace variable declaration', async () => {
            const content = 'const API_URL = "https://api.example.com";\nconst timeout = 5000;';
            const testFile = await env.createFile('config.js', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'const API_URL = "https://api.example.com";',
                newText: 'const API_ENDPOINT = "https://api.newdomain.com";',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('config.js');
            expect(modified).toBe('const API_ENDPOINT = "https://api.newdomain.com";\nconst timeout = 5000;');
        });

        it('should replace in complex TypeScript interface', async () => {
            const content = `interface User {
    id: number;
    name: string;
    email: string;
}`;
            const testFile = await env.createFile('types.ts', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: '    id: number;',
                newText: '    userId: number;',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('types.ts');
            expect(modified).toContain('    userId: number;');
        });

        it('should replace import statement', async () => {
            const content = 'import { Component } from "react";\nimport { useState } from "react";';
            const testFile = await env.createFile('App.tsx', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'import { Component } from "react";',
                newText: 'import { FC } from "react";',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('App.tsx');
            expect(modified).toBe('import { FC } from "react";\nimport { useState } from "react";');
        });
    });

    describe('Edge Cases and Error Handling', () => {
        it('should return error when file does not exist', async () => {
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: 'nonexistent.txt',
                line: 1,
                oldText: 'old',
                newText: 'new',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('FILE_NOT_FOUND');
        });

        it('should return error when line number is out of range', async () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 10,
                oldText: 'old',
                newText: 'new',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('LINE_OUT_OF_RANGE');
            expect(result.metadata?.fileLength).toBe(3);
        });

        it('should return error when oldText does not match exactly', async () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'Line X', // Wrong text
                newText: 'New Line',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('TEXT_NOT_FOUND');
        });

        it('should return error when multiline oldText spans beyond file end', async () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'Line 2\nLine 3\nLine 4\nLine 5', // More lines than available
                newText: 'Replacement',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('TEXT_NOT_FOUND');
            expect(result.metadata?.reason).toContain('Not enough lines');
        });

        it('should handle case-sensitive matching', async () => {
            const content = 'Hello World\nhello world\nHELLO WORLD';
            const testFile = await env.createFile('case.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'Hello World',
                newText: 'Hi World',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('case.txt');
            expect(modified).toBe('Hi World\nhello world\nHELLO WORLD');
        });

        it('should handle special regex characters in oldText', async () => {
            const content = 'Price: $100.00\nDiscount: 10%';
            const testFile = await env.createFile('special.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'Price: $100.00', // Full line content
                newText: 'Price: $99.99',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('special.txt');
            expect(modified).toBe('Price: $99.99\nDiscount: 10%');
        });

        it('should handle tabs and spaces correctly', async () => {
            const content = '\tindented\n    spaced';
            const testFile = await env.createFile('whitespace.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: '\tindented',
                newText: '\tmodified',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('whitespace.txt');
            expect(modified).toBe('\tmodified\n    spaced');
        });

        it('should handle empty string replacement', async () => {
            const content = 'Line 1\nREMOVE ME\nLine 3';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'REMOVE ME',
                newText: '',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line 1\n\nLine 3');
        });

        it('should handle replacement with newlines', async () => {
            const content = 'SingleLine';
            const testFile = await env.createFile('test.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'SingleLine',
                newText: 'Line A\nLine B\nLine C',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('test.txt');
            expect(modified).toBe('Line A\nLine B\nLine C');
        });
    });

    describe('Real-world Code Scenarios', () => {
        it('should update React component props', async () => {
            const content = `interface Props {
    title: string;
}

export const Button = ({ title }: Props) => {
    return <button>{title}</button>;
};`;
            const testFile = await env.createFile('Button.tsx', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: '    title: string;',
                newText: '    label: string;\n    onClick: () => void;',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('Button.tsx');
            expect(modified).toContain('label: string;');
            expect(modified).toContain('onClick: () => void;');
        });

        it('should update API endpoint configuration', async () => {
            const content = `const config = {
    apiUrl: 'https://old-api.example.com',
    timeout: 5000,
};`;
            const testFile = await env.createFile('config.ts', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: "    apiUrl: 'https://old-api.example.com',",
                newText: "    apiUrl: 'https://new-api.example.com',",
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('config.ts');
            expect(modified).toContain('https://new-api.example.com');
        });

        it('should update function signature with multiple parameters', async () => {
            const content = `function fetchData(userId: string, page: number): Promise<Data> {
    return api.get(\`/users/\${userId}\`);`;
            const testFile = await env.createFile('api.ts', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'function fetchData(userId: string, page: number): Promise<Data> {',
                newText: 'async function fetchData(userId: string, options: FetchOptions = {}): Promise<Data> {',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('api.ts');
            expect(modified).toContain(
                'async function fetchData(userId: string, options: FetchOptions = {}): Promise<Data> {'
            );
        });
    });

    describe('Whitespace and Formatting Edge Cases', () => {
        it('should preserve trailing whitespace', async () => {
            const content = 'Line 1   \nLine 2\t\nLine 3';
            const testFile = await env.createFile('whitespace.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'Line 1   ',
                newText: 'Modified 1   ',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('whitespace.txt');
            expect(modified).toMatch(/^Modified 1 {3}\n/);
        });

        it('should handle Windows line endings (CRLF)', async () => {
            const content = 'Line 1\r\nLine 2\r\nLine 3';
            const testFile = await env.createFile('crlf.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: 'Line 2',
                newText: 'Modified 2',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('crlf.txt');
            expect(modified).toContain('Modified 2');
        });

        it('should handle mixed line endings', async () => {
            const content = 'Line 1\nLine 2\r\nLine 3';
            const testFile = await env.createFile('mixed.txt', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 1,
                oldText: 'Line 1',
                newText: 'Modified 1',
            });

            expect(result.success).toBe(true);
        });

        it('should preserve indentation in replacement', async () => {
            const content = 'function test() {\n    const x = 1;\n        const y = 2;\n}';
            const testFile = await env.createFile('indent.ts', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2, // Line 2 is '    const x = 1;'
                oldText: '    const x = 1;',
                newText: '    let x = 1;',
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('indent.ts');
            expect(modified).toContain('    let x = 1;');
            // Next line should keep its extra indentation
            expect(modified).toContain('        const y = 2;');
        });
    });

    describe('Complex Multi-line Scenarios', () => {
        it('should replace entire function with new implementation', async () => {
            const content = `// Old implementation
function calculate(x: number, y: number): number {
    const result = x + y;
    return result;
}

// New code here
console.log('done');`;
            const testFile = await env.createFile('math.ts', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: `function calculate(x: number, y: number): number {
    const result = x + y;
    return result;
}`,
                newText: `const calculate = (x: number, y: number): number => x * y;`,
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('math.ts');
            expect(modified).toContain('const calculate = (x: number, y: number): number => x * y;');
            expect(modified).toContain('// New code here');
        });

        it('should replace class method definition', async () => {
            const content = `class Calculator {
    add(a: number, b: number): number {
        return a + b;
    }

    subtract(a: number, b: number): number {
        return a - b;
    }
}`;
            const testFile = await env.createFile('Calculator.ts', content);
            const tool = new SurgicalEditTool();
            const result = await tool.execute({
                filePath: testFile,
                line: 2,
                oldText: `    add(a: number, b: number): number {
        return a + b;
    }`,
                newText: `    add(...numbers: number[]): number {
        return numbers.reduce((sum, n) => sum + n, 0);
    }`,
            });

            expect(result.success).toBe(true);
            const modified = await env.readFile('Calculator.ts');
            expect(modified).toContain('...numbers: number[]');
            expect(modified).toContain('reduce');
            // subtract method should remain
            expect(modified).toContain('subtract');
        });
    });
});
