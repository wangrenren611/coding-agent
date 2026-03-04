import { createHash } from 'crypto';

interface FileReadSnapshot {
    hash: string;
    version: number;
    readAt: number;
}

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const sessionSnapshots = new Map<string, Map<string, FileReadSnapshot>>();
const textNotFoundRetries = new Map<string, number>();

const OLD_TEXT_PLACEHOLDER_PATTERNS: RegExp[] = [/\[\s*\.\.\.[\s\S]*?\]/i, /content\s+truncated/i, /for\s+brevity/i];

function getSessionSnapshots(sessionId: string): Map<string, FileReadSnapshot> {
    let snapshots = sessionSnapshots.get(sessionId);
    if (!snapshots) {
        snapshots = new Map<string, FileReadSnapshot>();
        sessionSnapshots.set(sessionId, snapshots);
    }
    return snapshots;
}

function isSnapshotExpired(snapshot: FileReadSnapshot): boolean {
    return Date.now() - snapshot.readAt > SNAPSHOT_TTL_MS;
}

function buildTextNotFoundRetryKey(sessionId: string, filePath: string, line: number, oldText: string): string {
    const oldTextHash = computeContentHash(oldText);
    return `${sessionId}:${filePath}:${line}:${oldTextHash}`;
}

export type EditPreconditionResult =
    | { ok: true; currentHash: string; snapshotVersion?: number }
    | { ok: false; code: string; message: string };

export function computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

export function containsOldTextPlaceholder(oldText: string): boolean {
    return OLD_TEXT_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(oldText));
}

export function recordReadSnapshot(
    sessionId: string | undefined,
    filePath: string,
    content: string
): { hash: string; version: number } | null {
    if (!sessionId) {
        return null;
    }

    const snapshots = getSessionSnapshots(sessionId);
    const previous = snapshots.get(filePath);
    const nextVersion = (previous?.version ?? 0) + 1;
    const nextHash = computeContentHash(content);

    snapshots.set(filePath, {
        hash: nextHash,
        version: nextVersion,
        readAt: Date.now(),
    });

    return { hash: nextHash, version: nextVersion };
}

export function validateEditPreconditions({
    sessionId,
    filePath,
    currentContent,
    expectedHash,
    expectedVersion,
    requireReadSnapshot = true,
}: {
    sessionId?: string;
    filePath: string;
    currentContent: string;
    expectedHash?: string;
    expectedVersion?: number;
    requireReadSnapshot?: boolean;
}): EditPreconditionResult {
    const currentHash = computeContentHash(currentContent);

    if (!sessionId) {
        if (expectedHash && expectedHash !== currentHash) {
            return {
                ok: false,
                code: 'EXPECTED_HASH_MISMATCH',
                message: 'expectedHash does not match current file content. Please read_file and retry.',
            };
        }
        return { ok: true, currentHash };
    }

    const snapshots = getSessionSnapshots(sessionId);
    const snapshot = snapshots.get(filePath);

    if (requireReadSnapshot && !snapshot) {
        return {
            ok: false,
            code: 'READ_SNAPSHOT_REQUIRED',
            message: 'No recent read_file snapshot for this file. Please run read_file first.',
        };
    }

    if (snapshot && isSnapshotExpired(snapshot)) {
        snapshots.delete(filePath);
        return {
            ok: false,
            code: 'STALE_READ_SNAPSHOT',
            message: 'Read snapshot expired. Please run read_file again before editing.',
        };
    }

    if (snapshot && snapshot.hash !== currentHash) {
        snapshots.delete(filePath);
        return {
            ok: false,
            code: 'SNAPSHOT_CONTENT_MISMATCH',
            message: 'File content changed since read_file snapshot. Please re-read before editing.',
        };
    }

    if (expectedHash && expectedHash !== currentHash) {
        return {
            ok: false,
            code: 'EXPECTED_HASH_MISMATCH',
            message: 'expectedHash does not match current file content. Please read_file and retry.',
        };
    }

    if (expectedVersion !== undefined) {
        if (!snapshot) {
            return {
                ok: false,
                code: 'EXPECTED_VERSION_WITHOUT_SNAPSHOT',
                message: 'expectedVersion requires an active read_file snapshot. Please run read_file first.',
            };
        }

        if (snapshot.version !== expectedVersion) {
            return {
                ok: false,
                code: 'EXPECTED_VERSION_MISMATCH',
                message: `expectedVersion=${expectedVersion} does not match snapshotVersion=${snapshot.version}. Please re-read before editing.`,
            };
        }
    }

    return { ok: true, currentHash, snapshotVersion: snapshot?.version };
}

export function invalidateReadSnapshot(sessionId: string | undefined, filePath: string): void {
    if (!sessionId) return;
    const snapshots = sessionSnapshots.get(sessionId);
    snapshots?.delete(filePath);
}

export function registerTextNotFoundRetry(
    sessionId: string | undefined,
    filePath: string,
    line: number,
    oldText: string
): number {
    if (!sessionId) {
        return 0;
    }

    const key = buildTextNotFoundRetryKey(sessionId, filePath, line, oldText);
    const nextCount = (textNotFoundRetries.get(key) ?? 0) + 1;
    textNotFoundRetries.set(key, nextCount);
    return nextCount;
}

export function clearTextNotFoundRetry(
    sessionId: string | undefined,
    filePath: string,
    line: number,
    oldText: string
): void {
    if (!sessionId) {
        return;
    }

    const key = buildTextNotFoundRetryKey(sessionId, filePath, line, oldText);
    textNotFoundRetries.delete(key);
}
