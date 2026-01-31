import { uuid } from "uuidv4";
import { Message, SessionOptions } from "./types";


export class Session {
    private sessionId: string;
    private messages: Message[] = [];
     private systemPrompt: string;
    
    constructor(options: SessionOptions) {
        console.log('Session');
        this.sessionId = uuid();
        this.systemPrompt = options.systemPrompt;
        this.messages = [{
            messageId: 'system',
            role: 'system',
            content: this.systemPrompt,
        }];
    }

    addMessage(message: Message) {
      this.messages.push(message);
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

   compact(){

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
