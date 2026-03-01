/**
 * 上下文中间件
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogRecord, LogContext, LogMiddleware } from '../types';

/**
 * 创建上下文中间件
 * 为所有日志记录添加默认上下文
 */
export function createContextMiddleware(defaultContext: LogContext): LogMiddleware {
    return (record: LogRecord, next: () => void) => {
        record.context = {
            ...defaultContext,
            ...record.context,
        };
        next();
    };
}

/**
 * 上下文管理器
 * 使用 AsyncLocalStorage 在异步调用链中隔离上下文，避免并发串写。
 */
export class ContextManager {
    private static instance: ContextManager;
    private storage: Map<string, LogContext> = new Map();
    private readonly asyncStorage = new AsyncLocalStorage<LogContext>();
    private fallbackContext: LogContext = {};

    private constructor() {}

    static getInstance(): ContextManager {
        if (!ContextManager.instance) {
            ContextManager.instance = new ContextManager();
        }
        return ContextManager.instance;
    }

    /**
     * 设置当前上下文
     */
    setContext(context: LogContext): void {
        const next = { ...context };
        this.fallbackContext = next;
        this.asyncStorage.enterWith(next);
    }

    /**
     * 获取当前上下文
     */
    getContext(): LogContext {
        const active = this.asyncStorage.getStore();
        if (active) {
            return { ...active };
        }
        return { ...this.fallbackContext };
    }

    /**
     * 更新当前上下文
     */
    updateContext(context: Partial<LogContext>): void {
        const next = {
            ...this.getContext(),
            ...context,
        };
        this.fallbackContext = next;
        this.asyncStorage.enterWith(next);
    }

    /**
     * 清除当前上下文
     */
    clearContext(): void {
        this.fallbackContext = {};
        this.asyncStorage.enterWith({});
    }

    /**
     * 在指定上下文中执行函数
     */
    withContext<T>(context: LogContext, fn: () => T): T {
        const merged = { ...this.getContext(), ...context };
        return this.asyncStorage.run(merged, fn);
    }

    /**
     * 异步版本：在指定上下文中执行异步函数
     */
    async withContextAsync<T>(context: LogContext, fn: () => Promise<T>): Promise<T> {
        const merged = { ...this.getContext(), ...context };
        return this.asyncStorage.run(merged, fn);
    }

    /**
     * 保存上下文到存储
     */
    saveContext(id: string, context: LogContext): void {
        this.storage.set(id, context);
    }

    /**
     * 从存储加载上下文
     */
    loadContext(id: string): LogContext | undefined {
        return this.storage.get(id);
    }

    /**
     * 删除存储的上下文
     */
    deleteContext(id: string): void {
        this.storage.delete(id);
    }
}

/**
 * 获取全局上下文管理器实例
 */
export function getContextManager(): ContextManager {
    return ContextManager.getInstance();
}
