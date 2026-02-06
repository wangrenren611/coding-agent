import { BaseLLMMessage, FinishReason, Role, ToolCall, Usage } from "../../providers";

export type MessageType = 'text' |'tool-call'|'tool-result' | 'summary';

export type Message = {
    messageId: string;
    role:  Role;
    content: string;
    type?: MessageType;
    finish_reason?: FinishReason;
    id?: string;
    /** 该消息的 Token 使用情况 */
    usage?: Usage;
} & BaseLLMMessage;

export type SessionOptions = {
    systemPrompt: string;
}

