/**
 * Plan Storage 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    FilePlanStorage,
    createPlanStorage,
    getPlanFilePath,
    PlanStorageError,
} from '../storage';

describe('Plan Storage', () => {
    const testDir = path.join(process.cwd(), 'test-plans-storage');
    let storage: FilePlanStorage;

    beforeEach(() => {
        storage = new FilePlanStorage(testDir);
    });

    afterEach(async () => {
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
                expect(meta.id.startsWith('plan-')).toBe(true);
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

            it('应该拒绝无效的 sessionId', async () => {
                await expect(
                    storage.create({
                        title: '测试计划',
                        content: '# 内容',
                        sessionId: '../escape',
                    })
                ).rejects.toThrow(PlanStorageError);

                await expect(
                    storage.create({
                        title: '测试计划',
                        content: '# 内容',
                        sessionId: '../escape',
                    })
                ).rejects.toThrow('Invalid sessionId');
            });

            it('应该拒绝包含特殊字符的 sessionId', async () => {
                await expect(
                    storage.create({
                        title: '测试计划',
                        content: '# 内容',
                        sessionId: 'session@123',
                    })
                ).rejects.toThrow(PlanStorageError);
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

            it('应该返回 null 如果 sessionId 无效', async () => {
                const result = await storage.getBySession('');
                expect(result).toBeNull();
            });
        });

        describe('get()', () => {
            it('应该根据 planId 返回 Plan', async () => {
                const meta = await storage.create({
                    title: '测试计划',
                    content: '# 内容',
                    sessionId: 'session-get',
                });

                const result = await storage.get(meta.id);

                expect(result).not.toBeNull();
                expect(result?.meta.id).toBe(meta.id);
                expect(result?.content).toBe('# 内容');
            });

            it('应该返回 null 如果 planId 不存在', async () => {
                const result = await storage.get('plan-nonexistent');
                expect(result).toBeNull();
            });

            it('应该返回 null 如果 planId 无效', async () => {
                const result = await storage.get('');
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
                expect(plans.map((p) => p.title)).toContain('计划1');
                expect(plans.map((p) => p.title)).toContain('计划2');
            });

            it('应该按更新时间降序排序', async () => {
                await storage.create({
                    title: '较早的计划',
                    content: '# 内容',
                    sessionId: 'session-older',
                });

                // 等待一小段时间确保时间戳不同
                await new Promise((resolve) => setTimeout(resolve, 10));

                await storage.create({
                    title: '较新的计划',
                    content: '# 内容',
                    sessionId: 'session-newer',
                });

                const plans = await storage.list();
                expect(plans[0].title).toBe('较新的计划');
                expect(plans[1].title).toBe('较早的计划');
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
                const deleted = await storage.delete('plan-nonexistent');
                expect(deleted).toBe(false);
            });
        });

        describe('deleteBySession()', () => {
            it('应该根据 sessionId 删除计划', async () => {
                await storage.create({
                    title: '要删除的计划',
                    content: '# 内容',
                    sessionId: 'session-delete-by-session',
                });

                const deleted = await storage.deleteBySession('session-delete-by-session');
                expect(deleted).toBe(true);

                const result = await storage.getBySession('session-delete-by-session');
                expect(result).toBeNull();
            });

            it('应该返回 false 如果 sessionId 不存在', async () => {
                const deleted = await storage.deleteBySession('non-existent-session');
                expect(deleted).toBe(false);
            });

            it('应该返回 false 如果 sessionId 无效', async () => {
                const deleted = await storage.deleteBySession('');
                expect(deleted).toBe(false);
            });
        });
    });

    describe('createPlanStorage()', () => {
        it('应该创建 FilePlanStorage', () => {
            const storage = createPlanStorage(testDir);
            expect(storage).toBeInstanceOf(FilePlanStorage);
        });

        it('无参数时应该使用 process.cwd()', () => {
            const storage = createPlanStorage();
            expect(storage).toBeInstanceOf(FilePlanStorage);
        });
    });

    describe('getPlanFilePath()', () => {
        it('应该返回正确的路径格式', () => {
            const filePath = getPlanFilePath('/data', 'session-123');
            expect(filePath).toMatch(/[\\/]data[\\/]plans[\\/]session-123[\\/]plan\.md/);
        });
    });

    describe('边界情况', () => {
        it('应该处理大内容', async () => {
            const largeContent = '# 大内容测试\n\n' + '内容行\n'.repeat(10000);
            await storage.create({
                title: '大内容测试',
                content: largeContent,
                sessionId: 'session-large-content',
            });

            const result = await storage.getBySession('session-large-content');
            expect(result?.content.length).toBeGreaterThan(40000);
        });

        it('应该处理并发创建（同一 session 会覆盖）', async () => {
            const promises = [
                storage.create({
                    title: '并发计划 1',
                    content: '# 内容 1',
                    sessionId: 'session-concurrent',
                }),
                storage.create({
                    title: '并发计划 2',
                    content: '# 内容 2',
                    sessionId: 'session-concurrent',
                }),
            ];

            const results = await Promise.all(promises);
            expect(results[0].title).toBeDefined();
            expect(results[1].title).toBeDefined();

            // 最终只会有一个 Plan
            const plans = await storage.list();
            const concurrentPlans = plans.filter((p) => p.sessionId === 'session-concurrent');
            expect(concurrentPlans.length).toBe(1);
        });
    });
});
