/**
 * Buffer 大小计算 bug 测试
 *
 * 问题：maxBufferSize 配置为字节数，但代码使用字符长度进行比较
 * 这会导致中文/emoji 等多字节字符实际占用内存超过预期
 *
 * 已修复：现在使用 Buffer.byteLength 计算字节数
 */

import { describe, it, expect } from 'vitest';
import { StreamProcessor } from '../stream-processor';

describe('StreamProcessor Buffer 大小计算', () => {
    // 辅助函数：创建测试用的 processor
    const createTestProcessor = (maxBufferSize: number) => {
        return new StreamProcessor({
            maxBufferSize,
            onMessageCreate: () => {},
            onMessageUpdate: () => {},
            onTextStart: () => {},
            onTextDelta: () => {},
            onTextComplete: () => {},
            onUsageUpdate: () => {},
        });
    };

    describe('英文内容', () => {
        it('英文内容应该正确计算缓冲区大小', () => {
            const processor = createTestProcessor(100); // 100 字节限制

            // 英文 50 字符 = 50 字节
            const result1 = processor.appendToBufferForTest('content', 'a'.repeat(50));
            expect(result1).toBe(true);

            // 再加 50 字符 = 100 字节，刚好到限制
            const result2 = processor.appendToBufferForTest('content', 'b'.repeat(50));
            expect(result2).toBe(true);

            // 再加 1 字符 = 101 字节，超过限制
            const result3 = processor.appendToBufferForTest('content', 'c');
            expect(result3).toBe(false);
            expect(processor.isAborted()).toBe(true);
            expect(processor.getAbortReason()).toBe('buffer_overflow');
        });
    });

    describe('中文内容', () => {
        it('中文内容应该正确触发 buffer_overflow', () => {
            // 配置 30 字节的缓冲区
            const processor = createTestProcessor(30);

            // 中文 "你好" = 2 字符 = 6 字节
            const r1 = processor.appendToBufferForTest('content', '你好');
            expect(r1).toBe(true);

            // 中文 "世界" = 2 字符 = 6 字节
            // 累积：12 字节 < 30 字节限制
            const r2 = processor.appendToBufferForTest('content', '世界');
            expect(r2).toBe(true);

            // 中文 "你好世界" = 4 字符 = 12 字节
            // 累积：24 字节 < 30 字节限制
            const r3 = processor.appendToBufferForTest('content', '你好世界');
            expect(r3).toBe(true);

            // 中文 "测试内容" = 4 字符 = 12 字节
            // 累积：36 字节 > 30 字节限制
            const r4 = processor.appendToBufferForTest('content', '测试内容');

            // 修复后：字节数 36 > 30，应该触发 overflow
            expect(r4).toBe(false);
            expect(processor.isAborted()).toBe(true);
            expect(processor.getAbortReason()).toBe('buffer_overflow');
        });

        it('大量中文内容应该正确触发 overflow', () => {
            // 100 字节限制
            const processor = createTestProcessor(100);

            // 100 个中文字符 = 300 字节 > 100 字节限制
            const chineseText = '中'.repeat(100);

            const result = processor.appendToBufferForTest('content', chineseText);

            // 修复后：字节数 300 > 100，应该触发 overflow
            expect(result).toBe(false);
            expect(processor.isAborted()).toBe(true);
            expect(processor.getAbortReason()).toBe('buffer_overflow');
        });

        it('中文累积到限制时应正确触发', () => {
            // 12 字节限制
            const processor = createTestProcessor(12);

            // "你好" = 6 字节
            const r1 = processor.appendToBufferForTest('content', '你好');
            expect(r1).toBe(true);

            // 再加 "你" = 3 字节，累积 9 字节 < 12
            const r2 = processor.appendToBufferForTest('content', '你');
            expect(r2).toBe(true);

            // 再加 "好" = 3 字节，累积 12 字节 = 12 (刚好)
            const r3 = processor.appendToBufferForTest('content', '好');
            expect(r3).toBe(true);

            // 再加 "啊" = 3 字节，累积 15 字节 > 12
            const r4 = processor.appendToBufferForTest('content', '啊');
            expect(r4).toBe(false);
            expect(processor.isAborted()).toBe(true);
            expect(processor.getAbortReason()).toBe('buffer_overflow');
        });
    });

    describe('Emoji 内容', () => {
        it('Emoji 内容应该正确触发 overflow', () => {
            // 20 字节限制
            const processor = createTestProcessor(20);

            // 5 个 emoji = 5 字符 = 20 字节 (刚好)
            const r1 = processor.appendToBufferForTest('content', '👋'.repeat(5));
            expect(r1).toBe(true);

            // 再加 1 个 emoji = 4 字节，累积 24 字节 > 20
            const r2 = processor.appendToBufferForTest('content', '👋');
            expect(r2).toBe(false);
            expect(processor.isAborted()).toBe(true);
            expect(processor.getAbortReason()).toBe('buffer_overflow');
        });
    });

    describe('混合内容', () => {
        it('中英混合内容应该正确计算', () => {
            // 30 字节限制
            const processor = createTestProcessor(30);

            // "hello" = 5 字节
            processor.appendToBufferForTest('content', 'hello');

            // "你好" = 6 字节，累积 11 字节
            processor.appendToBufferForTest('content', '你好');

            // "world" = 5 字节，累积 16 字节
            processor.appendToBufferForTest('content', 'world');

            // "世界" = 6 字节，累积 22 字节
            processor.appendToBufferForTest('content', '世界');

            // 再加 "中文" = 6 字节，累积 28 字节 < 30
            const r1 = processor.appendToBufferForTest('content', '中文');
            expect(r1).toBe(true);

            // 再加 "测试" = 6 字节，累积 34 字节 > 30
            const r2 = processor.appendToBufferForTest('content', '测试');
            expect(r2).toBe(false);
            expect(processor.isAborted()).toBe(true);
            expect(processor.getAbortReason()).toBe('buffer_overflow');
        });
    });

    describe('reasoning 内容', () => {
        it('reasoning 内容也应该正确计算字节数', () => {
            // 20 字节限制
            const processor = createTestProcessor(20);

            // reasoning: "思考" = 6 字节
            const r1 = processor.appendToBufferForTest('reasoning', '思考');
            expect(r1).toBe(true);

            // 再加 reasoning: "中" = 3 字节，累积 9 字节
            const r2 = processor.appendToBufferForTest('reasoning', '中');
            expect(r2).toBe(true);

            // 再加 reasoning: "思考思考" = 12 字节，累积 21 字节 > 20
            const r3 = processor.appendToBufferForTest('reasoning', '思考思考');
            expect(r3).toBe(false);
            expect(processor.isAborted()).toBe(true);
        });
    });

    describe('字节数计算验证', () => {
        it('验证 Buffer.byteLength 计算正确', () => {
            expect(Buffer.byteLength('hello', 'utf8')).toBe(5);
            expect(Buffer.byteLength('你好', 'utf8')).toBe(6);
            expect(Buffer.byteLength('👋', 'utf8')).toBe(4);
            expect(Buffer.byteLength('hello你好', 'utf8')).toBe(11);
            expect(Buffer.byteLength('中'.repeat(100), 'utf8')).toBe(300);
            expect(Buffer.byteLength('👋'.repeat(100), 'utf8')).toBe(400);
        });
    });
});
