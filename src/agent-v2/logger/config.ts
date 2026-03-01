/**
 * 日志模块配置
 */

import path from 'node:path';
import type { LoggerConfig, LogLevel } from './types';
import { LogLevel as Lvl } from './types';

function parseLogLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
    if (!raw) return fallback;
    const value = Number(raw);
    const validLevels = new Set<LogLevel>([Lvl.TRACE, Lvl.DEBUG, Lvl.INFO, Lvl.WARN, Lvl.ERROR, Lvl.FATAL]);
    return validLevels.has(value as LogLevel) ? (value as LogLevel) : fallback;
}

function parseBoolean(raw: string | undefined): boolean | undefined {
    if (!raw) return undefined;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return undefined;
}

function parseNumber(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
}

function parseFormat(raw: string | undefined): 'json' | 'pretty' | undefined {
    if (!raw) return undefined;
    const value = raw.trim().toLowerCase();
    return value === 'json' || value === 'pretty' ? value : undefined;
}

function parseStream(raw: string | undefined): 'stdout' | 'stderr' | undefined {
    if (!raw) return undefined;
    const value = raw.trim().toLowerCase();
    return value === 'stdout' || value === 'stderr' ? value : undefined;
}

function parseRotationStrategy(raw: string | undefined): 'size' | 'time' | 'both' | undefined {
    if (!raw) return undefined;
    const value = raw.trim().toLowerCase();
    return value === 'size' || value === 'time' || value === 'both' ? value : undefined;
}

function buildFilepathFromEnv(basePath: string): string | undefined {
    const explicitPath = process.env.LOG_FILE_PATH?.trim();
    if (explicitPath) return explicitPath;

    const logDir = process.env.LOG_DIR?.trim();
    const logFileName = process.env.LOG_FILE_NAME?.trim();
    if (!logDir && !logFileName) return undefined;

    const fallbackDir = path.dirname(basePath);
    const fallbackName = path.basename(basePath);
    return path.join(logDir || fallbackDir, logFileName || fallbackName);
}

function getEnvOverrides(baseConfig: LoggerConfig): Partial<LoggerConfig> {
    const consoleLevel = parseLogLevel(process.env.LOG_CONSOLE_LEVEL, baseConfig.console?.level ?? baseConfig.level);
    const fileLevel = parseLogLevel(process.env.LOG_FILE_LEVEL, baseConfig.file?.level ?? baseConfig.level);
    const baseFilepath = baseConfig.file?.filepath ?? './logs/agent.log';
    const baseRotation = baseConfig.file?.rotation ?? {
        enabled: true,
        maxSize: 10 * 1024 * 1024,
        maxFiles: 5,
        strategy: 'size' as const,
        interval: undefined,
    };

    const filePath = buildFilepathFromEnv(baseFilepath);
    const sensitiveFields = process.env.LOG_SENSITIVE_FIELDS
        ? process.env.LOG_SENSITIVE_FIELDS.split(',')
              .map((field) => field.trim())
              .filter(Boolean)
        : undefined;

    return {
        service: process.env.LOG_SERVICE?.trim() || baseConfig.service,
        level: parseLogLevel(process.env.LOG_LEVEL, baseConfig.level),
        logAgentEvents: parseBoolean(process.env.LOG_AGENT_EVENTS) ?? baseConfig.logAgentEvents,
        sensitiveFields: sensitiveFields || baseConfig.sensitiveFields,
        console: {
            enabled: parseBoolean(process.env.LOG_CONSOLE_ENABLED),
            level: consoleLevel,
            format: parseFormat(process.env.LOG_CONSOLE_FORMAT),
            colorize: parseBoolean(process.env.LOG_CONSOLE_COLORIZE),
            timestamp: parseBoolean(process.env.LOG_CONSOLE_TIMESTAMP),
            stream: parseStream(process.env.LOG_CONSOLE_STREAM),
        },
        file: {
            enabled: parseBoolean(process.env.LOG_FILE_ENABLED),
            level: fileLevel,
            filepath: filePath || baseFilepath,
            format: parseFormat(process.env.LOG_FILE_FORMAT),
            sync: parseBoolean(process.env.LOG_FILE_SYNC),
            bufferSize: parseNumber(process.env.LOG_FILE_BUFFER_SIZE),
            flushInterval: parseNumber(process.env.LOG_FILE_FLUSH_INTERVAL),
            rotation: {
                enabled: parseBoolean(process.env.LOG_FILE_ROTATION_ENABLED) ?? baseRotation.enabled,
                maxSize: parseNumber(process.env.LOG_FILE_ROTATION_MAX_SIZE) ?? baseRotation.maxSize,
                maxFiles: parseNumber(process.env.LOG_FILE_ROTATION_MAX_FILES) ?? baseRotation.maxFiles,
                strategy: parseRotationStrategy(process.env.LOG_FILE_ROTATION_STRATEGY) ?? baseRotation.strategy,
                interval: parseNumber(process.env.LOG_FILE_ROTATION_INTERVAL) ?? baseRotation.interval,
            },
        },
    };
}

