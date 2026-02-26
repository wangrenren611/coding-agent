/**
 * 默认截断策略
 *
 * 同时检查行数和字节数限制，任一超限则截断
 *
 * @module truncation/strategies/default
 */

import { BaseTruncationStrategy } from './base';
import type { TruncationConfig } from '../types';

/**
 * 默认截断策略
 *
 * 特点：
 * - 双重限制检查（行数 + 字节数）
 * - 支持头部/尾部截断
 * - 精确统计移除的行数/字节数
 */
export class DefaultTruncationStrategy extends BaseTruncationStrategy {
    readonly name = 'default';

    /**
     * 检查是否需要截断
     *
     * 行数或字节数任一超限即需要截断
     */
    needsTruncation(content: string, config: TruncationConfig): boolean {
        const lineCount = this.countLines(content);
        const byteCount = this.countBytes(content);

        return lineCount > config.maxLines || byteCount > config.maxBytes;
    }

    /**
     * 执行截断
     *
     * 算法：
     * 1. 根据方向（head/tail）决定遍历顺序
     * 2. 逐行添加，同时检查行数和字节限制
     * 3. 任一限制触发即停止
     * 4. 返回截断内容和统计信息
     */
    truncate(
        content: string,
        config: TruncationConfig
    ): { content: string; removedLines?: number; removedBytes?: number } {
        const lines = content.split('\n');
        const totalLines = lines.length;
        const totalBytes = this.countBytes(content);

        // 收集保留的行
        const kept: string[] = [];
        let bytes = 0;
        let hitBytesLimit = false;

        if (config.direction === 'head') {
            // 从头部开始保留
            for (let i = 0; i < lines.length && kept.length < config.maxLines; i++) {
                const lineBytes = this.getLineBytes(lines[i], kept.length === 0);

                if (bytes + lineBytes > config.maxBytes) {
                    hitBytesLimit = true;
                    break;
                }

                kept.push(lines[i]);
                bytes += lineBytes;
            }
        } else {
            // 从尾部开始保留
            for (let i = lines.length - 1; i >= 0 && kept.length < config.maxLines; i--) {
                const lineBytes = this.getLineBytes(lines[i], kept.length === 0);

                if (bytes + lineBytes > config.maxBytes) {
                    hitBytesLimit = true;
                    break;
                }

                kept.unshift(lines[i]);
                bytes += lineBytes;
            }
        }

        // 计算移除的行数和字节数
        const removedLines = totalLines - kept.length;
        const removedBytes = totalBytes - bytes;

        // 判断主要限制因素：如果总字节数超限或遍历中触发字节限制，则认为是字节截断
        const isByteBasedTruncation = hitBytesLimit || totalBytes > config.maxBytes;

        return {
            content: kept.join('\n'),
            // 如果是字节限制导致的截断，报告字节数；否则报告行数
            removedLines: isByteBasedTruncation ? undefined : removedLines,
            removedBytes: isByteBasedTruncation ? removedBytes : undefined,
        };
    }
}
