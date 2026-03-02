/**
 * Logger 模块单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger, createLogger, getLogger, setDefaultLogger, ChildLogger } from '../logger';
import { LogLevel, LogLevelName, LogRecord } from '../types';
import { JsonFormatter } from '../formatters/json';
import { PrettyFormatter } from '../formatters/pretty';
import { FileTransport } from '../transports/file';
import * as fs from 'fs';
import * as path from 'path';

import type { ITransport } from '../types';

describe('LogLevel', () => {
    it('should have correct level values', () => {
        expect(LogLevel.TRACE).toBe(0);
        expect(LogLevel.DEBUG).toBe(10);
        expect(LogLevel.INFO).toBe(20);
        expect(LogLevel.WARN).toBe(30);
        expect(LogLevel.ERROR).toBe(40);
        expect(LogLevel.FATAL).toBe(50);
    });

    it('should have correct level names', () => {
        expect(LogLevelName[LogLevel.TRACE]).toBe('TRACE');
        expect(LogLevelName[LogLevel.INFO]).toBe('INFO');
        expect(LogLevelName[LogLevel.ERROR]).toBe('ERROR');
    });
});

describe('JsonFormatter', () => {
    it('should format log record as JSON', () => {
        const formatter = new JsonFormatter();
        const record = {
            timestamp: '2024-01-01T00:00:00.000Z',
            level: LogLevel.INFO,
            levelName: 'INFO',
            message: 'Test message',
            context: { sessionId: 'test-123' },
        };
        const result = formatter.format(record);
        const parsed = JSON.parse(result);
        expect(parsed['@timestamp']).toBe('2024-01-01T00:00:00.000Z');
        expect(parsed['@level']).toBe('INFO');
        expect(parsed['@message']).toBe('Test message');
        expect(parsed['@context']).toEqual({ sessionId: 'test-123' });
    });
    it('should format error correctly', () => {
        const formatter = new JsonFormatter();
        const record = {
            timestamp: '2024-01-01T00:00:00.000Z',
            level: LogLevel.ERROR,
            levelName: 'ERROR',
            message: 'Error occurred',
            context: {},
            error: {
                name: 'TestError',
                message: 'Something went wrong',
                stack: 'at test.js:1',
            },
        };
        const result = formatter.format(record);
        const parsed = JSON.parse(result);
        expect(parsed['@error']).toBeDefined();
        expect(parsed['@error'].type).toBe('TestError');
        expect(parsed['@error'].message).toBe('Something went wrong');
    });
    it('should support pretty output', () => {
        const formatter = new JsonFormatter({ pretty: true });
        const record = {
            timestamp: '2024-01-01T00:00:00.000Z',
            level: LogLevel.INFO,
            levelName: 'INFO',
            message: 'Test',
            context: {},
        };
        const result = formatter.format(record);
        expect(result).toContain('\n'); // Pretty output has newlines
    });
});
describe('PrettyFormatter', () => {
    it('should format log record as human readable', () => {
        const formatter = new PrettyFormatter({ colorize: false });
        const record = {
            timestamp: new Date('2024-01-01T00:00:00.000Z').toISOString(),
            level: LogLevel.INFO,
            levelName: 'INFO',
            message: 'Test message',
            context: { sessionId: 'test-123' },
        };
        const result = formatter.format(record);
        expect(result).toContain('INFO');
        expect(result).toContain('Test message');
        expect(result).toContain('sessionId=test-123');
    });
    it('should truncate long messages', () => {
        const formatter = new PrettyFormatter({ colorize: false, maxMessageLength: 20 });
        const longMessage = 'a'.repeat(100);
        const record = {
            timestamp: new Date().toISOString(),
            level: LogLevel.INFO,
            levelName: 'INFO',
            message: longMessage,
            context: {},
        };
        const result = formatter.format(record);
        expect(result).toContain('...');
    });
    it('should format errors with stack trace', () => {
        const formatter = new PrettyFormatter({ colorize: false });
        const record = {
            timestamp: new Date().toISOString(),
            level: LogLevel.ERROR,
            levelName: 'ERROR',
            message: 'Error',
            context: {},
            error: {
                name: 'TestError',
                message: 'Test error',
                stack: 'Error: Test error\n    at test.js:1',
            },
        };
        const result = formatter.format(record);
        expect(result).toContain('Error');
        expect(result).toContain('TestError');
    });
});
describe('Logger', () => {
    let logger: Logger;

    beforeEach(() => {
        logger = createLogger({
            service: 'test-service',
            env: 'test',
            level: LogLevel.DEBUG,
            console: { enabled: false },
            file: { enabled: false, filepath: './test.log' },
        });
    });
    afterEach(async () => {
        await logger.close();
    });
    it('should create logger with config', () => {
        expect(logger).toBeInstanceOf(Logger);
        expect(logger.getConfig().service).toBe('test-service');
    });
    it('should log at different levels', async () => {
        const records: LogRecord[] = [];
        const testLogger = createLogger({
            service: 'test',
            env: 'development',
            level: LogLevel.TRACE,
            console: { enabled: false },
            file: { enabled: false, filepath: './test.log' },
        });
        testLogger.addTransport({
            name: 'test',
            config: { enabled: true },
            write: (record: LogRecord) => {
                records.push(record);
                return;
            },
        });
        testLogger.trace('Trace message');
        testLogger.debug('Debug message');
        testLogger.info('Info message');
        testLogger.warn('Warn message');
        testLogger.error('Error message');
        // Wait for async logging to complete
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(records.length).toBe(5);
        expect(records[0].level).toBe(LogLevel.TRACE);
        expect(records[4].level).toBe(LogLevel.ERROR);
        await testLogger.close();
    });
    it('should respect log level', async () => {
        const records: LogRecord[] = [];
        const testLogger = createLogger({
            service: 'test',
            env: 'test',
            level: LogLevel.WARN,
            console: { enabled: false },
            file: { enabled: false, filepath: './test.log' },
        });
        // Add a custom transport to capture records
        testLogger.addTransport({
            name: 'test',
            config: { enabled: true, level: LogLevel.TRACE },
            write: (record) => {
                records.push(record);
                return;
            },
        });
        testLogger.info('Should not appear');
        testLogger.warn('Should appear');
        testLogger.error('Should appear');
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(records.length).toBe(2);
        expect(records[0].level).toBe(LogLevel.WARN);
        expect(records[1].level).toBe(LogLevel.ERROR);
        await testLogger.close();
    });
    it('should create child logger', () => {
        const child = logger.child('TestModule', { requestId: 'req-123' });
        expect(child).toBeInstanceOf(ChildLogger);
    });
    it('should sanitize sensitive fields', async () => {
        const records: LogRecord[] = [];
        const testLogger = createLogger({
            service: 'test',
            env: 'test',
            level: LogLevel.INFO,
            console: { enabled: false },
            file: { enabled: false, filepath: './test.log' },
            sensitiveFields: ['apiKey', 'password'],
        });
        testLogger.addTransport({
            name: 'test',
            config: { enabled: true },
            write: (record) => {
                records.push(record);
                return;
            },
        });
        testLogger.info('Test', { apiKey: 'secret-key', password: 'secret-pass', public: 'visible' });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(records[0].context.apiKey).toBe('[REDACTED]');
        expect(records[0].context.password).toBe('[REDACTED]');
        expect(records[0].context.public).toBe('visible');
        await testLogger.close();
    });
    it('should track statistics', async () => {
        const testLogger = createLogger({
            service: 'test',
            env: 'test',
            level: LogLevel.DEBUG,
            console: { enabled: false },
            file: { enabled: false, filepath: './test.log' },
        });
        const testTransport: ITransport = {
            name: 'test',
            config: { enabled: true },
            write: (_record) => {
                // do nothing
            },
        };
        testLogger.addTransport(testTransport);
        testLogger.info('Info 1');
        testLogger.info('Info 2');
        testLogger.error('Error 1');
        await new Promise((resolve) => setTimeout(resolve, 10));
        const stats = testLogger.getStats();
        expect(stats.total).toBe(3);
        expect(stats.byLevel['INFO']).toBe(2);
        expect(stats.byLevel['ERROR']).toBe(1);
        expect(stats.errors).toBe(1);
        await testLogger.close();
    });
});
describe('ChildLogger', () => {
    let parent: Logger;
    let child: ChildLogger;
    beforeEach(() => {
        parent = createLogger({
            service: 'test',
            env: 'test',
            level: LogLevel.DEBUG,
            console: { enabled: false },
            file: { enabled: false, filepath: './test.log' },
        });
        child = parent.child('TestModule', { requestId: 'req-123' });
    });
    afterEach(async () => {
        await parent.close();
    });
    it('should prefix messages with module name', () => {
        const records: LogRecord[] = [];
        parent.addTransport({
            name: 'test',
            config: { enabled: true },
            write: (record) => {
                records.push(record);
            },
        });
        child.info('Test message');
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                expect(records[0].message).toContain('[TestModule]');
                expect(records[0].message).toContain('Test message');
                resolve();
            }, 10);
        });
    });
    it('should merge context', () => {
        const records: LogRecord[] = [];
        parent.addTransport({
            name: 'test',
            config: { enabled: true },
            write: (record) => {
                records.push(record);
            },
        });
        child.info('Test', { extraContext: 'value' });
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                expect(records[0].context.requestId).toBe('req-123');
                expect(records[0].context.extraContext).toBe('value');
                resolve();
            }, 10);
        });
    });
    it('should create nested child', () => {
        const nestedChild = child.child('SubModule');
        expect(nestedChild).toBeInstanceOf(ChildLogger);
    });
});
describe('Default Logger', () => {
    it('should return default logger', () => {
        const logger1 = getLogger();
        const logger2 = getLogger();
        expect(logger1).toBe(logger2);
    });
    it('should allow setting default logger', () => {
        const customLogger = createLogger({
            service: 'custom',
            env: 'test',
            level: LogLevel.DEBUG,
            console: { enabled: false },
            file: { enabled: false, filepath: './test.log' },
        });
        setDefaultLogger(customLogger);
        expect(getLogger()).toBe(customLogger);
        // Reset to default
        setDefaultLogger(
            createLogger({
                service: 'coding-agent',
                env: 'test',
                level: LogLevel.INFO,
                console: { enabled: false },
                file: { enabled: false, filepath: './test.log' },
            })
        );
    });
});
describe('FileTransport', () => {
    const testLogDir = path.join(__dirname, '__test_logs__');
    const testLogFile = path.join(testLogDir, 'test.log');
    beforeEach(() => {
        if (!fs.existsSync(testLogDir)) {
            fs.mkdirSync(testLogDir, { recursive: true });
        }
    });
    afterEach(() => {
        if (fs.existsSync(testLogDir)) {
            fs.rmSync(testLogDir, { recursive: true, force: true });
        }
    });
    it('should write to file', async () => {
        const formatter = new JsonFormatter();
        const transport = new FileTransport(
            {
                enabled: true,
                filepath: testLogFile,
                sync: true,
            },
            formatter
        );
        transport.write({
            timestamp: '2024-01-01T00:00:00.000Z',
            level: LogLevel.INFO,
            levelName: 'INFO',
            message: 'Test message',
            context: {},
        });
        if (transport.close) {
            await transport.close();
        }
        const content = fs.readFileSync(testLogFile, 'utf8');
        expect(content).toContain('Test message');
        expect(content).toContain('INFO');
    });
    it('should buffer writes when sync is false', async () => {
        const formatter = new JsonFormatter();
        const transport = new FileTransport(
            {
                enabled: true,
                filepath: testLogFile,
                sync: false,
                bufferSize: 10,
                flushInterval: 100,
            },
            formatter
        );
        // Write multiple records
        for (let i = 0; i < 5; i++) {
            transport.write({
                timestamp: new Date().toISOString(),
                level: LogLevel.INFO,
                levelName: 'INFO',
                message: `Message ${i}`,
                context: {},
            });
        }
        // Wait for flush
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (transport.flush) {
            await transport.flush();
        }
        if (transport.close) {
            await transport.close();
        }
        const content = fs.readFileSync(testLogFile, 'utf8');
        expect(content).toContain('Message 0');
        expect(content).toContain('Message 4');
    });
});
