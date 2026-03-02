import { describe, it, expect, beforeEach } from 'vitest';
import { createLogger } from '../logger';
import { LogLevel, type LogRecord } from '../types';
import { getContextManager } from '../middleware/context';
import { createEventLoggerMiddleware } from '../middleware/event-logger';
import { EventBus } from '../../eventbus/eventbus';
import { EventType } from '../../eventbus/types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Logger Enterprise Semantics', () => {
    beforeEach(() => {
        getContextManager().clearContext();
    });

    it('should isolate context for concurrent async flows', async () => {
        const manager = getContextManager();

        const [flowA, flowB] = await Promise.all([
            manager.withContextAsync({ requestId: 'A' }, async () => {
                await sleep(20);
                return manager.getContext().requestId;
            }),
            manager.withContextAsync({ requestId: 'B' }, async () => {
                await sleep(5);
                return manager.getContext().requestId;
            }),
        ]);

        expect(flowA).toBe('A');
        expect(flowB).toBe('B');
    });

    it('should flush pending async writes when closing logger', async () => {
        const records: LogRecord[] = [];
        const logger = createLogger({
            service: 'test',
            env: 'test',
            level: LogLevel.INFO,
            console: { enabled: false },
            file: { enabled: false, filepath: './tmp.log' },
        });

        logger.addTransport({
            name: 'async-transport',
            config: { enabled: true, level: LogLevel.TRACE },
            write: async (record) => {
                await sleep(30);
                records.push(record);
            },
        });

        logger.info('before-close');
        await logger.close();

        expect(records.some((record) => record.message === 'before-close')).toBe(true);
    });

    it('should support low-noise event logging with logAllEvents=false', () => {
        const bus = new EventBus();
        const records: LogRecord[] = [];
        const unsubscribe = createEventLoggerMiddleware(
            bus,
            {
                log: (record) => {
                    records.push(record);
                },
            },
            { logAllEvents: false, sessionId: 's1' }
        );

        bus.emit(EventType.TOOL_START, {
            timestamp: Date.now(),
            toolName: 'grep',
            arguments: 'foo',
        });
        bus.emit(EventType.TASK_START, {
            timestamp: Date.now(),
            query: 'analyze project',
        });

        unsubscribe();

        expect(records.some((record) => record.message.includes('Task started'))).toBe(true);
        expect(records.some((record) => record.message.includes('Tool started'))).toBe(false);
    });
});
