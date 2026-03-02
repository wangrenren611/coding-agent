/**
 * Formatter 基类
 */

import type { IFormatter, LogRecord } from '../types';

/**
 * Formatter 抽象基类
 */
export abstract class BaseFormatter implements IFormatter {
    /**
     * 格式化日志记录
     */
    abstract format(record: LogRecord): string;

    /**
     * 格式化时间戳
     */
    protected formatTimestamp(timestamp: string): string {
        return timestamp;
    }

    /**
     * 格式化错误对象
     */
    protected formatError(error: LogRecord['error']): string | undefined {
        if (!error) return undefined;
        return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
    }

    /**
     * 安全的 JSON 序列化
     */
    protected safeStringify(obj: unknown): string {
        try {
            return JSON.stringify(obj, null, 2);
        } catch {
            return '[Circular or non-serializable]';
        }
    }
}
