/**
 * Backup Manager - 备份管理器
 *
 * 管理文件备份，支持自动备份、回滚和清理
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { BackupInfo } from '../types';

/**
 * 备份管理器配置
 */
export interface BackupManagerConfig {
    /** 是否启用备份 */
    enabled?: boolean;
    /** 最大备份数量 */
    maxBackups?: number;
    /** 工作目录 */
    workingDirectory: string;
    /** 备份目录名称 */
    backupDirName?: string;
}

/**
 * BackupManager - 文件备份管理
 */
export class BackupManager {
    private config: Required<BackupManagerConfig>;
    private backups: Map<string, BackupInfo[]> = new Map();

    constructor(config: BackupManagerConfig) {
        this.config = {
            enabled: config.enabled ?? true,
            maxBackups: config.maxBackups ?? 10,
            workingDirectory: config.workingDirectory,
            backupDirName: config.backupDirName ?? '.agent-backups',
        };

        // 初始化备份目录
        this.initializeBackupDir();
    }

    // ========================================================================
    // 备份操作
    // ========================================================================

    /**
     * 创建备份
     */
    async createBackup(filePath: string): Promise<BackupInfo | null> {
        if (!this.config.enabled) {
            return null;
        }

        try {
            // 解析路径
            const fullPath = this.resolvePath(filePath);

            // 检查文件是否存在
            await fs.access(fullPath);

            // 读取文件
            const content = await fs.readFile(fullPath);
            const stats = await fs.stat(fullPath);

            // 生成备份路径
            const timestamp = Date.now();
            const basename = path.basename(fullPath);
            const backupFileName = `${basename}.${timestamp}.backup`;
            const backupPath = path.join(this.getBackupDir(), backupFileName);

            // 写入备份
            await fs.writeFile(backupPath, content);

            // 创建备份信息
            const backupInfo: BackupInfo = {
                id: this.generateBackupId(filePath, timestamp),
                originalPath: fullPath,
                backupPath,
                timestamp,
                size: stats.size,
            };

            // 记录备份
            this.addBackup(filePath, backupInfo);

            // 清理旧备份
            await this.cleanupOldBackups(filePath);

            return backupInfo;
        } catch (error) {
            // 文件不存在或无法读取，不创建备份
            return null;
        }
    }

    /**
     * 恢复备份
     */
    async restoreBackup(backupId: string): Promise<boolean> {
        const backupInfo = this.findBackup(backupId);
        if (!backupInfo) {
            return false;
        }

        try {
            // 读取备份文件
            const content = await fs.readFile(backupInfo.backupPath);

            // 写入原文件
            await fs.writeFile(backupInfo.originalPath, content);

            return true;
        } catch {
            return false;
        }
    }

    /**
     * 恢复最新的备份
     */
    async restoreLatestBackup(filePath: string): Promise<boolean> {
        const backups = this.backups.get(this.normalizePath(filePath));
        if (!backups || backups.length === 0) {
            return false;
        }

        // 按时间排序，获取最新的
        const latest = backups.sort((a, b) => b.timestamp - a.timestamp)[0];
        return this.restoreBackup(latest.id);
    }

    /**
     * 删除备份
     */
    async deleteBackup(backupId: string): Promise<boolean> {
        const backupInfo = this.findBackup(backupId);
        if (!backupInfo) {
            return false;
        }

        try {
            // 删除备份文件
            await fs.unlink(backupInfo.backupPath);

            // 从记录中移除
            this.removeBackup(backupId);

            return true;
        } catch {
            return false;
        }
    }

    // ========================================================================
    // 备份查询
    // ========================================================================

    /**
     * 获取文件的所有备份
     */
    getBackups(filePath: string): BackupInfo[] {
        return this.backups.get(this.normalizePath(filePath)) || [];
    }

    /**
     * 获取最新的备份
     */
    getLatestBackup(filePath: string): BackupInfo | null {
        const backups = this.getBackups(filePath);
        if (backups.length === 0) return null;

        return backups.sort((a, b) => b.timestamp - a.timestamp)[0];
    }

    /**
     * 查找备份
     */
    findBackup(backupId: string): BackupInfo | null {
        for (const backups of this.backups.values()) {
            const found = backups.find(b => b.id === backupId);
            if (found) return found;
        }
        return null;
    }

    /**
     * 获取所有备份
     */
    getAllBackups(): BackupInfo[] {
        const all: BackupInfo[] = [];
        for (const backups of this.backups.values()) {
            all.push(...backups);
        }
        return all;
    }

    /**
     * 获取备份统计
     */
    getStats(): {
        totalBackups: number;
        totalSize: number;
        filesWithBackups: number;
    } {
        let totalBackups = 0;
        let totalSize = 0;

        for (const backups of this.backups.values()) {
            totalBackups += backups.length;
            for (const backup of backups) {
                totalSize += backup.size;
            }
        }

        return {
            totalBackups,
            totalSize,
            filesWithBackups: this.backups.size,
        };
    }

