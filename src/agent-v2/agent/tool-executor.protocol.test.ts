import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutor } from './core/tool-executor';
import { LLMResponseInvalidError } from './errors';
import { ToolCallValidationError } from '../tool/registry';
import type { ToolCall } from './core-types';

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
        } as unknown as LLMProvider;

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
        } as unknown as LLMProvider;

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
        } as unknown as LLMProvider;

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
});
