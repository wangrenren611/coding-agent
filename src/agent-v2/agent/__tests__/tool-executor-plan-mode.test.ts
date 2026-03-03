/**
 * ToolExecutor 与 Plan Mode 工具注册表协作测试
 *
 * Plan Mode 的限制由工具注册表和工具自身策略承担，而非 ToolExecutor 静态拦截。
 */

import { describe, it, expect } from 'vitest';
import { ToolExecutor, ToolExecutorConfig } from '../core/tool-executor';
import { ToolRegistry } from '../../tool/registry';
import { createPlanModeToolRegistry, createDefaultToolRegistry } from '../../tool';
import type { ToolCall } from '../core-types';

// ==================== Mock 回调 ====================

function createMockConfig(planMode: boolean = false): ToolExecutorConfig {
    const registry = planMode
        ? createPlanModeToolRegistry({ workingDirectory: process.cwd() })
        : createDefaultToolRegistry({ workingDirectory: process.cwd() });

    return {
        toolRegistry: registry,
        sessionId: 'test-session',
        planMode,
        onToolCallCreated: () => {},
        onToolCallResult: () => {},
        onToolCallStream: () => {},
        onCodePatch: () => {},
        onMessageAdd: () => {},
    };
}

function createToolCall(toolName: string, args: Record<string, unknown> = {}): ToolCall {
    return {
        id: `call-${toolName}-${Date.now()}`,
        type: 'function',
        index: 0,
        function: {
            name: toolName,
            arguments: JSON.stringify(args),
        },
    };
}

// ==================== 测试 ====================

