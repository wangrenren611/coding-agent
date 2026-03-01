/**
 * Logger 核心模块
 *
 * 企业级日志系统核心实现
 */

import type { LoggerConfig, LogRecord, LogLevel, LogContext, ITransport, LogMiddleware, LogStats } from './types';
import { LogLevel as Lvl, LogLevelName } from './types';
import { mergeConfig } from './config';
import { JsonFormatter, PrettyFormatter } from './formatters';
import { ConsoleTransport, FileTransport } from './transports';
import { getContextManager } from './middleware/context';

/**
 * 日志器类
 *
 * 企业级日志系统，支持多输出、结构化日志、中间件等功能
 */
export class Logger {
    private config: LoggerConfig;
    private transports: ITransport[] = [];
    private middlewares: LogMiddleware[] = [];
    private stats: LogStats = {
        total: 0,
        byLevel: {},
        errors: 0,
        bufferSize: 0,
    };

    constructor(config?: Partial<LoggerConfig>) {
        this.config = mergeConfig(config);
        this.initTransports();
        this.initMiddlewares();
    }

    /**
     * 初始化 Transport
     */
    private initTransports(): void {
        // 控制台 Transport
        if (this.config.console?.enabled !== false) {
            const consoleFormatter =
                this.config.console?.format === 'json'
                    ? new JsonFormatter()
                    : new PrettyFormatter({
                          colorize: this.config.console?.colorize,
                          showTimestamp: this.config.console?.timestamp,
                      });
            this.transports.push(new ConsoleTransport(this.config.console || {}, consoleFormatter));
        }

        // 文件 Transport
        if (this.config.file?.enabled && this.config.file.filepath) {
            const fileFormatter =
                this.config.file.format === 'pretty'
                    ? new PrettyFormatter({ colorize: false, showTimestamp: true })
                    : new JsonFormatter();
            this.transports.push(new FileTransport(this.config.file, fileFormatter));
        }
    }

    /**
     * 初始化中间件
     */
    private initMiddlewares(): void {
        // 添加默认上下文中间件
        if (this.config.defaultContext) {
            this.middlewares.push((record, next) => {
                record.context = {
                    ...this.config.defaultContext,
                    ...record.context,
                };
                next();
            });
        }

        // 添加敏感字段脱敏中间件
        if (this.config.sensitiveFields && this.config.sensitiveFields.length > 0) {
            this.middlewares.push(this.createSensitiveFieldsMiddleware());
        }
    }

    /**
     * 创建敏感字段脱敏中间件
     */
    private createSensitiveFieldsMiddleware(): LogMiddleware {
        return (record, next) => {
            record.context = this.sanitizeObject(record.context);
            if (record.data) {
                record.data = this.sanitizeObject(record.data);
            }
            next();
        };
    }

    /**
     * 脱敏对象中的敏感字段
     */
    private sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
        if (!obj || typeof obj !== 'object') return obj;

        const result: Record<string, unknown> = {};
        const sensitiveFields = this.config.sensitiveFields || [];

