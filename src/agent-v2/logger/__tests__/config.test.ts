/**
 * Logger 配置模块测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeConfig, defaultLoggerConfig, developmentConfig, productionConfig, testConfig } from '../config';
import { LogLevel } from '../types';

describe('Logger Config', () => {
    const originalEnv: Record<string, string | undefined> = {};

    // 需要管理的环境变量
    const envKeys = [
        'LOG_LEVEL',
        'LOG_ENV',
        'LOG_FILE_ENABLED',
        'LOG_CONSOLE_ENABLED',
        'LOG_FILE_PATH',
        'LOG_DIR',
        'LOG_FILE_NAME',
        'LOG_CONSOLE_LEVEL',
        'LOG_FILE_LEVEL',
        'NODE_ENV',
    ];

    beforeEach(() => {
        // 保存并清除环境变量
        for (const key of envKeys) {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        // 恢复原始环境变量
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    describe('mergeConfig', () => {
        it('should return default config when no user config provided', () => {
            const config = mergeConfig();
            expect(config.service).toBe('coding-agent');
            // level 可能被模块加载时的环境变量影响，只检查是有效的日志级别
            expect([
                LogLevel.TRACE,
                LogLevel.DEBUG,
                LogLevel.INFO,
                LogLevel.WARN,
                LogLevel.ERROR,
                LogLevel.FATAL,
            ]).toContain(config.level);
        });

        it('should merge user config with defaults', () => {
            const config = mergeConfig({
                service: 'custom-service',
                level: LogLevel.DEBUG,
            });
            expect(config.service).toBe('custom-service');
            expect(config.level).toBe(LogLevel.DEBUG);
        });

        it('should use development config when env is development', () => {
            const config = mergeConfig({ env: 'development' });
            // 开发环境应该启用文件日志
            expect(config.file?.enabled).toBe(true);
            expect(config.file?.filepath).toBe('./logs/agent-dev.log');
        });

        it('should use production config when env is production', () => {
            const config = mergeConfig({ env: 'production' });
            // 生产环境应该启用文件日志
            expect(config.file?.enabled).toBe(true);
            expect(config.level).toBe(LogLevel.INFO);
        });

        it('should use test config when env is test', () => {
            const config = mergeConfig({ env: 'test' });
            // 测试环境应该禁用控制台和文件日志
            expect(config.console?.enabled).toBe(false);
            expect(config.file?.enabled).toBe(false);
        });
    });

    describe('环境变量覆盖', () => {
        it('should respect LOG_FILE_ENABLED=true', () => {
            process.env.LOG_FILE_ENABLED = 'true';
            const config = mergeConfig({ env: 'development' });
            expect(config.file?.enabled).toBe(true);
        });

        it('should respect LOG_FILE_ENABLED=false', () => {
            process.env.LOG_FILE_ENABLED = 'false';
            const config = mergeConfig({ env: 'development' });
            expect(config.file?.enabled).toBe(false);
        });

        it('should fallback to baseConfig when LOG_FILE_ENABLED is not set', () => {
            // delete process.env.LOG_FILE_ENABLED; // 已在 beforeEach 中清除
            // 开发环境默认启用文件日志
            const devConfig = mergeConfig({ env: 'development' });
            expect(devConfig.file?.enabled).toBe(true);

            // 测试环境默认禁用文件日志
            const testCfg = mergeConfig({ env: 'test' });
            expect(testCfg.file?.enabled).toBe(false);
        });

        it('should respect LOG_CONSOLE_ENABLED=true', () => {
            process.env.LOG_CONSOLE_ENABLED = 'true';
            const config = mergeConfig({ env: 'test' });
            expect(config.console?.enabled).toBe(true);
        });

        it('should respect LOG_CONSOLE_ENABLED=false', () => {
            process.env.LOG_CONSOLE_ENABLED = 'false';
            const config = mergeConfig({ env: 'development' });
            expect(config.console?.enabled).toBe(false);
        });

        it('should fallback to baseConfig when LOG_CONSOLE_ENABLED is not set', () => {
            // delete process.env.LOG_CONSOLE_ENABLED; // 已在 beforeEach 中清除
            // 开发环境默认启用控制台
            const devConfig = mergeConfig({ env: 'development' });
            expect(devConfig.console?.enabled).toBe(true);

            // 测试环境默认禁用控制台
            const testCfg = mergeConfig({ env: 'test' });
            expect(testCfg.console?.enabled).toBe(false);
        });

        it('should respect LOG_LEVEL env var', () => {
            process.env.LOG_LEVEL = '30'; // WARN
            const config = mergeConfig();
            expect(config.level).toBe(LogLevel.WARN);
        });

        it('should respect LOG_FILE_PATH env var', () => {
            process.env.LOG_FILE_PATH = '/custom/path/log.txt';
            const config = mergeConfig({ env: 'development' });
            expect(config.file?.filepath).toBe('/custom/path/log.txt');
        });

        it('should respect LOG_DIR env var', () => {
            process.env.LOG_DIR = '/custom/logs';
            const config = mergeConfig({ env: 'development' });
            expect(config.file?.filepath).toContain('/custom/logs');
        });
    });

    describe('用户配置优先级', () => {
        it('should allow user config to override env config', () => {
            process.env.LOG_FILE_ENABLED = 'true';
            const config = mergeConfig({
                env: 'development',
                file: { enabled: false, filepath: './test.log' },
            });
            // 用户配置应该优先于环境变量
            expect(config.file?.enabled).toBe(false);
        });

        it('should allow user config to override all defaults', () => {
            const config = mergeConfig({
                service: 'my-service',
                level: LogLevel.TRACE,
                console: { enabled: false },
                file: { enabled: true, filepath: './my.log' },
            });
            expect(config.service).toBe('my-service');
            expect(config.level).toBe(LogLevel.TRACE);
            expect(config.console?.enabled).toBe(false);
            expect(config.file?.enabled).toBe(true);
            expect(config.file?.filepath).toBe('./my.log');
        });
    });

    describe('默认配置验证', () => {
        it('defaultLoggerConfig should have correct values', () => {
            expect(defaultLoggerConfig.service).toBe('coding-agent');
            expect(defaultLoggerConfig.console?.enabled).toBe(true);
            expect(defaultLoggerConfig.file?.enabled).toBe(false);
        });

        it('developmentConfig should enable file logging', () => {
            expect(developmentConfig.file?.enabled).toBe(true);
            expect(developmentConfig.file?.filepath).toBe('./logs/agent-dev.log');
        });

        it('productionConfig should enable file logging', () => {
            expect(productionConfig.file?.enabled).toBe(true);
            expect(productionConfig.file?.rotation?.enabled).toBe(true);
        });

        it('testConfig should disable all transports', () => {
            expect(testConfig.console?.enabled).toBe(false);
            expect(testConfig.file?.enabled).toBe(false);
        });
    });
});
