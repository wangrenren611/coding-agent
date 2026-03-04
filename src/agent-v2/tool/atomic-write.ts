import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface AtomicWriteOptions {
    encoding?: BufferEncoding;
    mode?: number;
    fsyncDirectory?: boolean;
}

const IGNORE_DIR_FSYNC_ERROR_CODES = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF']);

function fsyncDirectoryBestEffort(dirPath: string): void {
    let dirFd: number | undefined;
    try {
        dirFd = fs.openSync(dirPath, 'r');
        fs.fsyncSync(dirFd);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code && IGNORE_DIR_FSYNC_ERROR_CODES.has(code)) {
            return;
        }
        throw error;
    } finally {
        if (dirFd !== undefined) {
            try {
                fs.closeSync(dirFd);
            } catch {
                // ignore cleanup errors
            }
        }
    }
}

/**
 * Write content via tmp file + atomic rename.
 * Temp file is created in the target directory to guarantee rename atomicity.
 */
export function atomicWriteFileSync(filePath: string, content: string, options: AtomicWriteOptions = {}): void {
    const { encoding = 'utf-8', mode = 0o666, fsyncDirectory = true } = options;

    const dirPath = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const tempFilePath = path.join(dirPath, `.${baseName}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);

    let tempFd: number | undefined;
    try {
        tempFd = fs.openSync(tempFilePath, 'w', mode);
        fs.writeFileSync(tempFd, content, { encoding });
        fs.fsyncSync(tempFd);
        fs.closeSync(tempFd);
        tempFd = undefined;

        fs.renameSync(tempFilePath, filePath);

        if (fsyncDirectory) {
            fsyncDirectoryBestEffort(dirPath);
        }
    } finally {
        if (tempFd !== undefined) {
            try {
                fs.closeSync(tempFd);
            } catch {
                // ignore cleanup errors
            }
        }

        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch {
                // ignore cleanup errors
            }
        }
    }
}
