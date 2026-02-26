/**
 * 截断策略基类
 *
 * @module truncation/strategies/base
 */

import type { TruncationStrategy, TruncationConfig } from '../types';

/**
 * 截断策略基类
 *
 * 提供通用的辅助方法，子类继承并实现具体截断逻辑
 */
export abstract class BaseTruncationStrategy implements TruncationStrategy {
    abstract readonly name: string;

    abstract needsTruncation(content: string, config: TruncationConfig): boolean;
    abstract truncate(
        content: string,
        config: TruncationConfig
    ): { content: string; removedLines?: number; removedBytes?: number };

    /**
     * 计算内容的行数
     * @param content 内容
     * @returns 行数
     */
    protected countLines(content: string): number {
        return content.split('\n').length;
    }

    /**
     * 计算内容的字节数（UTF-8）
     * @param content 内容
     * @returns 字节数
     */
    protected countBytes(content: string): number {
        return Buffer.byteLength(content, 'utf-8');
    }

    /**
     * 按行截断（保留头部）
     * @param content 内容
     * @param maxLines 最大行数
     * @returns 保留的行数组
     */
    protected truncateHead(content: string, maxLines: number): string[] {
        const lines = content.split('\n');
        return lines.slice(0, maxLines);
    }

    /**
     * 按行截断（保留尾部）
     * @param content 内容
     * @param maxLines 最大行数
     * @returns 保留的行数组
     */
    protected truncateTail(content: string, maxLines: number): string[] {
        const lines = content.split('\n');
        return lines.slice(-maxLines);
    }

    /**
     * 计算单行的字节数（包含换行符）
     * @param line 行内容
     * @param isFirst 是否是第一行（第一行不需要前置换行符）
     * @returns 字节数
     */
    protected getLineBytes(line: string, isFirst: boolean): number {
        const lineBytes = this.countBytes(line);
        return isFirst ? lineBytes : lineBytes + 1; // +1 for newline
    }
}
