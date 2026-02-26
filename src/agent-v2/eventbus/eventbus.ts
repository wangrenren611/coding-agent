/**
 * 简单的事件总线实现
 */

export { EventType } from './types';
import { BaseEventData, EventListener, EventMap, EventType } from './types';

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
    private listeners: Map<EventType, Set<EventListener<BaseEventData>>> = new Map();

    /**
     * 注册事件监听器
     * @param type 事件类型
     * @param listener 监听器函数
     */
    on<T extends EventType>(type: T, listener: EventListener<EventMap[T]>): void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener as EventListener<BaseEventData>);
    }

    /**
     * 取消事件监听器
     * @param type 事件类型
     * @param listener 监听器函数
     */
    off<T extends EventType>(type: T, listener: EventListener<EventMap[T]>): void {
        const set = this.listeners.get(type);
        if (set) {
            set.delete(listener as EventListener<BaseEventData>);
            if (set.size === 0) {
                this.listeners.delete(type);
            }
        }
    }

    /**
     * 发送事件
     * @param type 事件类型
     * @param data 事件数据
     */
    emit<T extends EventType>(type: T, data: EventMap[T]): void {
        const set = this.listeners.get(type);
        if (set) {
            // 异步执行所有监听器，不阻塞主流程
            for (const listener of set) {
                try {
                    void (listener as EventListener<EventMap[T]>)(data);
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
        return this.listeners.get(type)?.size ?? 0;
    }

    /**
     * 移除指定事件类型的所有监听器
     * @param type 事件类型
     */
    removeAllListeners(type?: EventType): void {
        if (type) {
            this.listeners.delete(type);
        } else {
            this.listeners.clear();
        }
    }
}
