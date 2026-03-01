/**
 * 日志模块配置
 */

import type { LoggerConfig, LogLevel } from './types';
import { LogLevel as Lvl } from './types';

/**
 * 默认日志配置
 */
export const defaultLoggerConfig: LoggerConfig = {
    service: 'coding-agent',
    env: (process.env.NODE_ENV as LoggerConfig['env']) || 'development',
    level: process.env.LOG_LEVEL ? (parseInt(process.env.LOG_LEVEL) as LogLevel) : Lvl.INFO,
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
    const env = userConfig?.env || defaultLoggerConfig.env;
    const envConfig = getConfigForEnv(env);

    return {
        ...defaultLoggerConfig,
        ...envConfig,
        ...userConfig,
        console: {
            ...defaultLoggerConfig.console,
            ...envConfig.console,
            ...userConfig?.console,
        },
        file: {
            ...defaultLoggerConfig.file,
            ...envConfig.file,
            ...userConfig?.file,
        },
    } as LoggerConfig;
}
