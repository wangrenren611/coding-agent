import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutor } from '../core/tool-executor';
import { AgentAbortedError, LLMResponseInvalidError, PermissionDecisionError } from '../errors';
import { ToolCallValidationError } from '../../tool/registry';
import type { ToolCall } from '../core-types';
import type { ToolRegistry } from '../../tool/registry';
import type { PermissionEngine } from '../../security/permission-engine';
import { createDefaultPermissionEngine } from '../../security/permission-engine';

function createToolCall(callId: string, toolName: string, args: Record<string, unknown>): ToolCall {
    return {
        id: callId,
        type: 'function',
        index: 0,
        function: {
            name: toolName,
            arguments: JSON.stringify(args),
        },
    };
}

describe('ToolExecutor protocol events', () => {
    const cleanupPaths: string[] = [];

    afterEach(() => {
        for (const filePath of cleanupPaths.splice(0, cleanupPaths.length)) {
            try {
                fs.rmSync(filePath, { recursive: true, force: true });
            } catch {
                // ignore cleanup errors in tests
            }
        }
    });

    it('should emit tool stream and code patch for file mutation', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-executor-protocol-'));
        cleanupPaths.push(tempDir);
        const filePath = path.join(tempDir, 'demo.txt');
        fs.writeFileSync(filePath, 'old-line\n', 'utf8');

        const streamSpy = vi.fn();
        const patchSpy = vi.fn();
        const resultSpy = vi.fn();
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(
                async (
                    _toolCalls: ToolCall[],
                    context?: {
                        onToolStream?: (toolCallId: string, toolName: string, output: string) => void;
                    }
                ) => {
                    context?.onToolStream?.('call-1', 'write_file', 'partial-output');
                    fs.writeFileSync(filePath, 'new-line\n', 'utf8');
                    return [
                        {
                            tool_call_id: 'call-1',
                            result: {
                                success: true,
                                output: 'done',
                            },
                        },
                    ];
                }
            ),
        } as unknown as ToolRegistry;

        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            onToolCallStream: streamSpy,
            onCodePatch: patchSpy,
            onToolCallResult: resultSpy,
        });

        await executor.execute([createToolCall('call-1', 'write_file', { filePath, content: 'new-line\n' })], 'msg-1');

        expect(streamSpy).toHaveBeenCalledWith('call-1', 'partial-output', 'msg-1');
        expect(resultSpy).toHaveBeenCalledTimes(1);
        expect(patchSpy).toHaveBeenCalledTimes(1);
        expect(patchSpy.mock.calls[0][1]).toContain('---');
        expect(patchSpy.mock.calls[0][1]).toContain('+++');
        expect(patchSpy.mock.calls[0][1]).toContain('-old-line');
        expect(patchSpy.mock.calls[0][1]).toContain('+new-line');
    });

    it('should skip code patch emit when file content is unchanged', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-executor-protocol-'));
        cleanupPaths.push(tempDir);
        const filePath = path.join(tempDir, 'same.txt');
        fs.writeFileSync(filePath, 'same\n', 'utf8');

        const streamSpy = vi.fn();
        const patchSpy = vi.fn();
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(async () => [
                {
                    tool_call_id: 'call-2',
                    result: { success: true, output: 'noop' },
                },
            ]),
        } as unknown as ToolRegistry;

        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            onToolCallStream: streamSpy,
            onCodePatch: patchSpy,
        });

        await executor.execute([createToolCall('call-2', 'write_file', { filePath, content: 'same\n' })], 'msg-2');

        expect(streamSpy).toHaveBeenCalledWith('call-2', 'noop', 'msg-2');
        expect(patchSpy).not.toHaveBeenCalled();
    });

    it('should map invalid tool calls to LLMResponseInvalidError', async () => {
        const registry = {
            validateToolCalls: vi.fn(() => {
                throw new ToolCallValidationError('LLM response tool_calls[0].id is missing');
            }),
            execute: vi.fn(),
        } as unknown as ToolRegistry;

        const createdSpy = vi.fn();
        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            onToolCallCreated: createdSpy,
        });

        await expect(
            executor.execute([createToolCall('call-3', 'read_file', { filePath: 'x' })], 'msg-3')
        ).rejects.toThrow(LLMResponseInvalidError);
        expect(createdSpy).not.toHaveBeenCalled();
        expect(registry.execute).not.toHaveBeenCalled();
    });

    it('should bypass permission engine when enablePermissionEngine=false', async () => {
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(async () => [
                {
                    tool_call_id: 'call-4',
                    result: { success: true, output: 'ok' },
                },
            ]),
        } as unknown as ToolRegistry;

        const permissionEngine = {
            evaluate: vi.fn(() => ({
                effect: 'deny',
                reason: 'blocked by test policy',
                source: 'rule',
            })),
        } as unknown as PermissionEngine;

        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            enablePermissionEngine: false,
            permissionEngine,
        });

        await executor.execute([createToolCall('call-4', 'write_file', { filePath: 'x', content: 'y' })], 'msg-4');

        expect(permissionEngine.evaluate).not.toHaveBeenCalled();
        expect(registry.execute).toHaveBeenCalledTimes(1);
    });

    it('should enforce permission rules when enablePermissionEngine=true', async () => {
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(async () => []),
        } as unknown as ToolRegistry;

        const permissionEngine = {
            evaluate: vi.fn(() => ({
                effect: 'deny',
                reason: 'blocked by test policy',
                source: 'rule',
            })),
        } as unknown as PermissionEngine;

        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            enablePermissionEngine: true,
            permissionEngine,
        });

        await expect(
            executor.execute([createToolCall('call-5', 'write_file', { filePath: 'x', content: 'y' })], 'msg-5')
        ).rejects.toThrow(PermissionDecisionError);
        expect(permissionEngine.evaluate).toHaveBeenCalledTimes(1);
        expect(registry.execute).not.toHaveBeenCalled();
    });

    it('should require approval when permission rule effect is ask', async () => {
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(async () => []),
        } as unknown as ToolRegistry;

        const permissionEngine = createDefaultPermissionEngine({
            rules: [{ effect: 'ask', tool: 'write_file', reason: 'manual approval required' }],
        });
        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            enablePermissionEngine: true,
            permissionEngine,
        });

        await expect(
            executor.execute([createToolCall('call-6', 'write_file', { filePath: 'x', content: 'y' })], 'msg-6')
        ).rejects.toThrow(PermissionDecisionError);
        await expect(
            executor.execute([createToolCall('call-7', 'write_file', { filePath: 'x', content: 'y' })], 'msg-7')
        ).rejects.toThrow(/PERMISSION_ASK_REQUIRED/);
        expect(registry.execute).not.toHaveBeenCalled();
    });

    it('should continue execution when ask callback approves', async () => {
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(async () => [
                {
                    tool_call_id: 'call-8',
                    result: { success: true, output: 'ok-after-approval' },
                },
            ]),
        } as unknown as ToolRegistry;

        const permissionEngine = createDefaultPermissionEngine({
            rules: [{ effect: 'ask', tool: 'write_file', reason: 'manual approval required' }],
        });
        const askSpy = vi.fn(async () => true);
        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            enablePermissionEngine: true,
            permissionEngine,
            onPermissionAsk: askSpy,
        });

        await executor.execute([createToolCall('call-8', 'write_file', { filePath: 'x', content: 'y' })], 'msg-8');

        expect(askSpy).toHaveBeenCalledTimes(1);
        expect(registry.execute).toHaveBeenCalledTimes(1);
    });

    it('should flag bash allowlist bypass in tool context after approved legacy bash ask', async () => {
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(
                async (
                    _toolCalls: ToolCall[],
                    context?: {
                        isAllowlistBypassed?: (toolCallId: string, toolName: string) => boolean;
                    }
                ) => {
                    const bypassed = context?.isAllowlistBypassed?.('call-8b', 'bash');
                    expect(bypassed).toBe(true);
                    return [
                        {
                            tool_call_id: 'call-8b',
                            result: { success: true, output: 'ok-after-bash-approval' },
                        },
                    ];
                }
            ),
        } as unknown as ToolRegistry;

        const permissionEngine = createDefaultPermissionEngine({
            useDefaultSources: false,
            rules: [{ effect: 'ask', tool: 'bash', source: 'legacy_bash', reason: 'manual approval required' }],
        });
        const askSpy = vi.fn(async () => true);
        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            enablePermissionEngine: true,
            permissionEngine,
            onPermissionAsk: askSpy,
        });

        await executor.execute([createToolCall('call-8b', 'bash', { command: 'custom-cli --help' })], 'msg-8b');

        expect(askSpy).toHaveBeenCalledTimes(1);
        expect(registry.execute).toHaveBeenCalledTimes(1);
    });

    it('should batch same ask decision in one execution and prompt once', async () => {
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(
                async (
                    _toolCalls: ToolCall[],
                    context?: {
                        isAllowlistBypassed?: (toolCallId: string, toolName: string) => boolean;
                    }
                ) => {
                    expect(context?.isAllowlistBypassed?.('call-b1', 'bash')).toBe(true);
                    expect(context?.isAllowlistBypassed?.('call-b2', 'bash')).toBe(true);
                    return [
                        { tool_call_id: 'call-b1', result: { success: true, output: 'ok-1' } },
                        { tool_call_id: 'call-b2', result: { success: true, output: 'ok-2' } },
                    ];
                }
            ),
        } as unknown as ToolRegistry;

        const permissionEngine = createDefaultPermissionEngine({
            useDefaultSources: false,
            rules: [{ effect: 'ask', tool: 'bash', source: 'legacy_bash', reason: 'manual approval required' }],
        });
        const askSpy = vi.fn(async () => true);
        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            enablePermissionEngine: true,
            permissionEngine,
            onPermissionAsk: askSpy,
        });

        await executor.execute(
            [
                createToolCall('call-b1', 'bash', { command: 'custom-cli-a --help' }),
                createToolCall('call-b2', 'bash', { command: 'custom-cli-b --help' }),
            ],
            'msg-batch'
        );

        expect(askSpy).toHaveBeenCalledTimes(1);
        expect(registry.execute).toHaveBeenCalledTimes(1);
    });

    it('should abort execution when ask callback rejects', async () => {
        const registry = {
            validateToolCalls: vi.fn(),
            execute: vi.fn(async () => []),
        } as unknown as ToolRegistry;

        const permissionEngine = createDefaultPermissionEngine({
            rules: [{ effect: 'ask', tool: 'write_file', reason: 'manual approval required' }],
        });
        const executor = new ToolExecutor({
            toolRegistry: registry,
            sessionId: 's-1',
            enablePermissionEngine: true,
            permissionEngine,
            onPermissionAsk: async () => false,
        });

        await expect(
            executor.execute([createToolCall('call-9', 'write_file', { filePath: 'x', content: 'y' })], 'msg-9')
        ).rejects.toThrow(AgentAbortedError);
        expect(registry.execute).not.toHaveBeenCalled();
    });
});
