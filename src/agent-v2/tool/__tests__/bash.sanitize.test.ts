/**
 * 使用 session-1002.json 中的实际乱码数据测试 sanitizeOutput
 *
 * 注意：这些测试验证的是 sanitizeOutput 方法的清理能力
 * 实际的修复方案是在执行命令时设置 UTF-8 编码，从源头解决问题
 */

import { describe, it, expect } from 'vitest';
import BashTool from '../bash';

describe('sanitizeOutput - 乱码清理能力测试', () => {
    const tool = new BashTool();

    describe('基本清理能力', () => {
        it('应该移除 Unicode 替换字符', () => {
            const input = 'Test passed\uFFFD\uFFFDHello';
            const output = tool.sanitizeOutputForTest(input);
            expect(output).not.toContain('\uFFFD');
        });

        it('应该保留有效的中文和符号', () => {
            const input = '测试通过: ✓ Hello 世界';
            const output = tool.sanitizeOutputForTest(input);
            expect(output).toContain('测试通过');
            expect(output).toContain('✓');
            expect(output).toContain('世界');
        });

        it('应该规范化换行符', () => {
            const input = 'Line1\r\nLine2\rLine3\n\n\nLine4';
            const output = tool.sanitizeOutputForTest(input);
            expect(output).toContain('Line1\nLine2\nLine3\n\nLine4');
        });

        it('应该移除过多的空行', () => {
            const input = 'Line1\n\n\n\n\nLine2';
            const output = tool.sanitizeOutputForTest(input);
            expect(output).toContain('Line1\n\nLine2');
            expect(output).not.toContain('\n\n\n');
        });
    });

    describe('实际乱码样本测试', () => {
        it('应该移除 Unicode 替换字符（实际乱码来源）', () => {
            // 真实的输出可能包含替换字符
            const input = `
  src/test.ts
  \uFFFD\uFFFD Error
  src/test2.ts
            `.trim();

            const output = tool.sanitizeOutputForTest(input);

            console.log('=== 输入 ===');
            console.log(input);
            console.log('=== 输出 ===');
            console.log(output);

            // 替换字符应该被移除
            expect(output).not.toContain('\uFFFD');
            // 但有效内容应该保留
            expect(output).toContain('src/test.ts');
        });

        it('测试 session-1002 中的实际输出模式', () => {
            // 这模拟了可能出现的混合内容
            const input = `
  ✓ src/agent-v2/logger/__tests__/config.test.ts (20 tests) 8ms
  Error: \uFFFD invalid
  ✗ src/agent-v2/tool/__tests__/bash.test.ts (1 test) 50ms
            `.trim();

            const output = tool.sanitizeOutputForTest(input);

            // 替换字符应该被移除
            expect(output).not.toContain('\uFFFD');
            // 有效内容应该保留
            expect(output).toContain('✓');
            expect(output).toContain('config.test.ts');
            expect(output).toContain('✗');
            expect(output).toContain('bash.test.ts');
        });
    });

    describe('边界情况', () => {
        it('应该处理空字符串', () => {
            expect(tool.sanitizeOutputForTest('')).toBe('');
        });

        it('应该处理纯乱码', () => {
            const input = '\uFFFD\uFFFD\uFFFD';
            const output = tool.sanitizeOutputForTest(input);
            // 纯乱码可能被完全移除
            expect(output.length).toBeLessThan(input.length);
        });

        it('应该保留 ASCII 内容', () => {
            const input = 'Hello World 123';
            const output = tool.sanitizeOutputForTest(input);
            expect(output).toContain('Hello World 123');
        });
    });
});
