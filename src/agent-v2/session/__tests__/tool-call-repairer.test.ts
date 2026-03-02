/**
 * ToolCallRepairer 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCallRepairer } from '../tool-call-repairer';
import type { Message } from '../types';

describe('ToolCallRepairer', () => {
    let repairer: ToolCallRepairer;

    beforeEach(() => {
        repairer = new ToolCallRepairer();
    });

    // 辅助函数：创建 assistant 消息（带 tool_calls）
    function createAssistantWithToolCalls(toolCallIds: string[]): Message {
        return {
            messageId: 'assistant-1',
            role: 'assistant',
            content: '',
            tool_calls: toolCallIds.map((id) => ({
                id,
                type: 'function',
                function: { name: 'test_tool', arguments: '{}' },
            })),
        };
    }

    // 辅助函数：创建 tool 结果消息
    function createToolResult(toolCallId: string, content: string = '{"success": true}'): Message {
        return {
            messageId: `result-${toolCallId}`,
            role: 'tool',
            type: 'tool-result',
            tool_call_id: toolCallId,
            content,
        };
    }

    describe('repairInPlace', () => {
        it('应该不修改没有 tool_calls 的消息', () => {
            const messages: Message[] = [
                { messageId: 'sys', role: 'system', content: 'System' },
                { messageId: 'user', role: 'user', content: 'Hello' },
                { messageId: 'asst', role: 'assistant', content: 'Hi' },
            ];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(false);
            expect(result.repairedMessages).toHaveLength(0);
            expect(messages).toHaveLength(3);
        });

        it('应该不修改已有响应的 tool_calls', () => {
            const messages: Message[] = [
                createAssistantWithToolCalls(['call-1', 'call-2']),
                createToolResult('call-1'),
                createToolResult('call-2'),
            ];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(false);
            expect(result.repairedMessages).toHaveLength(0);
            expect(messages).toHaveLength(3);
        });

        it('应该修复缺失响应的 tool_calls', () => {
            const messages: Message[] = [
                createAssistantWithToolCalls(['call-1', 'call-2']),
                createToolResult('call-1'),
                // call-2 缺失响应
            ];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(true);
            expect(result.repairedMessages).toHaveLength(1);
            expect(messages).toHaveLength(3); // 原始 2 + 修复的 1

            // 检查修复的消息（应该在最后一个位置）
            const repaired = messages[2];
            expect(repaired.role).toBe('tool');
            expect(repaired.tool_call_id).toBe('call-2');
            expect(repaired.content).toContain('TOOL_CALL_INTERRUPTED');
        });

        it('应该修复所有缺失的 tool_calls', () => {
            const messages: Message[] = [
                createAssistantWithToolCalls(['call-1', 'call-2', 'call-3']),
                // 所有响应都缺失
            ];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(true);
            expect(result.repairedMessages).toHaveLength(3);
            expect(messages).toHaveLength(4); // 原始 1 + 修复的 3
        });

        it('应该正确处理多个 assistant 消息', () => {
            const messages: Message[] = [
                createAssistantWithToolCalls(['call-1']),
                createToolResult('call-1'),
                { messageId: 'user-2', role: 'user', content: 'Next question' },
                createAssistantWithToolCalls(['call-2']),
                // call-2 缺失响应
            ];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(true);
            expect(result.repairedMessages).toHaveLength(1);
            expect(messages).toHaveLength(5); // 原始 4 + 修复的 1
        });

        it('应该调用 onRepair 回调', () => {
            const messages: Message[] = [createAssistantWithToolCalls(['call-1'])];
            const repairedList: Message[] = [];

            repairer.repairInPlace(messages, (msg) => {
                repairedList.push(msg);
            });

            expect(repairedList).toHaveLength(1);
            expect(repairedList[0].tool_call_id).toBe('call-1');
        });

        it('应该将修复消息插入到正确位置', () => {
            const messages: Message[] = [
                createAssistantWithToolCalls(['call-1']),
                { messageId: 'user-2', role: 'user', content: 'Next' },
            ];

            repairer.repairInPlace(messages);

            // 修复消息应该在 assistant 和下一个 user 之间
            expect(messages[0].role).toBe('assistant');
            expect(messages[1].role).toBe('tool'); // 修复的消息
            expect(messages[1].tool_call_id).toBe('call-1');
            expect(messages[2].role).toBe('user');
        });
    });

    describe('detect', () => {
        it('应该返回需要修复的消息但不修改原数组', () => {
            const messages: Message[] = [createAssistantWithToolCalls(['call-1'])];

            const detected = repairer.detect(messages);

            expect(detected).toHaveLength(1);
            expect(messages).toHaveLength(1); // 原数组未被修改
        });

        it('应该返回空数组当不需要修复时', () => {
            const messages: Message[] = [createAssistantWithToolCalls(['call-1']), createToolResult('call-1')];

            const detected = repairer.detect(messages);

            expect(detected).toHaveLength(0);
        });
    });

    describe('createInterruptedResult', () => {
        it('应该创建正确格式的中断结果', () => {
            const result = repairer.createInterruptedResult('call-123');

            expect(result.role).toBe('tool');
            expect(result.type).toBe('tool-result');
            expect(result.tool_call_id).toBe('call-123');
            expect(result.messageId).toBeDefined();
            expect(result.content).toContain('TOOL_CALL_INTERRUPTED');
            expect(result.content).toContain('interrupted');
        });

        it('应该创建有效的 JSON 内容', () => {
            const result = repairer.createInterruptedResult('call-123');
            const parsed = JSON.parse(result.content as string);

            expect(parsed.success).toBe(false);
            expect(parsed.error).toBe('TOOL_CALL_INTERRUPTED');
            expect(parsed.interrupted).toBe(true);
        });
    });

    describe('边界情况', () => {
        it('应该处理空消息数组', () => {
            const messages: Message[] = [];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(false);
            expect(result.repairedMessages).toHaveLength(0);
        });

        it('应该处理没有 tool_calls 的 assistant 消息', () => {
            const messages: Message[] = [{ messageId: 'asst', role: 'assistant', content: 'Hello' }];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(false);
        });

        it('应该处理空的 tool_calls 数组', () => {
            const messages: Message[] = [
                {
                    messageId: 'asst',
                    role: 'assistant',
                    content: '',
                    tool_calls: [],
                },
            ];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(false);
        });

        it('应该处理部分响应的情况', () => {
            const messages: Message[] = [
                createAssistantWithToolCalls(['call-1', 'call-2', 'call-3']),
                createToolResult('call-1'),
                // call-2 和 call-3 缺失
            ];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(true);
            expect(result.repairedMessages).toHaveLength(2);
        });

        it('应该处理混合的 user 和 tool 消息', () => {
            const messages: Message[] = [
                createAssistantWithToolCalls(['call-1']),
                { messageId: 'user-2', role: 'user', content: 'Continue' },
                // call-1 缺失响应
            ];

            const result = repairer.repairInPlace(messages);

            expect(result.repaired).toBe(true);
            // 修复消息应该在 assistant 和 user 之间
            expect(messages[1].role).toBe('tool');
            expect(messages[2].role).toBe('user');
        });
    });
});
