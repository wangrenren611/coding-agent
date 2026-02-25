import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';
import { getBackupManager } from '../util/backup-manager';
import { resolveAndValidatePath, PathTraversalError } from './file';

export class RollbackTool extends BaseTool<any> {
    name = 'rollback_file';

    description = 'Restore file to a previous backup version.';

    schema = z.object({
        filePath: z.string().describe('File path to restore'),
        backupId: z.string().describe('Backup ID to restore to'),
    });

    async execute({ filePath, backupId }: z.infer<typeof this.schema>, _context?: ToolContext): Promise<ToolResult> {
        let fullPath: string;
        try {
            fullPath = resolveAndValidatePath(filePath);
        } catch (error) {
            if (error instanceof PathTraversalError) {
                return this.result({
                    success: false,
                    metadata: { error: 'PATH_TRAVERSAL_DETECTED', filePath } as any,
                    output: `PATH_TRAVERSAL_DETECTED: ${error.message}`,
                });
            }
            throw error;
        }

        // === 业务错误：文件不存在 ===
        if (!fs.existsSync(fullPath)) {
            return this.result({
                success: false,
                metadata: { error: 'FILE_NOT_FOUND', filePath, code: 'FILE_NOT_FOUND' } as any,
                output: 'FILE_NOT_FOUND: File does not exist',
            });
        }

        // === 初始化备份管理器 ===
        const backupManager = getBackupManager();
        await backupManager.initialize();

        // === 业务错误：恢复失败 ===
        let success: boolean;
        try {
            success = await backupManager.restore(fullPath, backupId);
        } catch (error) {
            return this.result({
                success: false,
                metadata: { error: 'RESTORE_FAILED', code: 'RESTORE_FAILED', backupId } as any,
                output: `RESTORE_FAILED: Restore operation failed: ${error}`,
            });
        }

        if (success) {
            return this.result({
                success: true,
                metadata: { filePath, backupId, restored: true, toolName: this.name },
                output: `Successfully restored file to backup ${backupId}`,
            });
        } else {
            return this.result({
                success: false,
                metadata: { error: 'BACKUP_NOT_FOUND', code: 'BACKUP_NOT_FOUND', backupId } as any,
                output: `BACKUP_NOT_FOUND: Backup not found: ${backupId}`,
            });
        }
    }
}

export class ListBackupsTool extends BaseTool<any> {
    name = 'list_backups';

    description = 'List all available backups for a file.';

    schema = z.object({
        filePath: z.string().describe('File path to list backups for'),
    });

    async execute({ filePath }: z.infer<typeof this.schema>, _context?: ToolContext): Promise<ToolResult> {
        let fullPath: string;
        try {
            fullPath = resolveAndValidatePath(filePath);
        } catch (error) {
            if (error instanceof PathTraversalError) {
                return this.result({
                    success: false,
                    metadata: { error: 'PATH_TRAVERSAL_DETECTED', filePath } as any,
                    output: `PATH_TRAVERSAL_DETECTED: ${error.message}`,
                });
            }
            throw error;
        }

        const backupManager = getBackupManager();
        await backupManager.initialize();

        const backups = backupManager.getBackups(fullPath);

        const formattedBackups = backups.map((backup) => ({
            id: backup.id,
            createdAt: new Date(backup.createdAt).toLocaleString('zh-CN'),
            size: backup.size,
            sizeFormatted: backup.size > 1024 ? `${(backup.size / 1024).toFixed(2)} KB` : `${backup.size} B`,
        }));

        const data = { filePath, backups: formattedBackups };

        return this.result({
            success: true,
            metadata: { ...data, toolName: this.name },
            output: `Found ${backups.length} backup(s) for file`,
        });
    }
}

export class CleanBackupsTool extends BaseTool<any> {
    name = 'clean_backups';

    description = 'Delete all backups for a file. This action is irreversible.';

    schema = z.object({
        filePath: z.string().describe('File path to clean backups for'),
        confirm: z.boolean().describe('Set to true to confirm deletion').default(false),
    });

    async execute({ filePath, confirm }: z.infer<typeof this.schema>, _context?: ToolContext): Promise<ToolResult> {
        // === 业务错误：未确认 ===
        if (!confirm) {
            return this.result({
                success: false,
                metadata: {
                    error: 'CONFIRMATION_REQUIRED',
                    code: 'CONFIRMATION_REQUIRED',
                    message: 'Set confirm=true to proceed with deletion',
                } as any,
                output: 'CONFIRMATION_REQUIRED: Set confirm=true to proceed with deletion',
            });
        }

        let fullPath: string;
        try {
            fullPath = resolveAndValidatePath(filePath);
        } catch (error) {
            if (error instanceof PathTraversalError) {
                return this.result({
                    success: false,
                    metadata: { error: 'PATH_TRAVERSAL_DETECTED', filePath } as any,
                    output: `PATH_TRAVERSAL_DETECTED: ${error.message}`,
                });
            }
            throw error;
        }

        const backupManager = getBackupManager();
        await backupManager.initialize();

        // === 清理备份 ===
        try {
            await backupManager.clean(fullPath);
        } catch (error) {
            return this.result({
                success: false,
                metadata: { error: 'CLEAN_FAILED', code: 'CLEAN_FAILED' } as any,
                output: `CLEAN_FAILED: Clean operation failed: ${error}`,
            });
        }

        return this.result({
            success: true,
            metadata: { filePath, cleaned: true, toolName: this.name },
            output: 'Successfully cleaned all backups for file',
        });
    }
}
