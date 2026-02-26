/**
 * Plan Storage 测试 (简化版)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FilePlanStorage, createPlanStorage, getPlanFilePath } from '../storage';

describe('Plan Storage', () => {
    const testDir = path.join(process.cwd(), 'test-plans-storage');
    let storage: FilePlanStorage;

    beforeEach(async () => {
        storage = new FilePlanStorage(testDir);
    });

    afterEach(async () => {
        // 清理测试目录
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    describe('FilePlanStorage', () => {
        describe('create()', () => {
            it('应该创建 Plan 并返回元数据', async () => {
                const meta = await storage.create({
                    title: '测试计划',
                    content: '# 测试计划\n\n## 步骤\n1. 步骤一',
                    sessionId: 'session-1',
                });

                expect(meta.id).toBeDefined();
                expect(meta.title).toBe('测试计划');
                expect(meta.sessionId).toBe('session-1');
                expect(meta.filePath).toContain('session-1');
                expect(meta.createdAt).toBeDefined();
                expect(meta.updatedAt).toBeDefined();
            });

            it('应该将 Markdown 内容写入文件', async () => {
                const meta = await storage.create({
                    title: '测试计划',
                    content: '# 测试计划\n\n## 步骤\n1. 步骤一',
                    sessionId: 'session-2',
                });

                const content = await fs.readFile(meta.filePath, 'utf-8');
                expect(content).toContain('# 测试计划');
                expect(content).toContain('步骤');
            });
        });

        describe('getBySession()', () => {
            it('应该返回 Plan 内容', async () => {
                await storage.create({
                    title: '测试计划',
                    content: '# 测试计划内容',
                    sessionId: 'session-3',
                });

                const result = await storage.getBySession('session-3');

                expect(result).not.toBeNull();
                expect(result?.meta.title).toBe('测试计划');
                expect(result?.content).toContain('# 测试计划内容');
            });

            it('应该返回 null 如果不存在', async () => {
                const result = await storage.getBySession('non-existent');
                expect(result).toBeNull();
            });
        });

        describe('list()', () => {
            it('应该返回空数组如果没有计划', async () => {
                const plans = await storage.list();
                expect(plans).toEqual([]);
            });

            it('应该列出所有计划', async () => {
                await storage.create({
                    title: '计划1',
                    content: '# 计划1',
                    sessionId: 'session-4',
                });
                await storage.create({
                    title: '计划2',
                    content: '# 计划2',
                    sessionId: 'session-5',
                });

                const plans = await storage.list();

                expect(plans.length).toBe(2);
                expect(plans.map(p => p.title)).toContain('计划1');
                expect(plans.map(p => p.title)).toContain('计划2');
            });

            it('应该按 sessionId 过滤', async () => {
                await storage.create({
                    title: '计划1',
                    content: '# 计划1',
                    sessionId: 'session-6',
                });
                await storage.create({
                    title: '计划2',
                    content: '# 计划2',
                    sessionId: 'session-7',
                });

                const plans = await storage.list('session-6');

                expect(plans.length).toBe(1);
                expect(plans[0].title).toBe('计划1');
            });
        });

        describe('delete()', () => {
            it('应该删除存在的计划', async () => {
                const meta = await storage.create({
                    title: '要删除的计划',
                    content: '# 内容',
                    sessionId: 'session-8',
                });

                const deleted = await storage.delete(meta.id);
                expect(deleted).toBe(true);

                const result = await storage.getBySession('session-8');
                expect(result).toBeNull();
            });

            it('应该返回 false 如果计划不存在', async () => {
                const deleted = await storage.delete('non-existent');
                expect(deleted).toBe(false);
            });
        });
    });

    describe('createPlanStorage()', () => {
        it('应该创建 FilePlanStorage 如果没有 memoryManager', () => {
            const storage = createPlanStorage(undefined, undefined, testDir);
            expect(storage).toBeInstanceOf(FilePlanStorage);
        });
    });

    describe('getPlanFilePath()', () => {
        it('应该返回正确的文件路径', () => {
            const filePath = getPlanFilePath('/data', 'session-123');
            // Windows 和 Unix 路径分隔符不同
            expect(filePath).toMatch(/[\\/]data[\\/]plans[\\/]session-123[\\/]plan\.md/);
        });
    });
});