    // ========================================================================
    // 清理操作
    // ========================================================================

    /**
     * 清理旧备份
     */
    async cleanupOldBackups(filePath: string): Promise<void> {
        const normalizedPath = this.normalizePath(filePath);
        const backups = this.backups.get(normalizedPath);

        if (!backups || backups.length <= this.config.maxBackups) {
            return;
        }

        // 按时间排序，删除最旧的
        const sorted = backups.sort((a, b) => a.timestamp - b.timestamp);
        const toDelete = sorted.slice(0, backups.length - this.config.maxBackups);

        for (const backup of toDelete) {
            await this.deleteBackup(backup.id);
        }
    }

    /**
     * 清理所有备份
     */
    async clearAllBackups(): Promise<void> {
        const backupDir = this.getBackupDir();

        try {
            // 删除备份目录中的所有文件
            const files = await fs.readdir(backupDir);
            for (const file of files) {
                const filePath = path.join(backupDir, file);
                await fs.unlink(filePath);
            }

            // 清空记录
            this.backups.clear();
        } catch {
            // 目录不存在或无法访问
        }
    }

    /**
     * 清理过期备份（超过指定天数）
     */
    async cleanupExpiredBackups(maxAgeDays: number = 7): Promise<number> {
        const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
        let deletedCount = 0;

        for (const backups of this.backups.values()) {
            const toDelete = backups.filter(b => b.timestamp < cutoffTime);
            for (const backup of toDelete) {
                if (await this.deleteBackup(backup.id)) {
                    deletedCount++;
                }
            }
        }

        return deletedCount;
    }

    // ========================================================================
    // 私有方法
    // ========================================================================

    /**
     * 初始化备份目录
     */
    private async initializeBackupDir(): Promise<void> {
        if (!this.config.enabled) return;

        try {
            const backupDir = this.getBackupDir();
            await fs.mkdir(backupDir, { recursive: true });

            // 加载现有备份
            await this.loadExistingBackups();
        } catch (error) {
            console.error('Failed to initialize backup directory:', error);
        }
    }

    /**
     * 加载现有备份
     */
    private async loadExistingBackups(): Promise<void> {
        const backupDir = this.getBackupDir();

        try {
            const files = await fs.readdir(backupDir);

            for (const file of files) {
                if (!file.endsWith('.backup')) continue;

                const backupPath = path.join(backupDir, file);
                const stats = await fs.stat(backupPath);

                // 从文件名解析原文件名和时间戳
                const match = file.match(/^(.+)\.(\d+)\.backup$/);
                if (match) {
                    const [, originalName, timestampStr] = match;
                    const timestamp = parseInt(timestampStr, 10);

                    // 这里无法准确恢复原始路径，使用简化处理
                    const backupInfo: BackupInfo = {
                        id: this.generateBackupId(originalName, timestamp),
                        originalPath: originalName,
                        backupPath,
                        timestamp,
                        size: stats.size,
                    };

                    this.addBackup(originalName, backupInfo);
                }
            }
        } catch {
            // 目录为空或无法读取
        }
    }

    /**
     * 获取备份目录路径
     */
    private getBackupDir(): string {
        return path.join(this.config.workingDirectory, this.config.backupDirName);
    }

    /**
     * 生成备份ID
     */
    private generateBackupId(filePath: string, timestamp: number): string {
        return `backup-${this.normalizePath(filePath)}-${timestamp}`;
    }

    /**
     * 标准化路径
     */
    private normalizePath(filePath: string): string {
        return path.normalize(filePath).toLowerCase();
    }

    /**
     * 解析路径
     */
    private resolvePath(inputPath: string): string {
        if (path.isAbsolute(inputPath)) {
            return inputPath;
        }
        return path.resolve(this.config.workingDirectory, inputPath);
    }

    /**
     * 添加备份记录
     */
    private addBackup(filePath: string, backupInfo: BackupInfo): void {
        const normalizedPath = this.normalizePath(filePath);
        if (!this.backups.has(normalizedPath)) {
            this.backups.set(normalizedPath, []);
        }
        this.backups.get(normalizedPath)!.push(backupInfo);
    }

    /**
     * 移除备份记录
     */
    private removeBackup(backupId: string): void {
        for (const [filePath, backups] of this.backups) {
            const index = backups.findIndex(b => b.id === backupId);
            if (index !== -1) {
                backups.splice(index, 1);
                if (backups.length === 0) {
                    this.backups.delete(filePath);
                }
                return;
            }
        }
    }

    // ========================================================================
    // 清理
    // ========================================================================

    /**
     * 清理资源
     */
    dispose(): void {
        this.backups.clear();
    }
}
