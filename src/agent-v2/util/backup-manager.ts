/**
 * ============================================================================
 * File Backup Manager
 * ============================================================================
 *
 * 自动备份和回滚机制，用于文件编辑操作的安全保护
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * 备份信息
 */
export interface BackupInfo {
    /** 备份 ID (唯一标识) */
    id: string;
    /** 原始文件路径 */
    originalPath: string;
    /** 备份文件路径 */
    backupPath: string;
    /** 创建时间戳 */
    createdAt: number;
    /** 文件大小 (bytes) */
    size: number;
}

/**
 * 备份管理器配置
 */
export interface BackupManagerConfig {
    /** 备份目录路径 */
    backupDir?: string;
    /** 每个文件最大备份数量 */
    maxBackups?: number;
    /** 是否启用备份 */
    enabled?: boolean;
}

/**
 * 备份管理器
 *
 * 提供自动文件备份和回滚功能
 */
export class BackupManager {
    private backupDir: string;
    private maxBackups: number;
    private enabled: boolean;
    private backupIndex: Map<string, BackupInfo[]> = new Map();

    constructor(config: BackupManagerConfig = {}) {
        this.backupDir = config.backupDir || path.join(process.cwd(), '.claude', 'backups');
        this.maxBackups = config.maxBackups ?? 5;
        this.enabled = config.enabled ?? true;
    }

    /**
     * 初始化备份管理器（创建备份目录）
     */
    async initialize(): Promise<void> {
        if (!this.enabled) {
            return;
        }

        try {
            await fs.mkdir(this.backupDir, { recursive: true });
        } catch (error) {
            throw error;
        }
    }

    /**
     * 备份文件
     *
     * @param filePath 要备份的文件路径
     * @returns 备份 ID，如果备份失败返回 null
     */
    async backup(filePath: string): Promise<string | null> {
        if (!this.enabled) {
            return null;
        }

        try {
            // 检查文件是否存在
            const stats = await fs.stat(filePath).catch(() => null);
            if (!stats || !stats.isFile()) {
                return null;
            }

            // 读取文件内容
            const content = await fs.readFile(filePath, 'utf-8');

            // 生成唯一备份 ID
            const backupId = this.generateBackupId(filePath);
            const backupPath = path.join(this.backupDir, `${backupId}.backup`);

            // 写入备份文件
            await fs.writeFile(backupPath, content, 'utf-8');

            // 创建备份信息
            const backupInfo: BackupInfo = {
                id: backupId,
                originalPath: filePath,
                backupPath,
                createdAt: Date.now(),
                size: stats.size,
            };

            // 添加到索引
            this.addToIndex(filePath, backupInfo);

            // 清理旧备份
            await this.cleanOldBackups(filePath);

            return backupId;

        } catch (error) {
            return null;
        }
    }

    /**
     * 恢复文件到指定备份
     *
     * @param filePath 原始文件路径
     * @param backupId 备份 ID
     * @returns 是否成功恢复
     */
    async restore(filePath: string, backupId: string): Promise<boolean> {
        if (!this.enabled) {
            return false;
        }

        try {
            // 查找备份信息
            const backups = this.backupIndex.get(filePath);
            if (!backups) {
                return false;
            }

            const backupInfo = backups.find(b => b.id === backupId);
            if (!backupInfo) {
                return false;
            }

            // 读取备份内容
            const content = await fs.readFile(backupInfo.backupPath, 'utf-8');

            // 写入原始文件
            await fs.writeFile(filePath, content, 'utf-8');

            return true;

        } catch (error) {
            return false;
        }
    }

    /**
     * 获取文件的所有备份
     *
     * @param filePath 文件路径
     * @returns 备份信息列表（按创建时间降序）
     */
    getBackups(filePath: string): BackupInfo[] {
        const backups = this.backupIndex.get(filePath);
        return backups
            ? [...backups].sort((a, b) => b.createdAt - a.createdAt)
            : [];
    }

    /**
     * 删除指定备份
     *
     * @param filePath 文件路径
     * @param backupId 备份 ID
     */
    async deleteBackup(filePath: string, backupId: string): Promise<void> {
        const backups = this.backupIndex.get(filePath);
        if (!backups) return;

        const backupInfo = backups.find(b => b.id === backupId);
        if (backupInfo) {
            await fs.unlink(backupInfo.backupPath).catch(() => {});
            this.removeFromIndex(filePath, backupId);
        }
    }

    /**
     * 清理文件的所有旧备份
     */
    async clean(filePath: string): Promise<void> {
        const backups = this.backupIndex.get(filePath);
        if (!backups) return;

        for (const backup of backups) {
            await fs.unlink(backup.backupPath).catch(() => {});
        }

        this.backupIndex.delete(filePath);
    }

    /**
     * 清理旧备份（保留最新的 maxBackups 个）
     */
    private async cleanOldBackups(filePath: string): Promise<void> {
        const backups = this.backupIndex.get(filePath);
        if (!backups || backups.length <= this.maxBackups) {
            return;
        }

        // 按创建时间排序，删除最旧的
        const sortedBackups = [...backups].sort((a, b) => a.createdAt - b.createdAt);
        const toDelete = sortedBackups.slice(0, sortedBackups.length - this.maxBackups);

        for (const backup of toDelete) {
            await fs.unlink(backup.backupPath).catch(() => {});
            this.removeFromIndex(filePath, backup.id);
        }
    }

    /**
     * 生成备份 ID
     */
    private generateBackupId(filePath: string): string {
        const hash = crypto
            .createHash('md5')
            .update(filePath + Date.now() + Math.random())
            .digest('hex')
            .substring(0, 12);
        return `${path.basename(filePath)}_${hash}_${Date.now()}`;
    }

    /**
     * 添加到索引
     */
    private addToIndex(filePath: string, backupInfo: BackupInfo): void {
        let backups = this.backupIndex.get(filePath);
        if (!backups) {
            backups = [];
            this.backupIndex.set(filePath, backups);
        }
        backups.push(backupInfo);
    }

    /**
     * 从索引中删除
     */
    private removeFromIndex(filePath: string, backupId: string): void {
        const backups = this.backupIndex.get(filePath);
        if (!backups) return;

        const index = backups.findIndex(b => b.id === backupId);
        if (index !== -1) {
            backups.splice(index, 1);
        }

        if (backups.length === 0) {
            this.backupIndex.delete(filePath);
        }
    }
}

// 单例实例
let backupManagerInstance: BackupManager | null = null;

/**
 * 获取全局备份管理器实例
 */
export function getBackupManager(config?: BackupManagerConfig): BackupManager {
    if (!backupManagerInstance) {
        backupManagerInstance = new BackupManager(config);
    }
    return backupManagerInstance;
}
