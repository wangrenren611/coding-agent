import { v4 as uuid } from "uuid";
import { Message, SessionOptions } from "./types";
import fs from 'fs';

export class Session {
  private sessionId: string;
  private messages: Message[] = [];
  private systemPrompt: string;

  constructor(options: SessionOptions) {
    this.sessionId = uuid();
    this.systemPrompt = options.systemPrompt;
    this.messages = [{
      messageId: 'system',
      role: 'system',
      content: this.systemPrompt,
    }];
  }
 
  /**
   * 添加或更新消息
   * - 如果 message.id 存在且与最后一条消息的 id 相同，则更新最后一条消息
   * - 否则添加新消息
   * @returns 返回消息的 messageId
   */
  addMessage(message: Message): string {
    const messageIdentifier = message.messageId;
    const lastMessage = this.getLastMessage();

    // 如果是同一条消息的更新，替换最后一条消息
    if (messageIdentifier && lastMessage?.messageId === messageIdentifier) {
      this.messages[this.messages.length - 1] = message;
      return messageIdentifier;
    }

    // 添加新消息
    const messageId = message.messageId;
    const newMessage: Message = {
      ...message,
      messageId,
    };
    this.messages.push(newMessage);
    return messageId;
  }

  getMessages() {
    return this.messages;
  }

  getSessionId() {
    return this.sessionId;
  }

  clearMessages() {
    this.messages = [];
  }

  getMessageCount() {
    return this.messages.length;
  }

  getLastMessage() {
    return this.messages[this.messages.length - 1];
  }

  getFirstMessage() {
    return this.messages[0];
  }

  compact() {

  }

  contextLeft() {
    //   return this.messages.slice(0, this.messages.length - 1);

  }
  /**
  * 计算 Token 使用量
  */
  calculateTokens(): number {
    return this.messages.reduce((acc, msg) => acc + msg.content.length, 0);
  }

}
