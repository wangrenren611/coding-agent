import * as path from 'path';
import type { CurrentContext } from '../../../types';
import type { ContextStore } from '../../../ports/stores';
import { AtomicJsonStore } from '../atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from '../filename-codec';

export class FileContextStore implements ContextStore {
    private readonly dirPath: string;

    constructor(
        basePath: string,
        private readonly io: AtomicJsonStore
    ) {
        this.dirPath = path.join(basePath, 'contexts');
    }

    async prepare(): Promise<void> {
        await this.io.ensureDir(this.dirPath);
    }

    async loadAll(): Promise<Map<string, CurrentContext>> {
        const items = new Map<string, CurrentContext>();
        const files = await this.io.listJsonFiles(this.dirPath);
        for (const fileName of files) {
            const sessionId = safeDecodeEntityFileName(fileName);
            if (!sessionId) continue;

            const filePath = this.filePath(sessionId);
            try {
                const context = await this.io.readJsonFile<CurrentContext>(filePath);
                if (!context) continue;
                items.set(sessionId, { ...context, sessionId });
            } catch (error) {
                console.error(`Error loading context ${sessionId}:`, error);
            }
        }
        return items;
    }

    async save(sessionId: string, context: CurrentContext): Promise<void> {
        await this.io.writeJsonFile(this.filePath(sessionId), context);
    }

    private filePath(sessionId: string): string {
        return path.join(this.dirPath, encodeEntityFileName(sessionId));
    }
}
