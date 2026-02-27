/**
 * Plan Tools 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PlanCreateTool } from '../tools';
import type { ToolContext } from '../../tool/base';

describe('Plan Tools', () => {
    const testDir = path.join(process.cwd(), 'test-plans-tools');
    let tool: PlanCreateTool;
    let context: ToolContext;

    beforeEach(() => {
        tool = new PlanCreateTool();
        context = {
            environment: 'test',
            platform: process.platform,
            time: new Date().toISOString(),
            workingDirectory: testDir,
            sessionId: 'test-session-1',
        };
    });

    afterEach(async () => {
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    describe('PlanCreateTool', () => {
        it('应该有正确的 name', () => {
            expect(tool.name).toBe('plan_create');
        });

        it('应该有 description', () => {
            expect(tool.description).toBeDefined();
            expect(tool.description.length).toBeGreaterThan(0);
        });

        it('应该创建计划成功', async () => {
            const result = await tool.execute(
                {
                    title: '测试计划',
                    content: '# 测试计划\n\n## 步骤\n1. 步骤一\n2. 步骤二',
                },
                context
            );

            expect(result.success).toBe(true);
            expect(result.metadata).toBeDefined();
            expect((result.metadata as { title: string }).title).toBe('测试计划');
            expect((result.metadata as { sessionId: string }).sessionId).toBe('test-session-1');
            expect(result.output).toContain('测试计划');
            expect(result.output).toContain('Session: test-session-1');
        });

        it('应该返回错误如果没有 sessionId', async () => {
            const result = await tool.execute(
                {
                    title: '测试计划',
                    content: '# 内容',
                },
                { ...context, sessionId: undefined }
            );

            expect(result.success).toBe(false);
            expect(result.output).toContain('Session ID');
        });

        it('应该返回错误如果 sessionId 无效', async () => {
            const result = await tool.execute(
                {
                    title: '测试计划',
                    content: '# 内容',
                },
                { ...context, sessionId: '../escape' }
            );

            expect(result.success).toBe(false);
            expect(result.output).toContain('Invalid session ID');
        });

        it('应该将内容写入文件', async () => {
            await tool.execute(
                {
                    title: '文件测试',
                    content: '# 文件测试内容\n\n测试段落',
                },
                context
            );

            const planPath = path.join(testDir, 'plans', 'test-session-1', 'plan.md');
            const content = await fs.readFile(planPath, 'utf-8');

            expect(content).toContain('# 文件测试内容');
            expect(content).toContain('测试段落');
        });

        it('应该使用 workingDirectory 作为存储目录', async () => {
            const customDir = path.join(process.cwd(), 'test-plans-custom');
            try {
                await tool.execute(
                    {
                        title: '自定义目录测试',
                        content: '# 内容',
                    },
                    {
                        ...context,
                        workingDirectory: customDir,
                        sessionId: 'custom-session',
                    }
                );

                const planPath = path.join(customDir, 'plans', 'custom-session', 'plan.md');
                const exists = await fs
                    .access(planPath)
                    .then(() => true)
                    .catch(() => false);
                expect(exists).toBe(true);
            } finally {
                try {
                    await fs.rm(customDir, { recursive: true, force: true });
                } catch {
                    // ignore
                }
            }
        });

        it('应该优先使用 planBaseDir 而非 workingDirectory', async () => {
            const planDir = path.join(process.cwd(), 'test-plans-planbasedir');
            const workDir = path.join(process.cwd(), 'test-plans-workdir');
            try {
                await tool.execute(
                    {
                        title: 'planBaseDir 优先级测试',
                        content: '# planBaseDir 测试内容',
                    },
                    {
                        ...context,
                        workingDirectory: workDir,
                        planBaseDir: planDir, // 应该优先使用这个
                        sessionId: 'planbasedir-session',
                    }
                );

                // 验证文件创建在 planBaseDir 目录，而非 workingDirectory
                const planPath = path.join(planDir, 'plans', 'planbasedir-session', 'plan.md');
                const content = await fs.readFile(planPath, 'utf-8');
                expect(content).toContain('# planBaseDir 测试内容');

                // 验证没有创建在 workDir
                const wrongPath = path.join(workDir, 'plans', 'planbasedir-session', 'plan.md');
                const wrongExists = await fs
                    .access(wrongPath)
                    .then(() => true)
                    .catch(() => false);
                expect(wrongExists).toBe(false);
            } finally {
                try {
                    await fs.rm(planDir, { recursive: true, force: true });
                    await fs.rm(workDir, { recursive: true, force: true });
                } catch {
                    // ignore
                }
            }
        });

        it('应该处理 planBaseDir 不存在的情况（自动创建）', async () => {
            const nonExistentDir = path.join(process.cwd(), 'test-plans-auto-create', 'nested', 'dir');
            try {
                const result = await tool.execute(
                    {
                        title: '自动创建目录测试',
                        content: '# 自动创建测试',
                    },
                    {
                        ...context,
                        planBaseDir: nonExistentDir,
                        sessionId: 'auto-create-session',
                    }
                );

                expect(result.success).toBe(true);

                // 验证目录被自动创建
                const planPath = path.join(nonExistentDir, 'plans', 'auto-create-session', 'plan.md');
                const exists = await fs
                    .access(planPath)
                    .then(() => true)
                    .catch(() => false);
                expect(exists).toBe(true);
            } finally {
                try {
                    await fs.rm(path.join(process.cwd(), 'test-plans-auto-create'), {
                        recursive: true,
                        force: true,
                    });
                } catch {
                    // ignore
                }
            }
        });
    });
});
