import * as path from 'path';
import type { SessionData } from '../../../types';
import type { SessionStore } from '../../../ports/stores';
import { AtomicJsonStore } from '../atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from '../filename-codec';

export class FileSessionStore implements SessionStore {
    private readonly dirPath: string;

    constructor(
        basePath: string,
        private readonly io: AtomicJsonStore
    ) {
        this.dirPath = path.join(basePath, 'sessions');
    }

    async prepare(): Promise<void> {
        await this.io.ensureDir(this.dirPath);
    }

    async loadAll(): Promise<Map<string, SessionData>> {
        const items = new Map<string, SessionData>();
        const files = await this.io.listJsonFiles(this.dirPath);
        for (const fileName of files) {
            const sessionId = safeDecodeEntityFileName(fileName);
            if (!sessionId) continue;

            const filePath = this.filePath(sessionId);
            try {
                const session = await this.io.readJsonFile<SessionData>(filePath);
                if (!session) continue;
                items.set(sessionId, { ...session, sessionId });
            } catch (error) {
                console.error(`Error loading session ${sessionId}:`, error);
            }
        }
        return items;
    }

    async save(sessionId: string, session: SessionData): Promise<void> {
        await this.io.writeJsonFile(this.filePath(sessionId), session);
    }

    private filePath(sessionId: string): string {
        return path.join(this.dirPath, encodeEntityFileName(sessionId));
    }
}
