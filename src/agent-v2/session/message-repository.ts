/**
 * 消息仓储接口 - Session 持久化解耦
 * 
 * 定义消息存储的抽象接口，支持多种存储实现
 */

import type { Message } from '../memory/types';


/**
 * 消息查询选项
 */
export interface MessageQueryOptions {
    /** 会话 ID */
    sessionId: string;
    /** 起始时间 */
    startTime?: number;
    /** 结束时间 */
    endTime?: number;
    /** 角色过滤 */
    role?: Message['role'];
    /** 数量限制 */
    limit?: number;
    /** 偏移量 */
    offset?: number;
}


/**
 * 消息仓储接口
 * 
 * 抽象消息的持久化操作，便于实现不同的存储后端
 */
export interface MessageRepository {
    /**
     * 保存消息
     * @param sessionId 会话 ID
     * @param message 消息
     */
    save(sessionId: string, message: Message): Promise<void>;

    /**
     * 批量保存消息
     * @param sessionId 会话 ID
     * @param messages 消息列表
     */
    saveMany(sessionId: string, messages: Message[]): Promise<void>;

    /**
     * 查询消息
     * @param options 查询选项
     * @returns 消息列表
     */
    query(options: MessageQueryOptions): Promise<Message[]>;

    /**
     * 获取会话消息数量
     * @param sessionId 会话 ID
     * @returns 消息数量
     */
    count(sessionId: string): Promise<number>;

    /**
     * 删除会话消息
     * @param sessionId 会话 ID
     * @param beforeTime 删除此时间之前的消息（可选）
     */
    delete(sessionId: string, beforeTime?: number): Promise<void>;

    /**
     * 清空会话
     * @param sessionId 会话 ID
     */
    clear(sessionId: string): Promise<void>;

    /**
     * 获取会话最新消息
     * @param sessionId 会话 ID
     * @param limit 返回数量
     */
    getRecent(sessionId: string, limit?: number): Promise<Message[]>;
}


/**
 * 内存消息仓储实现
 * 
 * 简单的内存存储实现，适用于开发和测试
 */
export class InMemoryMessageRepository implements MessageRepository {
    private sessions: Map<string, Message[]> = new Map();

    async save(sessionId: string, message: Message): Promise<void> {
        const messages = this.sessions.get(sessionId) ?? [];
        messages.push(message);
        this.sessions.set(sessionId, messages);
    }

    async saveMany(sessionId: string, messages: Message[]): Promise<void> {
        const existing = this.sessions.get(sessionId) ?? [];
        existing.push(...messages);
        this.sessions.set(sessionId, existing);
    }

    async query(options: MessageQueryOptions): Promise<Message[]> {
        let messages = this.sessions.get(options.sessionId) ?? [];
        
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
        return (this.sessions.get(sessionId) ?? []).length;
    }

    async delete(sessionId: string, beforeTime?: number): Promise<void> {
        const messages = this.sessions.get(sessionId) ?? [];
        
        if (beforeTime !== undefined) {
            const filtered = messages.filter(m => (Number(m.timestamp) || 0) > beforeTime);
            this.sessions.set(sessionId, filtered);
        } else {
            this.sessions.delete(sessionId);
        }
    }

    async clear(sessionId: string): Promise<void> {
        this.sessions.delete(sessionId);
    }

    async getRecent(sessionId: string, limit = 10): Promise<Message[]> {
        const messages = this.sessions.get(sessionId) ?? [];
        return messages.slice(-limit);
    }
}
