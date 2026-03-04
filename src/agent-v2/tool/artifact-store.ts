import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ARTIFACT_SCHEME = 'artifact://sha256/';
const ARTIFACT_HASH_RE = /^[a-f0-9]{64}$/;

function getArtifactRootDir(): string {
    return process.env.AGENT_ARTIFACT_DIR || path.join(os.tmpdir(), 'coding-agent-artifacts');
}

function getArtifactPathByHash(hash: string): string {
    return path.join(getArtifactRootDir(), 'sha256', `${hash}.txt`);
}

function parseArtifactRef(contentRef: string): string | null {
    if (typeof contentRef !== 'string' || !contentRef.startsWith(ARTIFACT_SCHEME)) {
        return null;
    }
    const hash = contentRef.slice(ARTIFACT_SCHEME.length).trim().toLowerCase();
    if (!ARTIFACT_HASH_RE.test(hash)) {
        return null;
    }
    return hash;
}

export interface StoredArtifact {
    contentRef: string;
    contentBytes: number;
    hash: string;
    filePath: string;
}

export function writeTextArtifactSync(content: string): StoredArtifact {
    const hash = createHash('sha256').update(content, 'utf8').digest('hex');
    const filePath = getArtifactPathByHash(hash);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, 'utf8');
    }
    return {
        contentRef: `${ARTIFACT_SCHEME}${hash}`,
        contentBytes: Buffer.byteLength(content, 'utf8'),
        hash,
        filePath,
    };
}

export function readTextArtifactSync(contentRef: string): StoredArtifact & { content: string } {
    const hash = parseArtifactRef(contentRef);
    if (!hash) {
        const error = new Error(`Invalid contentRef: ${contentRef}`);
        (error as Error & { code?: string }).code = 'INVALID_CONTENT_REF';
        throw error;
    }

    const filePath = getArtifactPathByHash(hash);
    if (!fs.existsSync(filePath)) {
        const error = new Error(`Artifact not found: ${contentRef}`);
        (error as Error & { code?: string }).code = 'ARTIFACT_NOT_FOUND';
        throw error;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return {
        contentRef: `${ARTIFACT_SCHEME}${hash}`,
        content,
        contentBytes: Buffer.byteLength(content, 'utf8'),
        hash,
        filePath,
    };
}

export function isArtifactRef(value: unknown): value is string {
    return typeof value === 'string' && parseArtifactRef(value) !== null;
}
