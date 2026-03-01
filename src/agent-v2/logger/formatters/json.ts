/**
 * JSON 格式化器
 */

import { BaseFormatter } from './base';
import type { LogRecord } from '../types';

/**
 * JSON 格式化器配置
 */
export interface JsonFormatterConfig {
    /** 是否美化输出 */
    pretty?: boolean;
    /** 是否包含空值 */
    includeNulls?: boolean;
}

/**
 * JSON 格式化器
 * 输出结构化的 JSON 日志，便于日志收集和分析
 */
export class JsonFormatter extends BaseFormatter {
    private config: JsonFormatterConfig;

    constructor(config: JsonFormatterConfig = {}) {
        super();
        this.config = {
            pretty: false,
            includeNulls: false,
            ...config,
        };
    }

    format(record: LogRecord): string {
        const output: Record<string, unknown> = {
            '@timestamp': record.timestamp,
            '@level': record.levelName,
            '@message': record.message,
        };

        // 添加上下文
        if (record.context && Object.keys(record.context).length > 0) {
            output['@context'] = this.sanitizeContext(record.context);
        }

        // 添加模块信息
        if (record.module) {
            output['@module'] = record.module;
        }

        // 添加文件位置
        if (record.file) {
            output['@location'] = {
                file: record.file,
                line: record.line,
            };
        }

        // 添加错误信息
        if (record.error) {
            output['@error'] = {
                type: record.error.name,
                message: record.error.message,
                stack: record.error.stack,
                code: record.error.code,
            };
        }

        // 添加额外数据
        if (record.data && Object.keys(record.data).length > 0) {
            output['@data'] = this.sanitizeContext(record.data);
        }

        return this.config.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
    }

    /**
     * 清理上下文，移除循环引用
     */
    private sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(context)) {
            if (value === null && !this.config.includeNulls) {
                continue;
            }
            try {
                // 测试是否可序列化
                JSON.stringify(value);
                result[key] = value;
            } catch {
                result[key] = '[non-serializable]';
            }
        }
        return result;
    }
}
