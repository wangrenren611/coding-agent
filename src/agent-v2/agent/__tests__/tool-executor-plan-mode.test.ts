/**
 * ToolExecutor Plan Mode 阻止逻辑测试
 *
 * 测试 ToolExecutor 在 Plan 模式下如何阻止写操作
 */

import { describe, it, expect } from 'vitest';
import { ToolExecutor, ToolExecutorConfig } from '../core/tool-executor';
import { ToolRegistry } from '../../tool/registry';
import { createPlanModeToolRegistry, createDefaultToolRegistry } from '../../tool';
import { LLMResponseInvalidError } from '../errors';
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
        function: {
            name: toolName,
            arguments: JSON.stringify(args),
        },
    };
}

// ==================== 测试 ====================

describe('ToolExecutor Plan Mode 阻止逻辑', () => {
    describe('getPlanModeBlockedTools', () => {
        it('Plan Mode 下应该阻止写工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const writeToolCall = createToolCall('write_file', {
                filePath: '/tmp/test.txt',
                content: 'test',
            });

            // 应该抛出错误
            await expect(executor.execute([writeToolCall], 'msg-1', 'test content')).rejects.toThrow();

            try {
                await executor.execute([writeToolCall], 'msg-1', 'test content');
            } catch (error) {
                expect(error).toBeInstanceOf(LLMResponseInvalidError);
                expect((error as Error).message).toContain('Plan Mode');
                expect((error as Error).message).toContain('write_file');
            }
        });

        it('Plan Mode 下应该阻止 bash 工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const bashToolCall = createToolCall('bash', {
                command: 'echo test',
            });

            await expect(executor.execute([bashToolCall], 'msg-1', 'test content')).rejects.toThrow(
                LLMResponseInvalidError
            );
        });

        it('Plan Mode 下应该阻止 precise_replace 工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const editToolCall = createToolCall('precise_replace', {
                filePath: '/tmp/test.txt',
                oldText: 'old',
                newText: 'new',
            });

            await expect(executor.execute([editToolCall], 'msg-1', 'test content')).rejects.toThrow(
                LLMResponseInvalidError
            );
        });

        it('Plan Mode 下应该阻止 batch_replace 工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const batchToolCall = createToolCall('batch_replace', {
                filePath: '/tmp/test.txt',
                replacements: [],
            });

            await expect(executor.execute([batchToolCall], 'msg-1', 'test content')).rejects.toThrow(
                LLMResponseInvalidError
            );
        });

        it('Plan Mode 下应该允许 read_file 工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const readToolCall = createToolCall('read_file', {
                filePath: '/etc/hosts', // 这个文件通常存在
            });

            // 这个应该不会抛出 Plan Mode 错误（可能因为文件不存在失败，但不是 Plan Mode 阻止）
            try {
                await executor.execute([readToolCall], 'msg-1', 'test content');
            } catch (error) {
                // 如果抛出错误，不应该是 Plan Mode 错误
                if (error instanceof LLMResponseInvalidError) {
                    expect((error as Error).message).not.toContain('Plan Mode');
                }
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
            } catch (error) {
                // 如果抛出错误，不应该是 Plan Mode 阻止
                if (error instanceof LLMResponseInvalidError) {
                    expect((error as Error).message).not.toContain('Plan Mode');
                }
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
            } catch (error) {
                if (error instanceof LLMResponseInvalidError) {
                    expect((error as Error).message).not.toContain('Plan Mode');
                }
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
            } catch (error) {
                if (error instanceof LLMResponseInvalidError) {
                    expect((error as Error).message).not.toContain('Plan Mode');
                }
            }
        });

        it('应该正确报告多个被阻止的工具', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            const toolCalls = [
                createToolCall('write_file', { filePath: '/tmp/a.txt', content: 'a' }),
                createToolCall('bash', { command: 'ls' }),
                createToolCall('read_file', { filePath: '/tmp/b.txt' }),
            ];

            try {
                await executor.execute(toolCalls, 'msg-1', 'test content');
            } catch (error) {
                expect(error).toBeInstanceOf(LLMResponseInvalidError);
                const message = (error as Error).message;
                expect(message).toContain('Plan Mode');
                // 应该包含所有被阻止的工具
                expect(message).toContain('write_file');
                expect(message).toContain('bash');
            }
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
    describe('getPlanModeBlockedTools 内部逻辑', () => {
        it('空工具列表应该抛出验证错误', async () => {
            const config = createMockConfig(true);
            const executor = new ToolExecutor(config);

            // 空工具列表应该抛出验证错误
            await expect(executor.execute([], 'msg-1', 'test content')).rejects.toThrow();
        });
    });
});
