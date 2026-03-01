/**
 * 控制台 Transport
 */

import { BaseTransport } from './base';
import type { ConsoleTransportConfig, LogRecord, IFormatter } from '../types';

/**
 * 控制台 Transport
 * 将日志输出到控制台 (stdout/stderr)
 */
export class ConsoleTransport extends BaseTransport {
    readonly name = 'console';
    readonly config: ConsoleTransportConfig;
    private stream: NodeJS.WritableStream;

    constructor(config: ConsoleTransportConfig, formatter: IFormatter) {
        super(formatter);
        this.config = {
            enabled: true,
            level: 0,
            format: 'pretty',
            colorize: true,
            stream: 'stdout',
            ...config,
        };
        this.stream = this.config.stream === 'stderr' ? process.stderr : process.stdout;
    }

    write(record: LogRecord): void {
        if (!this.shouldLog(record)) return;

        const formatted = this.format(record);

        // FATAL 和 ERROR 输出到 stderr，其他输出到 stdout
        const targetStream = record.level >= 40 && this.config.stream !== 'stderr' ? process.stderr : this.stream;

        targetStream.write(formatted + '\n');
    }

    protected override format(record: LogRecord): string {
        return this.formatter.format(record);
    }
}
