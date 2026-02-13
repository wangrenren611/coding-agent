/**
 * 基于 MemoryManager 的消息仓储实现
 * 
 * 将 IMemoryManager 适配为 MessageRepository 接口
 */

import type { Message } from '../memory/types';
import type { IMemoryManager } from '../memory/types';
import { MessageRepository, MessageQueryOptions } from './message-repository';


/**
 * MemoryManager 消息仓储实现
 * 
 * 使用现有的 IMemoryManager 作为后端存储
 */
export class MemoryManagerMessageRepository implements MessageRepository {
    constructor(private memoryManager: IMemoryManager) {
        if (!memoryManager) {
            throw new Error('MemoryManager is required');
        }
    }

    async save(sessionId: string, message: Message): Promise<void> {
        await this.memoryManager.addMessageToContext(sessionId, message);
    }

    async saveMany(sessionId: string, messages: Message[]): Promise<void> {
        for (const message of messages) {
            await this.memoryManager.addMessageToContext(sessionId, message);
        }
    }

    async query(options: MessageQueryOptions): Promise<Message[]> {
        // IMemoryManager 没有直接的查询接口
        // 这里需要从 context 中获取消息
        const context = await this.memoryManager.getCurrentContext(options.sessionId);
        if (!context) {
            return [];
        }

        let messages = [...context.messages];

        if (options.role) {
            messages = messages.filter(m => m.role === options.role);
        }

        if (options.startTime !== undefined) {
            messages = messages.filter(m => (Number(m.timestamp) || 0) >= options.startTime!);
        }

        if (options.endTime !== undefined) {
            messages = messages.filter(m => (Number(m.timestamp) || 0) <= options.endTime!);
        }

        const offset = options.offset ?? 0;
        const limit = options.limit ?? messages.length;

        return messages.slice(offset, offset + limit);
    }

    async count(sessionId: string): Promise<number> {
        const context = await this.memoryManager.getCurrentContext(sessionId);
        return context?.messages.length ?? 0;
    }

    async delete(sessionId: string, beforeTime?: number): Promise<void> {
        // 如果指定了时间，则需要清除该时间之前的消息
        if (beforeTime !== undefined) {
            const context = await this.memoryManager.getCurrentContext(sessionId);
            if (context) {
                const filteredMessages = context.messages.filter(
                    m => (Number(m.timestamp) || 0) > beforeTime
                );
                await this.memoryManager.saveCurrentContext({
                    ...context,
                    messages: filteredMessages,
                });
            }
        } else {
            await this.memoryManager.clearContext(sessionId);
        }
    }

    async clear(sessionId: string): Promise<void> {
        await this.memoryManager.clearContext(sessionId);
    }

    async getRecent(sessionId: string, limit = 10): Promise<Message[]> {
        const context = await this.memoryManager.getCurrentContext(sessionId);
        if (!context) {
            return [];
        }
        return context.messages.slice(-limit);
    }
}
