/**
 * Transport 基类
 */

import type { ITransport, TransportConfig, LogRecord, IFormatter } from '../types';

/**
 * Transport 抽象基类
 */
export abstract class BaseTransport implements ITransport {
    abstract readonly name: string;
    abstract readonly config: TransportConfig;

    protected formatter: IFormatter;

    constructor(formatter: IFormatter) {
        this.formatter = formatter;
    }

    /**
     * 检查是否应该处理此日志记录
     */
    protected shouldLog(record: LogRecord): boolean {
        if (!this.config.enabled) return false;
        const minLevel = this.config.level ?? 0;
        return record.level >= minLevel;
    }

    /**
     * 写入日志记录
     */
    abstract write(record: LogRecord): void | Promise<void>;

    /**
     * 格式化日志记录
     */
    protected format(record: LogRecord): string {
        return this.formatter.format(record);
    }
}