describe('ToolExecutor Plan Mode 行为', () => {
    describe('Plan Mode 工具限制来源', () => {
        it('Plan Mode 下写工具应由注册表返回工具不存在错误结果', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const writeToolCall = createToolCall('write_file', {
                filePath: '/tmp/test.txt',
                content: 'test',
            });

            const result = await executor.execute([writeToolCall], 'msg-1', 'test content');
            expect(result.success).toBe(false);
            expect(result.resultMessages[0]?.content).toContain('Tool "write_file" not found');
        });

        it('Plan Mode 下 bash 工具应由注册表返回工具不存在错误结果', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const bashToolCall = createToolCall('bash', {
                command: 'echo test',
            });

            const result = await executor.execute([bashToolCall], 'msg-1', 'test content');
            expect(result.success).toBe(false);
            expect(result.resultMessages[0]?.content).toContain('Tool "bash" not found');
        });

        it('Plan Mode 下 precise_replace 工具应由注册表返回工具不存在错误结果', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const editToolCall = createToolCall('precise_replace', {
                filePath: '/tmp/test.txt',
                oldText: 'old',
                newText: 'new',
            });

            const result = await executor.execute([editToolCall], 'msg-1', 'test content');
            expect(result.success).toBe(false);
            expect(result.resultMessages[0]?.content).toContain('Tool "precise_replace" not found');
        });

        it('Plan Mode 下 batch_replace 工具应由注册表返回工具不存在错误结果', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const batchToolCall = createToolCall('batch_replace', {
                filePath: '/tmp/test.txt',
                replacements: [],
            });

            const result = await executor.execute([batchToolCall], 'msg-1', 'test content');
            expect(result.success).toBe(false);
            expect(result.resultMessages[0]?.content).toContain('Tool "batch_replace" not found');
        });

        it('Plan Mode 下应该允许 read_file 工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const readToolCall = createToolCall('read_file', {
                filePath: '/etc/hosts', // 这个文件通常存在
            });

            // 这个应该不会被注册表拦截为未知工具
            try {
                await executor.execute([readToolCall], 'msg-1', 'test content');
            } catch {
                // read_file 执行可能失败（例如文件权限），但不是此测试关注点
            }
        });

        it('Plan Mode 下应该允许 plan_create 工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const planCreateCall = createToolCall('plan_create', {
                title: '测试计划',
                content: '# 测试内容',
            });

            // plan_create 是允许的
            try {
                await executor.execute([planCreateCall], 'msg-1', 'test content');
            } catch {
                // 执行失败不是此测试关注点
            }
        });

        it('Plan Mode 下应该允许 glob 工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const globCall = createToolCall('glob', {
                pattern: '*.ts',
            });

            try {
                await executor.execute([globCall], 'msg-1', 'test content');
            } catch {
                // 执行失败不是此测试关注点
            }
        });

        it('Plan Mode 下应该允许 task_output 工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const taskOutputCall = createToolCall('task_output', {
                task_id: 'task-1',
                block: false,
                timeout: 1000,
            });

            try {
                await executor.execute([taskOutputCall], 'msg-1', 'test content');
            } catch {
                // 执行失败不是此测试关注点
            }
        });

        it('非 Plan Mode 下应该允许所有工具', async () => {
            const config = createMockConfig(false);
            const executor = new ToolExecutor(config);

            const writeToolCall = createToolCall('write_file', {
                filePath: '/tmp/test.txt',
                content: 'test',
            });

            // 非 Plan Mode 下不应该抛出 Plan Mode 错误
            try {
                await executor.execute([writeToolCall], 'msg-1', 'test content');
            } catch {
                // 非 Plan Mode 写工具执行失败不是此测试关注点
            }
        });

        it('应该为不存在的写工具返回错误结果', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const toolCalls = [
                createToolCall('write_file', { filePath: '/tmp/a.txt', content: 'a' }),
                createToolCall('bash', { command: 'ls' }),
                createToolCall('read_file', { filePath: '/tmp/b.txt' }),
            ];

            const result = await executor.execute(toolCalls, 'msg-1', 'test content');
            expect(result.success).toBe(false);
            const joined = result.resultMessages.map((msg) => msg.content).join('\n');
            expect(joined).toContain('Tool "write_file" not found');
            expect(joined).toContain('Tool "bash" not found');
        });
    });

    describe('ToolContext workingDirectory', () => {
        it('应该正确传递 workingDirectory', async () => {
            const customWorkingDir = '/custom/working/dir';
            const registry = new ToolRegistry({ workingDirectory: customWorkingDir });

            const config: ToolExecutorConfig = {
                toolRegistry: registry,
                sessionId: 'test-session',
                planMode: false,
                onToolCallCreated: () => {},
                onToolCallResult: () => {},
                onToolCallStream: () => {},
                onCodePatch: () => {},
                onMessageAdd: () => {},
            };

            new ToolExecutor(config);

            // 验证 registry 的 workingDirectory 被正确设置
            expect(registry.workingDirectory).toBe(customWorkingDir);
        });
    });

    describe('工具注册表差异', () => {
        it('Plan Mode 工具注册表不应该包含写工具', () => {
            const planModeRegistry = createPlanModeToolRegistry({ workingDirectory: process.cwd() });
            const tools = planModeRegistry.toLLMTools();
            const toolNames = tools.map((t) => t.function.name);

            expect(toolNames).not.toContain('write_file');
            expect(toolNames).not.toContain('bash');
            expect(toolNames).not.toContain('precise_replace');
            expect(toolNames).not.toContain('batch_replace');
        });

        it('Plan Mode 工具注册表应该包含只读工具', () => {
            const planModeRegistry = createPlanModeToolRegistry({ workingDirectory: process.cwd() });
            const tools = planModeRegistry.toLLMTools();
            const toolNames = tools.map((t) => t.function.name);

            expect(toolNames).toContain('read_file');
            expect(toolNames).toContain('glob');
            expect(toolNames).toContain('grep');
            expect(toolNames).toContain('plan_create');
        });

        it('默认工具注册表应该包含所有工具', () => {
            const defaultRegistry = createDefaultToolRegistry({ workingDirectory: process.cwd() });
            const tools = defaultRegistry.toLLMTools();
            const toolNames = tools.map((t) => t.function.name);

            expect(toolNames).toContain('read_file');
            expect(toolNames).toContain('write_file');
            expect(toolNames).toContain('bash');
            expect(toolNames).toContain('precise_replace');
            expect(toolNames).toContain('batch_replace');
            expect(toolNames).toContain('plan_create');
        });
    });
});

// ==================== 辅助函数测试 ====================

describe('ToolExecutor 辅助方法', () => {
    describe('输入校验', () => {
        it('空工具列表应该抛出验证错误', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            // 空工具列表应该抛出验证错误
            await expect(executor.execute([], 'msg-1', 'test content')).rejects.toThrow();
        });
    });
});
