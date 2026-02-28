/**
 * 截断系统常量配置
 *
 * @module truncation/constants
 */

import type { TruncationConfig } from './types';

/**
 * 默认截断配置
 */
export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
    maxLines: 2000,
    maxBytes: 50 * 1024, // 50KB
    direction: 'head',
    enabled: true,
    retentionDays: 7,
};

/**
 * 工具特定默认配置
 *
 * 不同工具的输出特性不同，可以使用不同的截断策略
 */
export const TOOL_TRUNCATION_CONFIGS: Record<string, Partial<TruncationConfig>> = {
    // bash 输出通常看尾部（最新日志/错误）
    bash: {
        direction: 'tail',
        maxLines: 500,
    },

    // grep 结果可能很长
    grep: {
        maxLines: 3000,
    },

    // read_file 文件本身支持分页，不需要额外截断
    read_file: {
        enabled: false,
    },

    // glob 结果通常不会太长
    glob: {
        maxLines: 1000,
    },

    // web 搜索结果
    web_search: {
        maxLines: 500,
    },

    // web 抓取结果
    web_fetch: {
        maxLines: 2000,
        maxBytes: 100 * 1024, // 100KB
    },

    // LSP 结果
    lsp: {
        maxLines: 1000,
    },
};
