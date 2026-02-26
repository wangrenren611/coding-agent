import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

export class AtomicJsonStore {
    private readonly fileOperationQueue = new Map<string, Promise<void>>();
    private readonly pendingFileOperations = new Set<Promise<void>>();

    async ensureDir(dirPath: string): Promise<void> {
        await fs.mkdir(dirPath, { recursive: true });
    }

    async listJsonFiles(dirPath: string): Promise<string[]> {
        const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
        return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));
    }

    async readJsonFile<T>(filePath: string): Promise<T | null> {
        const raw = await this.readTextIfExists(filePath);
        if (raw === null) {
            const backupPath = this.getBackupFilePath(filePath);
            const backupRaw = await this.readTextIfExists(backupPath);
            if (backupRaw !== null) {
                const parsedBackup = this.parseJsonText<T>(backupRaw, backupPath);
                if (parsedBackup.ok) {
                    console.error(`[AtomicJsonStore] Restoring missing file from backup: ${filePath}`);
                    await this.writeJsonFile(filePath, parsedBackup.value);
                    return parsedBackup.value;
                }
                throw parsedBackup.error;
            }
            return null;
        }

        const parsedPrimary = this.parseJsonText<T>(raw, filePath);
        if (parsedPrimary.ok) {
            return parsedPrimary.value;
        }
        const primaryError = parsedPrimary.error;

        const backupPath = this.getBackupFilePath(filePath);
        const backupRaw = await this.readTextIfExists(backupPath);
        if (backupRaw !== null) {
            const parsedBackup = this.parseJsonText<T>(backupRaw, backupPath);
            if (parsedBackup.ok) {
                console.error(`[AtomicJsonStore] Recovered from backup for ${filePath}:`, primaryError);
                await this.archiveCorruptedFile(filePath);
                await this.writeJsonFile(filePath, parsedBackup.value);
                return parsedBackup.value;
            }
        }

        throw primaryError;
    }

    async writeJsonFile(filePath: string, value: unknown): Promise<void> {
        const json = JSON.stringify(value, null, 2);

        await this.enqueueFileOperation(filePath, async () => {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await this.copyFileIfExists(filePath, this.getBackupFilePath(filePath));

            const tempFilePath = this.buildTempFilePath(filePath);
            try {
                await fs.writeFile(tempFilePath, json, 'utf-8');
                await this.renameWithRetry(tempFilePath, filePath);
            } finally {
                await this.unlinkIfExists(tempFilePath);
            }
        });
    }

    async deleteFileIfExists(filePath: string): Promise<void> {
        await this.enqueueFileOperation(filePath, async () => {
            await this.unlinkIfExists(filePath);
            await this.unlinkIfExists(this.getBackupFilePath(filePath));
        });
    }

    async close(): Promise<void> {
        if (this.pendingFileOperations.size === 0) {
            return;
        }
        await Promise.allSettled([...this.pendingFileOperations]);
    }

    private async renameWithRetry(src: string, dest: string, maxRetries = 5, delayMs = 100): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt += 1) {
            try {
                await fs.rename(src, dest);
                return;
            } catch (error) {
                lastError = error as Error;
                const isEperm =
                    error &&
                    typeof error === 'object' &&
                    'code' in error &&
                    (error as { code?: string }).code === 'EPERM';

                if (isEperm && attempt < maxRetries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
                    continue;
                }
                throw error;
            }
        }

        throw lastError;
    }

    private async archiveCorruptedFile(filePath: string): Promise<void> {
        const archivedPath = `${filePath}.corrupt-${Date.now()}`;
        try {
            await fs.rename(filePath, archivedPath);
        } catch (error) {
            if (this.isNotFound(error)) {
                return;
            }
            throw error;
        }
    }

    private getBackupFilePath(filePath: string): string {
        return `${filePath}.bak`;
    }

    private buildTempFilePath(filePath: string): string {
        const base = path.basename(filePath);
        const dir = path.dirname(filePath);
        return path.join(dir, `.${base}.${process.pid}.${Date.now()}.${uuid()}.tmp`);
    }

    private async readTextIfExists(filePath: string): Promise<string | null> {
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch (error) {
            if (this.isNotFound(error)) {
                return null;
            }
            throw error;
        }
    }

    private parseJsonText<T>(raw: string, filePath: string): { ok: true; value: T } | { ok: false; error: Error } {
        try {
            const normalized = raw.trim();
            if (normalized.length === 0) {
                return {
                    ok: false,
                    error: new Error(`JSON file is empty: ${filePath}`),
                };
            }

            return {
                ok: true,
                value: JSON.parse(normalized) as T,
            };
        } catch (error) {
            const wrapped =
                error instanceof Error
                    ? new Error(`Failed to parse JSON ${filePath}: ${error.message}`)
                    : new Error(`Failed to parse JSON ${filePath}`);
            return {
                ok: false,
                error: wrapped,
            };
        }
    }

    private async copyFileIfExists(fromPath: string, toPath: string): Promise<void> {
        try {
            await fs.copyFile(fromPath, toPath);
        } catch (error) {
            if (this.isNotFound(error)) {
                return;
            }
            throw error;
        }
    }

    private async unlinkIfExists(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
        } catch (error) {
            if (this.isNotFound(error)) {
                return;
            }
            throw error;
        }
    }

    private enqueueFileOperation(filePath: string, operation: () => Promise<void>): Promise<void> {
        const previous = this.fileOperationQueue.get(filePath) || Promise.resolve();
        const pending = previous
            .catch(() => {
                // Keep queue chain alive even after previous error.
            })
            .then(operation);

        const tracked = pending.finally(() => {
            if (this.fileOperationQueue.get(filePath) === tracked) {
                this.fileOperationQueue.delete(filePath);
            }
            this.pendingFileOperations.delete(tracked);
        });

        this.fileOperationQueue.set(filePath, tracked);
        this.pendingFileOperations.add(tracked);
        return tracked;
    }

    private isNotFound(error: unknown): boolean {
        return Boolean(
            error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT'
        );
    }
}
