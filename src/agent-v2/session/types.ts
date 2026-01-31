import { BaseLLMMessage, Role } from "../../providers";

export type MessageType = 'text' |'tool-call'|'tool-result';

export type Message = {
    messageId: string;
    role:  Role;
    content: string;
    type?: MessageType;
} & BaseLLMMessage;

export type SessionOptions = {
    systemPrompt: string;
}
