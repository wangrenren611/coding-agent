/**
 * 基础 API 适配器
 *
 * API 适配器的抽象基类，用于处理特定于提供商的
 * 请求/响应转换。
 */

import type { LLMRequest, LLMResponse, LLMRequestMessage, Role } from '../types';

export abstract class BaseAPIAdapter {
    /**
     * 将消息和选项转换为特定于提供商的请求体
     */
    abstract transformRequest(options?: LLMRequest): LLMRequest;

    /**
     * 将特定于提供商的响应转换为标准格式
     */
    abstract transformResponse(response: unknown): LLMResponse;

    /**
     * 获取请求的 HTTP 头（包括身份验证）
     */
    abstract getHeaders(apiKey: string, config?: Record<string, unknown>): Headers;

    /**
     * 获取聊天补全的端点路径
     * 例如：'/v1/chat/completions' 或 '/api/paas/v4/chat/completions'
     */
    abstract getEndpointPath(): string;

    /**
     * 工具方法：检查清理后的消息是否应该发送
     */
    protected isMessageUsable(msg: {
        role: string;
        content?: unknown;
        tool_call_id?: string;
        tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
        }>;
    }): boolean {
        if (!msg) return false;
        const hasContent =
            msg.content !== undefined &&
            msg.content !== null &&
            (typeof msg.content !== 'string' || msg.content !== '') &&
            (!(Array.isArray(msg.content)) || msg.content.length > 0);
        const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
        const hasToolCallId = Boolean(msg.tool_call_id);
        return hasContent || hasToolCalls || hasToolCallId;
    }

    /**
     * 清理消息以用于 API 请求（移除内部字段）
     */
    protected cleanMessage(msg: Array<Record<string, unknown>>): LLMRequestMessage[] {
        const cleaned: LLMRequestMessage[] = [];

        for (const item of msg) {
            const message: LLMRequestMessage = {
                content: String(item.content),
                role:item.role as Role,
            };

            if (item.reasoning_content !== undefined && item.reasoning_content !== null) {
                message.reasoning_content = item.reasoning_content as string;
            }

            if (item.tool_call_id !== undefined && item.tool_call_id !== null) {
                message.tool_call_id = item.tool_call_id as string;
            }

            if (item.tool_calls !== undefined && item.tool_calls !== null) {
                message.tool_calls = item.tool_calls;
            }

            cleaned.push(message);
        }

        return cleaned;
    }
}
