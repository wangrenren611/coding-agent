/**
 * 日志模块类型定义
 *
 * 企业级日志系统，支持多输出、结构化日志、日志轮转等功能
 */

/**
 * 日志级别
 */
export enum LogLevel {
    TRACE = 0,
    DEBUG = 10,
    INFO = 20,
    WARN = 30,
    ERROR = 40,
    FATAL = 50,
}

/**
 * 日志级别名称映射
 */
export const LogLevelName: Record<LogLevel, string> = {
    [LogLevel.TRACE]: 'TRACE',
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.FATAL]: 'FATAL',
};

/**
 * 日志上下文信息
 */
export interface LogContext {
    /** 会话 ID */
    sessionId?: string;
    /** 请求 ID */
    requestId?: string;
    /** 追踪 ID */
    traceId?: string;
    /** Agent ID */
    agentId?: string;
    /** 工具名称 */
    toolName?: string;
    /** 模型名称 */
    model?: string;
    /** 用户 ID */
    userId?: string;
    /** 租户 ID (多租户场景) */
    tenantId?: string;
    /** 额外元数据 */
    [key: string]: unknown;
}

/**
 * 日志记录结构
 */
export interface LogRecord {
    /** 时间戳 (ISO 8601) */
    timestamp: string;
    /** 日志级别 */
    level: LogLevel;
    /** 日志级别名称 */
    levelName: string;
    /** 日志消息 */
    message: string;
    /** 日志上下文 */
    context: LogContext;
    /** 错误信息 */
    error?: {
        name: string;
        message: string;
        stack?: string;
        code?: string;
    };
    /** 额外数据 */
    data?: Record<string, unknown>;
    /** 来源模块 */
    module?: string;
    /** 来源文件 */
    file?: string;
    /** 来源行号 */
    line?: number;
}

/**
 * Transport 基础配置
 */
export interface TransportConfig {
    /** 是否启用 */
    enabled?: boolean;
    /** 最小日志级别 */
    level?: LogLevel;
    /** 格式化器类型 */
    format?: 'json' | 'pretty';
    /** 是否包含时间戳 */
    timestamp?: boolean;
    /** 是否包含堆栈信息 */
    stack?: boolean;
}

/**
 * 控制台 Transport 配置
 */
export interface ConsoleTransportConfig extends TransportConfig {
    /** 颜色输出 */
    colorize?: boolean;
    /** 输出流 */
    stream?: 'stdout' | 'stderr';
}

/**
 * 文件 Transport 配置
 */
export interface FileTransportConfig extends TransportConfig {
    /** 日志文件路径 */
    filepath: string;
    /** 日志轮转配置 */
    rotation?: {
        /** 是否启用轮转 */
        enabled: boolean;
        /** 最大文件大小 (字节) */
        maxSize: number;
        /** 最大文件数量 */
        maxFiles: number;
        /** 轮转策略 */
        strategy: 'size' | 'time' | 'both';
        /** 时间轮转间隔 (毫秒) */
        interval?: number;
    };
    /** 是否同步写入 */
    sync?: boolean;
    /** 写入缓冲区大小 */
    bufferSize?: number;
    /** 缓冲区刷新间隔 (毫秒) */
    flushInterval?: number;
}

/**
 * 远程 Transport 配置 (预留扩展)
 */
export interface RemoteTransportConfig extends TransportConfig {
    /** 远程服务 URL */
    url: string;
    /** 请求头 */
    headers?: Record<string, string>;
    /** 批量发送配置 */
    batch?: {
        /** 是否启用批量发送 */
        enabled: boolean;
        /** 批量大小 */
        size: number;
        /** 刷新间隔 (毫秒) */
        flushInterval: number;
    };
    /** 重试配置 */
    retry?: {
        /** 最大重试次数 */
        maxRetries: number;
        /** 重试延迟 (毫秒) */
        delay: number;
    };
}

/**
 * 日志模块配置
 */
export interface LoggerConfig {
    /** 服务名称 */
    service: string;
    /** 环境 */
    env: 'development' | 'staging' | 'production' | 'test';
    /** 全局最小日志级别 */
    level: LogLevel;
    /** 默认上下文 */
    defaultContext?: LogContext;
    /** 控制台配置 */
    console?: ConsoleTransportConfig;
    /** 文件配置 */
    file?: FileTransportConfig;
    /** 远程配置 (预留) */
    remote?: RemoteTransportConfig;
    /** 是否记录 Agent 事件 */
    logAgentEvents?: boolean;
    /** 敏感字段列表 (这些字段会被脱敏) */
    sensitiveFields?: string[];
}

/**
 * Transport 接口
 */
export interface ITransport {
    /** Transport 名称 */
    readonly name: string;
    /** Transport 配置 */
    readonly config: TransportConfig;
    /** 写入日志 */
    write(record: LogRecord): void | Promise<void>;
    /** 刷新缓冲区 */
    flush?(): void | Promise<void>;
    /** 关闭 Transport */
    close?(): void | Promise<void>;
}

/**
 * Formatter 接口
 */
export interface IFormatter {
    /** 格式化日志记录 */
    format(record: LogRecord): string;
}

/**
 * 日志中间件函数类型
 */
export type LogMiddleware = (record: LogRecord, next: () => void | Promise<void>) => void | Promise<void>;

/**
 * 日志统计信息
 */
export interface LogStats {
    /** 总记录数 */
    total: number;
    /** 各级别统计 */
    byLevel: Record<string, number>;
    /** 错误数 */
    errors: number;
    /** 最后一条记录时间 */
    lastRecordTime?: string;
    /** 缓冲区大小 */
    bufferSize: number;
}
