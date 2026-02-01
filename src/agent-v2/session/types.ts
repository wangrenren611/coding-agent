import { BaseLLMMessage, FinishReason, Role, ToolCall } from "../../providers";

export type MessageType = 'text' |'tool-call'|'tool-result';

export type Message = {
    messageId: string;
    role:  Role;
    content: string;
    type?: MessageType;
    finish_reason?: FinishReason;
    id?: string;
} & BaseLLMMessage;

export type SessionOptions = {
    systemPrompt: string;
}