        for (const [key, value] of Object.entries(obj)) {
            if (sensitiveFields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
                result[key] = '[REDACTED]';
            } else if (typeof value === 'object' && value !== null) {
                result[key] = this.sanitizeObject(value as Record<string, unknown>);
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * 添加中间件
     */
    use(middleware: LogMiddleware): this {
        this.middlewares.push(middleware);
        return this;
    }

    /**
     * 添加 Transport
     */
    addTransport(transport: ITransport): this {
        this.transports.push(transport);
        return this;
    }

    /**
     * 创建日志记录
     */
    private createRecord(
        level: LogLevel,
        message: string,
        context?: LogContext,
        error?: Error,
        data?: Record<string, unknown>
    ): LogRecord {
        // 合并全局上下文
        const globalContext = getContextManager().getContext();
        const mergedContext: LogContext = {
            ...globalContext,
            ...context,
        };

        const record: LogRecord = {
            timestamp: new Date().toISOString(),
            level,
            levelName: LogLevelName[level],
            message,
            context: mergedContext,
            data,
        };

        if (error) {
            record.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        }

        return record;
    }

    /**
     * 执行中间件链
     */
    private async executeMiddlewares(record: LogRecord): Promise<void> {
        const middlewares = [...this.middlewares];

        const executeChain = async (index: number): Promise<void> => {
            if (index >= middlewares.length) {
                return;
            }

            const middleware = middlewares[index];
            await new Promise<void>((resolve) => {
                const result = middleware(record, () => {
                    resolve();
                });
                if (result instanceof Promise) {
                    result.then(resolve);
                }
            });

            await executeChain(index + 1);
        };

        await executeChain(0);
    }

    /**
     * 写入日志到所有 Transport
     */
    private writeToTransports(record: LogRecord): void {
        // 检查日志级别
        if (record.level < this.config.level) {
            return;
        }

        for (const transport of this.transports) {
            try {
                transport.write(record);
            } catch (err) {
                // 防止日志写入错误影响主流程
                console.error(`[Logger] Transport write error: ${(err as Error).message}`);
            }
        }

        // 更新统计
        this.stats.total++;
        this.stats.byLevel[record.levelName] = (this.stats.byLevel[record.levelName] || 0) + 1;
        if (record.level >= Lvl.ERROR) {
            this.stats.errors++;
        }
        this.stats.lastRecordTime = record.timestamp;
    }

    /**
     * 内部日志方法
     */
    log(record: LogRecord): void {
        this.executeMiddlewares(record).then(() => {
            this.writeToTransports(record);
        });
    }

    /**
     * 通用日志方法
     */
    async logWithLevel(
        level: LogLevel,
        message: string,
        context?: LogContext,
        error?: Error,
        data?: Record<string, unknown>
    ): Promise<void> {
        const record = this.createRecord(level, message, context, error, data);
        await this.executeMiddlewares(record);
        this.writeToTransports(record);
    }

    /**
     * TRACE 级别日志
     */
    trace(message: string, context?: LogContext): void {
        this.logWithLevel(Lvl.TRACE, message, context);
    }

    /**
     * DEBUG 级别日志
     */
    debug(message: string, context?: LogContext, data?: Record<string, unknown>): void {
        this.logWithLevel(Lvl.DEBUG, message, context, undefined, data);
    }

    /**
     * INFO 级别日志
     */
    info(message: string, context?: LogContext, data?: Record<string, unknown>): void {
        this.logWithLevel(Lvl.INFO, message, context, undefined, data);
    }

    /**
     * WARN 级别日志
     */
    warn(message: string, context?: LogContext, data?: Record<string, unknown>): void {
        this.logWithLevel(Lvl.WARN, message, context, undefined, data);
    }

    /**
     * ERROR 级别日志
     */
    error(message: string, error?: Error, context?: LogContext): void {
        this.logWithLevel(Lvl.ERROR, message, context, error);
    }

    /**
     * FATAL 级别日志
     */
    fatal(message: string, error?: Error, context?: LogContext): void {
        this.logWithLevel(Lvl.FATAL, message, context, error);
    }

    /**
     * 创建子日志器
     */
    child(module: string, additionalContext?: LogContext): ChildLogger {
        return new ChildLogger(this, module, additionalContext);
    }

    /**
     * 获取统计信息
     */
    getStats(): LogStats {
        return { ...this.stats };
    }

    /**
     * 刷新所有 Transport
     */
    async flush(): Promise<void> {
        for (const transport of this.transports) {
            if (transport.flush) {
                await transport.flush();
            }
        }
    }

    /**
     * 关闭日志器
     */
    async close(): Promise<void> {
        await this.flush();
        for (const transport of this.transports) {
            if (transport.close) {
                await transport.close();
            }
        }
        this.transports = [];
    }

    /**
     * 获取配置
     */
    getConfig(): LoggerConfig {
        return { ...this.config };
    }
}

/**
 * 子日志器
 *
 * 带有预设模块名和上下文的日志器
 */
export class ChildLogger {
    private parent: Logger;
    private module: string;
    private context: LogContext;

    constructor(parent: Logger, module: string, context?: LogContext) {
        this.parent = parent;
        this.module = module;
        this.context = context || {};
    }

    private mergeContext(context?: LogContext): LogContext {
        return { ...this.context, ...context };
    }

    trace(message: string, context?: LogContext): void {
        this.parent.trace(`[${this.module}] ${message}`, this.mergeContext(context));
    }

    debug(message: string, context?: LogContext, data?: Record<string, unknown>): void {
        this.parent.debug(`[${this.module}] ${message}`, this.mergeContext(context), data);
    }

    info(message: string, context?: LogContext, data?: Record<string, unknown>): void {
        this.parent.info(`[${this.module}] ${message}`, this.mergeContext(context), data);
    }

    warn(message: string, context?: LogContext, data?: Record<string, unknown>): void {
        this.parent.warn(`[${this.module}] ${message}`, this.mergeContext(context), data);
    }

    error(message: string, error?: Error, context?: LogContext): void {
        this.parent.error(`[${this.module}] ${message}`, error, this.mergeContext(context));
    }

    fatal(message: string, error?: Error, context?: LogContext): void {
        this.parent.fatal(`[${this.module}] ${message}`, error, this.mergeContext(context));
    }

    /**
     * 创建更深层级的子日志器
     */
    child(subModule: string, additionalContext?: LogContext): ChildLogger {
        return new ChildLogger(this.parent, `${this.module}:${subModule}`, {
            ...this.context,
            ...additionalContext,
        });
    }
}

// 默认日志器实例
let defaultLogger: Logger | null = null;

/**
 * 获取默认日志器
 */
export function getLogger(): Logger {
    if (!defaultLogger) {
        defaultLogger = new Logger();
    }
    return defaultLogger;
}

/**
 * 创建日志器
 */
export function createLogger(config?: Partial<LoggerConfig>): Logger {
    return new Logger(config);
}

/**
 * 设置默认日志器
 */
export function setDefaultLogger(logger: Logger): void {
    defaultLogger = logger;
}
