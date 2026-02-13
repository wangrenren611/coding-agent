/**
 * 工具调用修复器
 * 
 * 负责检测和修复异常中断导致的未闭合 tool call
 */

import { v4 as uuid } from 'uuid';
import type { Message } from './types';

/**
 * 工具调用修复结果
 */
export interface RepairResult {
    /** 是否进行了修复 */
    repaired: boolean;
    /** 修复的消息列表 */
    repairedMessages: Message[];
}

/**
 * 工具调用修复器
 * 
 * 用于检测和修复因异常中断而未闭合的 tool call。
 * 当 agent 在执行工具调用过程中崩溃或被终止时，
 * 可能会留下没有对应 tool result 的 tool call。
 */
export class ToolCallRepairer {
    /**
     * 原地修复消息列表中的中断工具调用
     * 
     * @param messages 消息列表（会被原地修改）
     * @param onRepair 每个修复消息的回调（用于持久化）
     * @returns 修复结果
     */
    repairInPlace(
        messages: Message[],
        onRepair?: (message: Message) => void
    ): RepairResult {
        const repairedMessages: Message[] = [];
        let index = 0;
        let repaired = false;

        while (index < messages.length) {
            const current = messages[index];
            const toolCallIds = this.extractToolCallIds(current);

            if (toolCallIds.length === 0) {
                index++;
                continue;
            }

            // 收集后续的 tool 响应
            const { responded, cursor } = this.collectToolResponses(messages, index);

            // 找出缺失响应的 tool calls
            const missingIds = toolCallIds.filter(id => !responded.has(id));

            if (missingIds.length === 0) {
                index = cursor + 1;
                continue;
            }

            // 创建修复消息
            const recovered = missingIds.map(id => this.createInterruptedResult(id));
            
            // 在 cursor 位置插入修复的消息
            messages.splice(cursor, 0, ...recovered);
            repairedMessages.push(...recovered);
            repaired = true;

            // 调用持久化回调
            if (onRepair) {
                for (const msg of recovered) {
                    onRepair(msg);
                }
            }

            // 更新索引：跳过刚插入的消息
            index = cursor + recovered.length;
        }

        return { repaired, repairedMessages };
    }

    /**
     * 仅检测不修复，返回需要修复的消息
     * 
     * @param messages 消息列表
     * @returns 需要修复的消息列表
     */
    detect(messages: Message[]): Message[] {
        const result: Message[] = [];
        let index = 0;

        while (index < messages.length) {
            const current = messages[index];
            const toolCallIds = this.extractToolCallIds(current);

            if (toolCallIds.length === 0) {
                index++;
                continue;
            }

            const { responded, cursor } = this.collectToolResponses(messages, index);
            const missingIds = toolCallIds.filter(id => !responded.has(id));

            if (missingIds.length > 0) {
                result.push(...missingIds.map(id => this.createInterruptedResult(id)));
            }

            index = cursor + 1;
        }

        return result;
    }

    /**
     * 创建中断的工具结果消息
     */
    createInterruptedResult(toolCallId: string): Message {
        return {
            messageId: uuid(),
            role: 'tool',
            type: 'tool-result',
            tool_call_id: toolCallId,
            content: JSON.stringify({
                success: false,
                error: 'TOOL_CALL_INTERRUPTED',
                interrupted: true,
                message: 'Tool execution was interrupted before a result was produced.',
            }),
        };
    }

    // ==================== 私有方法 ====================

    private extractToolCallIds(message: Message): string[] {
        if (message.role !== 'assistant') return [];

        const rawCalls = (message as any).tool_calls;
        if (!Array.isArray(rawCalls)) return [];

        const uniqueIds = new Set<string>();
        for (const call of rawCalls) {
            const callId = call?.id;
            if (typeof callId === 'string' && callId.length > 0) {
                uniqueIds.add(callId);
            }
        }

        return Array.from(uniqueIds);
    }

    private collectToolResponses(
        messages: Message[],
        startIndex: number
    ): { responded: Set<string>; cursor: number } {
        const responded = new Set<string>();
        let cursor = startIndex + 1;

        while (cursor < messages.length && messages[cursor].role === 'tool') {
            const toolCallId = this.extractToolCallId(messages[cursor]);
            if (toolCallId) {
                responded.add(toolCallId);
            }
            cursor++;
        }

        return { responded, cursor };
    }

    private extractToolCallId(message: Message): string | null {
        if (message.role !== 'tool') return null;

        const toolCallId = (message as any).tool_call_id;
        return typeof toolCallId === 'string' && toolCallId.length > 0
            ? toolCallId
            : null;
    }
}
