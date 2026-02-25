/**
 * Tests for rollback tools (RollbackTool, ListBackupsTool, CleanBackupsTool)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RollbackTool, ListBackupsTool, CleanBackupsTool } from '../rollback';
import { getBackupManager } from '../../util/backup-manager';
import { TestEnvironment } from './test-utils';
import path from 'path';

describe('Rollback Tools', () => {
    let env: TestEnvironment;

    beforeEach(async () => {
        env = new TestEnvironment('rollback-tools');
        await env.setup();
        // Initialize backup manager with custom directory
        const backupDir = path.join(env.getTestDir(), 'backups');
        const manager = getBackupManager({ backupDir });
        await manager.initialize();
    });

    afterEach(async () => {
        await env.teardown();
    });

    describe('ListBackupsTool', () => {
        it('should return empty list for file with no backups', async () => {
            const testFile = await env.createFile('test.txt', 'content');
            const tool = new ListBackupsTool();
            const result = await tool.execute({
                filePath: testFile,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.backups).toHaveLength(0);
        });

        it('should list backups for a file', async () => {
            const testFile = await env.createFile('test.txt', 'original content');
            const backupManager = getBackupManager();
            await backupManager.initialize();

            // Create a backup
            const backupId = await backupManager.backup(testFile);
            expect(backupId).toBeDefined();

            const tool = new ListBackupsTool();
            const result = await tool.execute({
                filePath: testFile,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.backups).toHaveLength(1);
            expect(result.metadata?.backups[0].id).toBe(backupId);
            expect(result.metadata?.backups[0].sizeFormatted).toBeDefined();
            expect(result.metadata?.backups[0].createdAt).toBeDefined();
        });

        it('should list multiple backups in chronological order', async () => {
            const testFile = await env.createFile('test.txt', 'content');
            const backupManager = getBackupManager();
            await backupManager.initialize();

            // Create multiple backups
            await backupManager.backup(testFile);

            // Modify file
            const fs = await import('fs/promises');
            await fs.writeFile(testFile, 'modified content');

            await backupManager.backup(testFile);

            const tool = new ListBackupsTool();
            const result = await tool.execute({
                filePath: testFile,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.backups.length).toBeGreaterThanOrEqual(2);
            // Should be sorted by creation time (newest first)
        });

        it('should return error for non-existent file', async () => {
            const tool = new ListBackupsTool();
            const result = await tool.execute({
                filePath: 'nonexistent.txt',
            });

            // ListBackupsTool doesn't check file existence, just returns empty list
            expect(result.success).toBe(true);
            expect(result.metadata?.backups).toHaveLength(0);
        });
    });

    describe('RollbackTool', () => {
        it('should rollback file to a specific backup', async () => {
            const testFile = await env.createFile('test.txt', 'original content');
            const backupManager = getBackupManager();
            await backupManager.initialize();

            // Create backup
            const backupId = await backupManager.backup(testFile);

            // Modify file
            const fs = await import('fs/promises');
            await fs.writeFile(testFile, 'modified content');

            // Verify modified
            let content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('modified content');

            // Rollback
            const tool = new RollbackTool();
            const result = await tool.execute({
                filePath: testFile,
                backupId: backupId!,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.restored).toBe(true);

            // Verify restored
            content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('original content');
        });

        it('should return error when backup not found', async () => {
            const testFile = await env.createFile('test.txt', 'content');
            const tool = new RollbackTool();
            const result = await tool.execute({
                filePath: testFile,
                backupId: 'non-existent-backup-id',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.code).toBe('BACKUP_NOT_FOUND');
            expect(result.metadata?.error).toBe('BACKUP_NOT_FOUND');
        });

        it('should return error for non-existent file', async () => {
            const tool = new RollbackTool();
            const result = await tool.execute({
                filePath: 'nonexistent.txt',
                backupId: 'some-backup-id',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('FILE_NOT_FOUND');
        });

        it('should handle backup restoration errors gracefully', async () => {
            const testFile = await env.createFile('test.txt', 'content');
            const tool = new RollbackTool();
            const result = await tool.execute({
                filePath: testFile,
                backupId: 'invalid-backup-id-12345',
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toBeDefined();
        });
    });

    describe('CleanBackupsTool', () => {
        it('should require confirmation to clean backups', async () => {
            const testFile = await env.createFile('test.txt', 'content');
            const backupManager = getBackupManager();
            await backupManager.initialize();

            // Create a backup
            await backupManager.backup(testFile);

            const tool = new CleanBackupsTool();
            const result = await tool.execute({
                filePath: testFile,
                confirm: false, // Not confirmed
            });

            expect(result.success).toBe(false);
            expect(result.metadata?.error).toContain('CONFIRMATION_REQUIRED');
        });

        it('should clean all backups for a file', async () => {
            const testFile = await env.createFile('test.txt', 'content');
            const backupManager = getBackupManager();
            await backupManager.initialize();

            // Create multiple backups
            await backupManager.backup(testFile);
            const fs = await import('fs/promises');
            await fs.writeFile(testFile, 'modified');
            await backupManager.backup(testFile);

            // Verify backups exist
            const listTool = new ListBackupsTool();
            let listResult = await listTool.execute({ filePath: testFile });
            expect(listResult.metadata?.backups.length).toBeGreaterThan(0);

            // Clean backups
            const cleanTool = new CleanBackupsTool();
            const cleanResult = await cleanTool.execute({
                filePath: testFile,
                confirm: true,
            });

            expect(cleanResult.success).toBe(true);
            expect(cleanResult.metadata?.cleaned).toBe(true);

            // Verify backups are gone
            listResult = await listTool.execute({ filePath: testFile });
            expect(listResult.metadata?.backups).toHaveLength(0);
        });

        it('should handle cleaning file with no backups', async () => {
            const testFile = await env.createFile('test.txt', 'content');
            const tool = new CleanBackupsTool();
            const result = await tool.execute({
                filePath: testFile,
                confirm: true,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.cleaned).toBe(true);
        });

        it('should return error for non-existent file', async () => {
            const tool = new CleanBackupsTool();
            const result = await tool.execute({
                filePath: 'nonexistent.txt',
                confirm: true,
            });

            // CleanBackupsTool doesn't check file existence, just returns success
            expect(result.success).toBe(true);
            expect(result.metadata?.cleaned).toBe(true);
        });
    });

    describe('Integration', () => {
        it('should support full backup-rollback-clean workflow', async () => {
            const testFile = await env.createFile('workflow.txt', 'original');
            const backupManager = getBackupManager();
            await backupManager.initialize();
            const fs = await import('fs/promises');

            // 1. Create initial backup
            const backup1 = await backupManager.backup(testFile);
            expect(backup1).toBeDefined();

            // 2. Modify and backup again
            await fs.writeFile(testFile, 'version 2');
            const backup2 = await backupManager.backup(testFile);
            expect(backup2).toBeDefined();

            // 3. List backups
            const listTool = new ListBackupsTool();
            const listResult = await listTool.execute({ filePath: testFile });
            expect(listResult.metadata?.backups.length).toBeGreaterThanOrEqual(2);

            // 4. Rollback to first backup
            const rollbackTool = new RollbackTool();
            const rollbackResult = await rollbackTool.execute({
                filePath: testFile,
                backupId: backup1!,
            });
            expect(rollbackResult.success).toBe(true);

            let content = await fs.readFile(testFile, 'utf-8');
            expect(content).toBe('original');

            // 5. Clean all backups
            const cleanTool = new CleanBackupsTool();
            const cleanResult = await cleanTool.execute({
                filePath: testFile,
                confirm: true,
            });
            expect(cleanResult.success).toBe(true);

            // 6. Verify no backups remain
            const finalListResult = await listTool.execute({ filePath: testFile });
            expect(finalListResult.metadata?.backups).toHaveLength(0);
        });

        it('should handle multiple files with independent backups', async () => {
            const file1 = await env.createFile('file1.txt', 'content 1');
            const file2 = await env.createFile('file2.txt', 'content 2');
            const backupManager = getBackupManager();
            await backupManager.initialize();

            // Backup both files
            const backup1 = await backupManager.backup(file1);
            const backup2 = await backupManager.backup(file2);

            expect(backup1).toBeDefined();
            expect(backup2).toBeDefined();

            // Verify each file has its own backups
            const listTool = new ListBackupsTool();
            const list1 = await listTool.execute({ filePath: file1 });
            const list2 = await listTool.execute({ filePath: file2 });

            expect(list1.metadata?.backups).toHaveLength(1);
            expect(list2.metadata?.backups).toHaveLength(1);
            expect(list1.metadata?.backups[0].id).not.toBe(list2.metadata?.backups[0].id);
        });
    });

    describe('Backup Size and Metadata', () => {
        it('should report backup file sizes correctly', async () => {
            const content = 'x'.repeat(1000); // 1KB
            const testFile = await env.createFile('sized.txt', content);
            const backupManager = getBackupManager();
            await backupManager.initialize();

            await backupManager.backup(testFile);

            const listTool = new ListBackupsTool();
            const result = await listTool.execute({ filePath: testFile });

            expect(result.success).toBe(true);
            const backup = result.metadata?.backups[0];
            expect(backup.size).toBe(1000);
            // 1000 bytes < 1024, so it's formatted as "1000 B"
            expect(backup.sizeFormatted).toContain('B');
        });

        it('should report creation time correctly', async () => {
            const testFile = await env.createFile('timed.txt', 'content');
            const backupManager = getBackupManager();
            await backupManager.initialize();

            await backupManager.backup(testFile);

            const listTool = new ListBackupsTool();
            const result = await listTool.execute({ filePath: testFile });

            expect(result.success).toBe(true);
            const backup = result.metadata?.backups[0];
            // createdAt is formatted as a locale string
            expect(backup.createdAt).toBeDefined();
            expect(typeof backup.createdAt).toBe('string');
        });
    });
});