/**
 * 默认日志配置
 */
export const defaultLoggerConfig: LoggerConfig = {
    service: 'coding-agent',
    env: (process.env.NODE_ENV as LoggerConfig['env']) || 'development',
    level: parseLogLevel(process.env.LOG_LEVEL, Lvl.INFO),
    console: {
        enabled: true,
        level: Lvl.TRACE,
        format: 'pretty',
        colorize: true,
        timestamp: true,
    },
    file: {
        enabled: false,
        level: Lvl.DEBUG,
        filepath: './logs/agent.log',
        format: 'json',
        timestamp: true,
        rotation: {
            enabled: true,
            maxSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            strategy: 'size',
        },
        bufferSize: 1000,
        flushInterval: 1000,
    },
    logAgentEvents: true,
    sensitiveFields: ['apiKey', 'api_key', 'password', 'token', 'secret', 'authorization'],
};

/**
 * 开发环境配置
 */
export const developmentConfig: Partial<LoggerConfig> = {
    level: Lvl.DEBUG,
    console: {
        enabled: true,
        format: 'pretty',
        colorize: true,
        timestamp: true,
    },
    file: {
        enabled: true,
        level: Lvl.DEBUG,
        filepath: './logs/agent-dev.log',
        format: 'json',
        rotation: {
            enabled: false,
            maxSize: 5 * 1024 * 1024,
            maxFiles: 3,
            strategy: 'size',
        },
    },
};

/**
 * 生产环境配置
 */
export const productionConfig: Partial<LoggerConfig> = {
    level: Lvl.INFO,
    console: {
        enabled: true,
        format: 'json',
        colorize: false,
        level: Lvl.WARN,
    },
    file: {
        enabled: true,
        level: Lvl.INFO,
        filepath: './logs/agent.log',
        format: 'json',
        rotation: {
            enabled: true,
            maxSize: 50 * 1024 * 1024, // 50MB
            maxFiles: 10,
            strategy: 'size',
        },
        bufferSize: 5000,
        flushInterval: 5000,
    },
};

/**
 * 测试环境配置
 */
export const testConfig: Partial<LoggerConfig> = {
    level: Lvl.WARN,
    console: {
        enabled: false,
    },
    file: {
        enabled: false,
        filepath: './logs/test.log',
    },
};

/**
 * 根据环境获取配置
 */
export function getConfigForEnv(env: LoggerConfig['env']): Partial<LoggerConfig> {
    switch (env) {
        case 'development':
            return developmentConfig;
        case 'production':
            return productionConfig;
        case 'test':
            return testConfig;
        case 'staging':
            return productionConfig;
        default:
            return developmentConfig;
    }
}

/**
 * 合并配置
 */
export function mergeConfig(userConfig?: Partial<LoggerConfig>): LoggerConfig {
    const env = userConfig?.env || (process.env.LOG_ENV as LoggerConfig['env']) || defaultLoggerConfig.env;
    const envConfig = getConfigForEnv(env);
    const baseConfig = {
        ...defaultLoggerConfig,
        ...envConfig,
        console: {
            ...defaultLoggerConfig.console,
            ...envConfig.console,
        },
        file: {
            ...defaultLoggerConfig.file,
            ...envConfig.file,
            rotation: {
                ...defaultLoggerConfig.file?.rotation,
                ...envConfig.file?.rotation,
            },
        },
    } as LoggerConfig;
    const envOverrides = getEnvOverrides(baseConfig);

    return {
        ...baseConfig,
        ...envOverrides,
        ...userConfig,
        console: {
            ...baseConfig.console,
            ...envOverrides.console,
            ...userConfig?.console,
        },
        file: {
            ...baseConfig.file,
            ...envOverrides.file,
            ...userConfig?.file,
            rotation: {
                ...baseConfig.file?.rotation,
                ...envOverrides.file?.rotation,
                ...userConfig?.file?.rotation,
            },
        },
    } as LoggerConfig;
}
