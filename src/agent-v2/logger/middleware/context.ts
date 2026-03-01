/**
 * 上下文中间件
 */

import type { LogRecord, LogContext, LogMiddleware } from '../types';

/**
 * 创建上下文中间件
 * 为所有日志记录添加默认上下文
 */
export function createContextMiddleware(defaultContext: LogContext): LogMiddleware {
    return (record: LogRecord, next: () => void) => {
        // 合并上下文
        record.context = {
            ...defaultContext,
            ...record.context,
        };
        next();
    };
}

/**
 * 上下文管理器
 * 用于在异步调用链中传递上下文
 */
export class ContextManager {
    private static instance: ContextManager;
    private storage: Map<string, LogContext> = new Map();
    private currentContext: LogContext = {};

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
        this.currentContext = { ...context };
    }

    /**
     * 获取当前上下文
     */
    getContext(): LogContext {
        return { ...this.currentContext };
    }

    /**
     * 更新当前上下文
     */
    updateContext(context: Partial<LogContext>): void {
        this.currentContext = {
            ...this.currentContext,
            ...context,
        };
    }

    /**
     * 清除当前上下文
     */
    clearContext(): void {
        this.currentContext = {};
    }

    /**
     * 在指定上下文中执行函数
     */
    withContext<T>(context: LogContext, fn: () => T): T {
        const previousContext = this.currentContext;
        this.currentContext = { ...previousContext, ...context };
        try {
            return fn();
        } finally {
            this.currentContext = previousContext;
        }
    }

    /**
     * 异步版本：在指定上下文中执行异步函数
     */
    async withContextAsync<T>(context: LogContext, fn: () => Promise<T>): Promise<T> {
        const previousContext = this.currentContext;
        this.currentContext = { ...previousContext, ...context };
        try {
            return await fn();
        } finally {
            this.currentContext = previousContext;
        }
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
