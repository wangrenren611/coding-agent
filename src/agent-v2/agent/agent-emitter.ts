/**
 * Agent 事件发射器
 *
 * 统一管理所有 Agent 消息事件的发射逻辑，消除重复代码
 */

import { AgentMessageType, AgentMessage } from './stream-types';
import { AgentStatus } from './types';
import type { StreamCallback } from './types';
import type { Usage } from '../../providers';
import type { ToolCall } from './core-types';
import { safeToolResultToString } from '../util';

/**
 * 累积使用量
 */
export interface CumulativeUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

/**
 * 事件发射器配置
 */
export interface AgentEmitterConfig {
    /** 流式回调函数 */
    streamCallback?: StreamCallback;
    /** 会话 ID */
    sessionId: string;
    /** 时间戳提供函数 */
    getTimestamp: () => number;
}

/**
 * emit 方法使用的消息类型（不包含 sessionId 和 timestamp，由 emit 方法自动添加）
 * 使用索引签名来支持各种消息类型
 */
type EmitMessage = {
    type: AgentMessageType;
    payload: unknown;
    msgId?: string;
};

/**
 * Agent 事件发射器
 *
 * 封装所有流式消息的发射逻辑，提供统一的 API
 */
export class AgentEmitter {
    private config: AgentEmitterConfig;
    private cumulativeUsage: CumulativeUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    };

    constructor(config: AgentEmitterConfig) {
        this.config = config;
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<AgentEmitterConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 重置累积使用量
     */
    resetCumulativeUsage(): void {
        this.cumulativeUsage = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };
    }

    /**
     * 获取累积使用量
     */
    getCumulativeUsage(): CumulativeUsage {
        return { ...this.cumulativeUsage };
    }

    // ==================== 状态事件 ====================

    emitStatus(state: AgentStatus, message: string, msgId?: string): void {
        this.emit({
            type: AgentMessageType.STATUS,
            payload: { state, message },
            ...(msgId && { msgId }),
        });
    }

    emitError(error: string, phase?: string): void {
        this.emit({
            type: AgentMessageType.ERROR,
            payload: {
                error,
                ...(phase ? { phase } : {}),
            },
        });
    }

    // ==================== 文本事件 ====================

    emitTextStart(messageId: string): void {
        this.emit({
            type: AgentMessageType.TEXT_START,
            payload: { content: '' },
            msgId: messageId,
        });
    }

    emitTextDelta(content: string, messageId: string): void {
        this.emit({
            type: AgentMessageType.TEXT_DELTA,
            payload: { content },
            msgId: messageId,
        });
    }

    emitTextComplete(messageId: string): void {
        this.emit({
            type: AgentMessageType.TEXT_COMPLETE,
            payload: { content: '' },
            msgId: messageId,
        });
    }

    // ==================== 推理事件 ====================

    emitReasoningStart(messageId: string): void {
        this.emit({
            type: AgentMessageType.REASONING_START,
            payload: { content: '' },
            msgId: messageId,
        });
    }

    emitReasoningDelta(content: string, messageId: string): void {
        this.emit({
            type: AgentMessageType.REASONING_DELTA,
            payload: { content },
            msgId: messageId,
        });
    }

    emitReasoningComplete(messageId: string): void {
        this.emit({
            type: AgentMessageType.REASONING_COMPLETE,
            payload: { content: '' },
            msgId: messageId,
        });
    }

    // ==================== 工具调用事件 ====================

    emitToolCallCreated(toolCalls: ToolCall[], messageId: string, content?: string): void {
        this.emit({
            type: AgentMessageType.TOOL_CALL_CREATED,
            payload: {
                tool_calls: toolCalls.map((item) => ({
                    callId: item.id,
                    toolName: item.function.name,
                    args: item.function.arguments,
                })),
                content: content || '',
            },
            msgId: messageId,
        });
    }

    emitToolCallResult(toolCallId: string, result: unknown, status: 'success' | 'error', messageId: string): void {
        this.emit({
            type: AgentMessageType.TOOL_CALL_RESULT,
            payload: {
                callId: toolCallId,
                result: safeToolResultToString(result),
                status,
            },
            msgId: messageId,
        });
    }

    emitToolCallStream(toolCallId: string, output: string, messageId?: string): void {
        this.emit({
            type: AgentMessageType.TOOL_CALL_STREAM,
            payload: {
                callId: toolCallId,
                output,
            },
            ...(messageId ? { msgId: messageId } : {}),
        });
    }

    emitCodePatch(filePath: string, diff: string, messageId: string, language?: string): void {
        this.emit({
            type: AgentMessageType.CODE_PATCH,
            payload: {
                path: filePath,
                diff,
                ...(language ? { language } : {}),
            },
            msgId: messageId,
        });
    }

    // ==================== Usage 事件 ====================

    emitUsageUpdate(usage: Usage, messageId?: string): CumulativeUsage {
        // 累加使用量
        this.cumulativeUsage.prompt_tokens += usage.prompt_tokens;
        this.cumulativeUsage.completion_tokens += usage.completion_tokens;
        // total_tokens 用累加后的值计算，确保一致性
        this.cumulativeUsage.total_tokens = this.cumulativeUsage.prompt_tokens + this.cumulativeUsage.completion_tokens;

        this.emit({
            type: AgentMessageType.USAGE_UPDATE,
            payload: {
                usage,
                cumulative: { ...this.cumulativeUsage },
            },
            ...(messageId ? { msgId: messageId } : {}),
        });

        return { ...this.cumulativeUsage };
    }

    // ==================== 私有方法 ====================

    private emit(message: EmitMessage): void {
        this.config.streamCallback?.({
            ...message,
            sessionId: this.config.sessionId,
            timestamp: this.config.getTimestamp(),
        } as AgentMessage);
    }
}
