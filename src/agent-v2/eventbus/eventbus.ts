/**
 * 简单的事件总线实现
 */

import { EventListener, EventMap, EventType } from './types';

/**
 * EventBus - 简单的发布订阅模式事件总线
 *
 * @example
 * ```ts
 * const bus = new EventBus();
 *
 * // 监听事件
 * bus.on(EventType.TASK_START, (data) => {
 *   console.log('Task started:', data.query);
 * });
 *
 * // 发送事件
 * bus.emit(EventType.TASK_START, { query: 'hello', timestamp: Date.now() });
 *
 * // 取消监听
 * bus.off(EventType.TASK_START, listener);
 * ```
 */
export class EventBus {
    /** 事件监听器存储 */
    private listeners: Map<string, Set<EventListener>> = new Map();

    /**
     * 注册事件监听器
     * @param type 事件类型
     * @param listener 监听器函数
     */
    on(type: EventType, listener: EventListener): void {
        const key = type as string;
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key)!.add(listener);
    }

    /**
     * 取消事件监听器
     * @param type 事件类型
     * @param listener 监听器函数
     */
    off(type: EventType, listener: EventListener): void {
        const key = type as string;
        const set = this.listeners.get(key);
        if (set) {
            set.delete(listener);
            if (set.size === 0) {
                this.listeners.delete(key);
            }
        }
    }

    /**
     * 发送事件
     * @param type 事件类型
     * @param data 事件数据
     */
    emit(type: EventType, data: any): void {
        const key = type as string;
        const set = this.listeners.get(key);
        if (set) {
            // 异步执行所有监听器，不阻塞主流程
            for (const listener of set) {
                try {
                    listener(data);
                } catch (error) {
                    // 监听器错误不影响其他监听器
                    console.error(`Event listener error for ${type}:`, error);
                }
            }
        }
    }

    /**
     * 清空所有监听器
     */
    clear(): void {
        this.listeners.clear();
    }

    /**
     * 获取指定事件类型的监听器数量
     * @param type 事件类型
     * @returns 监听器数量
     */
    listenerCount(type: EventType): number {
        return this.listeners.get(type as string)?.size ?? 0;
    }

    /**
     * 移除指定事件类型的所有监听器
     * @param type 事件类型
     */
    removeAllListeners(type?: EventType): void {
        if (type) {
            this.listeners.delete(type as string);
        } else {
            this.listeners.clear();
        }
    }
}
