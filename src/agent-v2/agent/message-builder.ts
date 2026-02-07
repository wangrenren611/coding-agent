/**
 * 消息构建器
 * 统一构建各种类型的消息，确保一致性
 */

import { v4 as uuid } from "uuid";
import { FinishReason, LLMResponse, MessageContent, Role, Usage } from "../../providers";
import { Message, MessageType } from "../session/types";
import {
    ToolCall,
    getResponseContent,
    getResponseFinishReason,
    getResponseToolCalls,
    responseHasToolCalls,
} from "./types-internal";

// ==================== 消息构建选项 ====================

export interface BaseMessageOptions {
    messageId?: string;
    role?: Role;
    content?: MessageContent;
    type?: MessageType;
    finish_reason?: FinishReason;
    usage?: Usage;
    id?: string;
}

export interface UserMessageOptions extends BaseMessageOptions {
    content: MessageContent;
}

export interface AssistantMessageOptions extends BaseMessageOptions {
    content?: MessageContent;
    tool_calls?: ToolCall[];
}

export interface ToolMessageOptions extends BaseMessageOptions {
    tool_call_id: string;
    content: string;
    name?: string;
}

// ==================== 消息构建器 ====================

export class MessageBuilder {
    /**
     * 构建用户消息
     */
    static userMessage(options: UserMessageOptions): Message {
        return {
            messageId: options.messageId || uuid(),
            role: options.role || 'user',
            content: options.content,
            type: options.type || 'text',
        };
    }

    /**
     * 构建助手消息（纯文本）
     */
    static assistantMessage(options: AssistantMessageOptions): Message {
        return {
            messageId: options.messageId || uuid(),
            role: options.role || 'assistant',
            content: options.content || '',
            type: options.type || 'text',
            finish_reason: options.finish_reason,
            usage: options.usage,
            id: options.id,
        };
    }

    /**
     * 构建助手工具调用消息
     */
    static assistantToolCallMessage(options: AssistantMessageOptions): Message {
        return {
            messageId: options.messageId || uuid(),
            role: options.role || 'assistant',
            content: options.content || '',
            tool_calls: options.tool_calls,
            type: 'tool-call',
            finish_reason: options.finish_reason,
            usage: options.usage,
            id: options.id,
        };
    }

    /**
     * 构建工具结果消息
     */
    static toolMessage(options: ToolMessageOptions): Message {
        return {
            messageId: options.messageId || uuid(),
            role: 'tool',
            content: options.content,
            tool_call_id: options.tool_call_id,
            name: options.name,
            type: 'tool-result',
        };
    }

    /**
     * 从 LLM 响应构建助手消息
     * 自动判断是文本还是工具调用
     */
    static fromLLMResponse(
        response: LLMResponse,
        messageId?: string
    ): Message {
        const id = messageId || uuid();
        const finishReason = getResponseFinishReason(response);
        const usage = response.usage;

        if (responseHasToolCalls(response)) {
            return this.assistantToolCallMessage({
                messageId: id,
                content: getResponseContent(response),
                tool_calls: getResponseToolCalls(response),
                finish_reason: finishReason,
                usage,
            });
        }

        return this.assistantMessage({
            messageId: id,
            content: getResponseContent(response),
            finish_reason: finishReason,
            usage,
        });
    }

    /**
     * 更新现有消息
     */
    static updateMessage(
        message: Message,
        updates: Partial<Omit<Message, 'messageId'>>
    ): Message {
        return {
            ...message,
            ...updates,
        };
    }

    /**
     * 批量更新消息内容（用于流式累积）
     */
    static updateContent(
        message: Message,
        additionalContent: string,
        options?: {
            id?: string;
            finish_reason?: FinishReason;
        }
    ): Message {
        const currentContent = typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);
        return this.updateMessage(message, {
            content: currentContent + additionalContent,
            id: options?.id ?? message.id,
            finish_reason: options?.finish_reason ?? message.finish_reason,
        });
    }
}

// ==================== 便捷函数 ====================

/**
 * 创建用户消息的便捷函数
 */
export function createUserMessage(content: MessageContent, messageId?: string): Message {
    return MessageBuilder.userMessage({ content, messageId });
}

/**
 * 创建助手文本消息的便捷函数
 */
export function createAssistantMessage(
    content: string,
    options?: Omit<AssistantMessageOptions, 'content'>
): Message {
    return MessageBuilder.assistantMessage({ content, ...options });
}

/**
 * 创建工具调用消息的便捷函数
 */
export function createToolCallMessage(
    toolCalls: ToolCall[],
    options?: Omit<AssistantMessageOptions, 'tool_calls'>
): Message {
    return MessageBuilder.assistantToolCallMessage({ tool_calls: toolCalls, ...options });
}

/**
 * 创建工具结果消息的便捷函数
 */
export function createToolResultMessage(
    toolCallId: string,
    content: string,
    messageId?: string
): Message {
    return MessageBuilder.toolMessage({
        tool_call_id: toolCallId,
        content,
        messageId,
    });
}
