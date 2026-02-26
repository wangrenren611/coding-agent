/**
 * 截断内容文件存储
 *
 * @module truncation/storage
 */

import fs from 'fs/promises';
import path from 'path';
import type { ITruncationStorage, TruncationContext } from './types';

/**
 * 默认存储目录
 */
const DEFAULT_STORAGE_DIR = path.join(process.cwd(), 'data', 'truncation');

/**
 * 截断内容文件存储
 *
 * 职责：
 * - 保存截断的完整内容到文件
 * - 管理文件路径命名
 * - 清理过期文件
 */
export class TruncationStorage implements ITruncationStorage {
    private storageDir: string;

    constructor(storageDir?: string) {
        this.storageDir = storageDir || DEFAULT_STORAGE_DIR;
    }

    /**
     * 确保存储目录存在
     */
    private async ensureDir(): Promise<void> {
        try {
            await fs.mkdir(this.storageDir, { recursive: true });
        } catch {
            // 目录已存在，忽略错误
        }
    }

    /**
     * 生成文件名
     *
     * 格式: {toolName}_{timestamp}_{random}.txt
     */
    private generateFilename(context: TruncationContext): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        // 清理工具名称中的特殊字符
        const toolName = context.toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
        return `${toolName}_${timestamp}_${random}.txt`;
    }

    /**
     * 保存内容到文件
     *
     * @param content 要保存的内容
     * @param context 截断上下文
     * @returns 保存的文件路径
     */
    async save(content: string, context: TruncationContext): Promise<string> {
        await this.ensureDir();

        const filename = this.generateFilename(context);
        const filePath = path.join(this.storageDir, filename);

        await fs.writeFile(filePath, content, 'utf-8');

        return filePath;
    }

    /**
     * 读取文件内容
     *
     * @param filePath 文件路径
     * @returns 文件内容
     */
    async read(filePath: string): Promise<string> {
        return fs.readFile(filePath, 'utf-8');
    }

    /**
     * 清理过期文件
     *
     * @param retentionDays 保留天数
     * @returns 清理的文件数量
     */
    async cleanup(retentionDays: number): Promise<number> {
        const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

        let cleanedCount = 0;

        try {
            const files = await fs.readdir(this.storageDir);

            for (const file of files) {
                const filePath = path.join(this.storageDir, file);

                try {
                    const stat = await fs.stat(filePath);

                    if (stat.isFile() && stat.mtime.getTime() < cutoffTime) {
                        await fs.unlink(filePath);
                        cleanedCount++;
                    }
                } catch {
                    // 忽略单个文件错误（可能被其他进程删除）
                }
            }
        } catch {
            // 目录不存在或无法访问，忽略
        }

        return cleanedCount;
    }

    /**
     * 获取存储目录路径
     */
    getStorageDir(): string {
        return this.storageDir;
    }
}
