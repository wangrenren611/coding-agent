/**
 * 美化格式化器
 */

import { BaseFormatter } from './base';
import type { LogRecord, LogLevel } from '../types';
import { LogLevelName } from '../types';

/**
 * ANSI 颜色代码
 */
const Colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgYellow: '\x1b[43m',
};

/**
 * 级别对应的颜色
 */
const LevelColors: Record<LogLevel, string> = {
    0: Colors.dim, // TRACE
    10: Colors.cyan, // DEBUG
    20: Colors.green, // INFO
    30: Colors.yellow, // WARN
    40: Colors.red, // ERROR
    50: Colors.bgRed + Colors.white, // FATAL
};

/**
 * 美化格式化器配置
 */
export interface PrettyFormatterConfig {
    /** 是否启用颜色 */
    colorize?: boolean;
    /** 是否显示时间戳 */
    showTimestamp?: boolean;
    /** 是否显示上下文 */
    showContext?: boolean;
    /** 时间戳格式 */
    timestampFormat?: 'iso' | 'locale' | 'time';
    /** 最大消息长度 */
    maxMessageLength?: number;
}

/**
 * 美化格式化器
 * 输出人类可读的彩色日志，适合开发环境
 */
export class PrettyFormatter extends BaseFormatter {
    private config: Required<PrettyFormatterConfig>;

    constructor(config: PrettyFormatterConfig = {}) {
        super();
        this.config = {
            colorize: true,
            showTimestamp: true,
            showContext: true,
            timestampFormat: 'time',
            maxMessageLength: 200,
            ...config,
        };
    }

    format(record: LogRecord): string {
        const parts: string[] = [];

        // 时间戳
        if (this.config.showTimestamp) {
            parts.push(this.colorize(this.formatTimestamp(record.timestamp), Colors.dim));
        }

        // 日志级别
        parts.push(this.formatLevel(record.level));

        // 模块名称
        if (record.module) {
            parts.push(this.colorize(`[${record.module}]`, Colors.cyan));
        }

        // 消息
        parts.push(this.formatMessage(record.message));

        // 上下文
        if (this.config.showContext && record.context && Object.keys(record.context).length > 0) {
            parts.push(this.formatContext(record.context));
        }

        // 额外数据
        if (record.data && Object.keys(record.data).length > 0) {
            parts.push(this.formatData(record.data));
        }

        let output = parts.join(' ');

        // 错误信息（换行显示）
        if (record.error) {
            output += '\n' + this.formatErrorDisplay(record);
        }

        return output;
    }

    /**
     * 格式化时间戳
     */
    protected override formatTimestamp(timestamp: string): string {
        const date = new Date(timestamp);
        switch (this.config.timestampFormat) {
            case 'iso':
                return timestamp;
            case 'locale':
                return date.toLocaleString();
            case 'time':
            default:
                return date.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    fractionalSecondDigits: 3,
                });
        }
    }

    /**
     * 格式化日志级别
     */
    private formatLevel(level: LogLevel): string {
        const name = LogLevelName[level];
        const color = LevelColors[level];
        return this.colorize(name.padEnd(5), color + Colors.bold);
    }

    /**
     * 格式化消息
     */
    private formatMessage(message: string): string {
        if (message.length <= this.config.maxMessageLength) {
            return message;
        }
        return message.substring(0, this.config.maxMessageLength) + '...';
    }

    /**
     * 格式化上下文
     */
    private formatContext(context: Record<string, unknown>): string {
        const pairs = Object.entries(context)
            .filter(([, value]) => value !== undefined)
            .slice(0, 5) // 最多显示5个
            .map(([key, value]) => {
                let strValue: string;
                if (typeof value === 'object' && value !== null) {
                    try {
                        strValue = JSON.stringify(value);
                    } catch {
                        strValue = '[non-serializable]';
                    }
                } else {
                    strValue = String(value);
                }
                const truncated = strValue.length > 30 ? strValue.substring(0, 30) + '...' : strValue;
                return `${key}=${truncated}`;
            });

        if (pairs.length === 0) return '';
        if (Object.keys(context).length > 5) {
            pairs.push(`+${Object.keys(context).length - 5} more`);
        }
        return this.colorize(`(${pairs.join(', ')})`, Colors.dim);
    }

    /**
     * 格式化额外数据
     */
    private formatData(data: Record<string, unknown>): string {
        return '\n' + this.colorize(this.safeStringify(data), Colors.dim);
    }

    /**
     * 格式化错误显示
     */
    private formatErrorDisplay(record: LogRecord): string {
        const lines: string[] = [];
        const { error } = record;

        if (!error) return '';

        lines.push(this.colorize('┌─ Error ─────────────────────────────', Colors.red));
        lines.push(this.colorize(`│ Type: ${error.name}`, Colors.red));
        lines.push(this.colorize(`│ Message: ${error.message}`, Colors.red));

        if (error.code) {
            lines.push(this.colorize(`│ Code: ${error.code}`, Colors.red));
        }

        if (error.stack) {
            lines.push(this.colorize('│ Stack:', Colors.red));
            const stackLines = error.stack.split('\n').slice(0, 10);
            for (const line of stackLines) {
                lines.push(this.colorize(`│   ${line}`, Colors.dim));
            }
        }

        lines.push(this.colorize('└──────────────────────────────────────', Colors.red));

        return lines.join('\n');
    }

    /**
     * 应用颜色
     */
    private colorize(text: string, color: string): string {
        if (!this.config.colorize) return text;
        return `${color}${text}${Colors.reset}`;
    }
}
