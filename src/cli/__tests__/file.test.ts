/**
 * CLI 文件工具测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseFilePaths, formatFileSize, createFileSummary } from '../utils/file';

describe('CLI 文件工具', () => {
    let tempDir: string;

    beforeEach(async () => {
        // 创建临时目录
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cli-file-test-'));
    });

    afterEach(async () => {
        // 清理临时目录
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // ==================== parseFilePaths 测试 ====================

    describe('parseFilePaths', () => {
        it('应该正确解析纯文本输入（无文件）', () => {
            const result = parseFilePaths('你好，这是一个测试消息', tempDir);

            expect(result.text).toBe('你好，这是一个测试消息');
            expect(result.contentParts).toHaveLength(1);
            expect(result.contentParts[0].type).toBe('text');
            expect((result.contentParts[0] as { type: 'text'; text: string }).text).toBe('你好，这是一个测试消息');
            expect(result.errors).toHaveLength(0);
        });

        it('应该正确处理空输入', () => {
            const result = parseFilePaths('', tempDir);

            expect(result.text).toBe('');
            expect(result.contentParts).toHaveLength(0);
            expect(result.errors).toHaveLength(0);
        });

        it('应该正确处理只有空格的输入', () => {
            const result = parseFilePaths('   ', tempDir);

            expect(result.text).toBe('');
            expect(result.contentParts).toHaveLength(0);
        });

        it('应该检测不存在的文件并返回错误', () => {
            const result = parseFilePaths('@/nonexistent/file.png 这是文本', tempDir);

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain('文件不存在');
        });

        it('应该正确处理多个不存在的文件', () => {
            const result = parseFilePaths('@/file1.png @/file2.jpg @/file3.pdf', tempDir);

            expect(result.errors).toHaveLength(3);
        });

        it('应该正确解析相对路径', async () => {
            // 创建测试文件
            const testFile = path.join(tempDir, 'test.txt');
            await fs.promises.writeFile(testFile, 'test content');

            const result = parseFilePaths('@./test.txt 这是文本', tempDir);

            expect(result.text).toBe('这是文本');
            expect(result.errors).toHaveLength(0);
            // 应该有一个文件部分和一个文本部分
            expect(result.contentParts.length).toBeGreaterThanOrEqual(1);
        });

        it('应该正确解析绝对路径', async () => {
            // 创建测试文件
            const testFile = path.join(tempDir, 'absolute-test.txt');
            await fs.promises.writeFile(testFile, 'absolute content');

            const result = parseFilePaths(`@${testFile} 这是文本`, tempDir);

            expect(result.text).toBe('这是文本');
            expect(result.errors).toHaveLength(0);
        });

        it('应该正确识别图片文件类型', async () => {
            // 创建一个假的图片文件
            const imagePath = path.join(tempDir, 'test.png');
            // PNG 文件头
            const pngHeader = Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            ]);
            await fs.promises.writeFile(imagePath, pngHeader);

            const result = parseFilePaths(`@${imagePath}`, tempDir);

            expect(result.errors).toHaveLength(0);
            // 检查是否有 image_url 类型的内容
            const hasImage = result.contentParts.some((part) => part.type === 'image_url');
            expect(hasImage).toBe(true);
        });

        it('应该正确处理混合内容（文本 + 多个文件）', async () => {
            // 创建多个测试文件
            const file1 = path.join(tempDir, 'doc1.txt');
            const file2 = path.join(tempDir, 'doc2.txt');
            await fs.promises.writeFile(file1, 'content 1');
            await fs.promises.writeFile(file2, 'content 2');

            const result = parseFilePaths(`请分析这些文件 @${file1} @${file2}`, tempDir);

            expect(result.text).toBe('请分析这些文件');
            expect(result.errors).toHaveLength(0);
        });

        it('应该处理文件路径中有空格的情况（不支持空格路径）', async () => {
            // 由于正则表达式不支持空格，这种情况下路径会被截断
            const result = parseFilePaths('@/path with spaces/file.txt', tempDir);

            // 路径会被解析为 /path，导致文件不存在错误
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
        });

        it('应该正确处理 ~ 开头的路径（家目录）', () => {
            // 注意：这个测试可能在不同环境下表现不同
            const result = parseFilePaths('@~/nonexistent-file.txt', tempDir);

            // 文件不存在应该报错
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ==================== formatFileSize 测试 ====================

    describe('formatFileSize', () => {
        it('应该正确格式化字节', () => {
            expect(formatFileSize(0)).toBe('0 B');
            expect(formatFileSize(100)).toBe('100 B');
            expect(formatFileSize(1023)).toBe('1023 B');
        });

        it('应该正确格式化 KB', () => {
            expect(formatFileSize(1024)).toBe('1.0 KB');
            expect(formatFileSize(1536)).toBe('1.5 KB');
            expect(formatFileSize(1024 * 100)).toBe('100.0 KB');
        });

        it('应该正确格式化 MB', () => {
            expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
            expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
            expect(formatFileSize(1024 * 1024 * 100)).toBe('100.0 MB');
        });

        it('应该正确格式化 GB', () => {
            expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
            expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB');
        });
    });

    // ==================== createFileSummary 测试 ====================

    describe('createFileSummary', () => {
        it('应该正确处理空数组', () => {
            expect(createFileSummary([])).toBe('');
        });

        it('应该正确生成图片摘要', () => {
            const parts = [{ type: 'image_url' as const, image_url: { url: 'test' } }];
            expect(createFileSummary(parts)).toBe('[图片]');
        });

        it('应该正确生成视频摘要', () => {
            const parts = [{ type: 'input_video' as const, input_video: { data: 'test', format: 'mp4' as const } }];
            expect(createFileSummary(parts)).toBe('[视频]');
        });

        it('应该正确生成文件摘要', () => {
            const parts = [{ type: 'file' as const, file: { file_data: 'test', filename: 'document.pdf' } }];
            expect(createFileSummary(parts)).toBe('[文件: document.pdf]');
        });

        it('应该正确处理混合内容', () => {
            const parts = [
                { type: 'image_url' as const, image_url: { url: 'test1' } },
                { type: 'input_video' as const, input_video: { data: 'test2', format: 'mp4' as const } },
                { type: 'file' as const, file: { file_data: 'test3', filename: 'report.pdf' } },
            ];
            expect(createFileSummary(parts)).toBe('[图片] [视频] [文件: report.pdf]');
        });

        it('应该忽略纯文本部分', () => {
            const parts = [
                { type: 'text' as const, text: 'some text' },
                { type: 'image_url' as const, image_url: { url: 'test' } },
            ];
            expect(createFileSummary(parts)).toBe('[图片]');
        });
    });

    // ==================== 边界条件测试 ====================

    describe('边界条件', () => {
        it('应该处理非常大的文件路径输入', () => {
            const longPath = '@/a'.repeat(1000);
            const result = parseFilePaths(longPath, tempDir);

            // 应该有错误（文件不存在）但不应该崩溃
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('应该处理特殊字符文件名', async () => {
            // 创建带特殊字符的文件（在允许范围内）
            const specialFile = path.join(tempDir, 'test-file_1.txt');
            await fs.promises.writeFile(specialFile, 'content');

            const result = parseFilePaths(`@${specialFile}`, tempDir);

            expect(result.errors).toHaveLength(0);
        });

        it('应该正确处理连续多个 @ 符号', () => {
            const result = parseFilePaths('@@@test', tempDir);

            // 应该能处理，虽然可能产生错误
            expect(result).toBeDefined();
        });

        it('应该正确处理只有 @ 的输入', () => {
            const result = parseFilePaths('@', tempDir);

            expect(result).toBeDefined();
        });
    });
});
