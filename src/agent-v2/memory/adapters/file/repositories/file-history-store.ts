import * as path from 'path';
import type { HistoryMessage } from '../../../types';
import type { HistoryStore } from '../../../ports/stores';
import { AtomicJsonStore } from '../atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from '../filename-codec';

export class FileHistoryStore implements HistoryStore {
    private readonly dirPath: string;

    constructor(
        basePath: string,
        private readonly io: AtomicJsonStore
    ) {
        this.dirPath = path.join(basePath, 'histories');
    }

    async prepare(): Promise<void> {
        await this.io.ensureDir(this.dirPath);
    }

    async loadAll(): Promise<Map<string, HistoryMessage[]>> {
        const items = new Map<string, HistoryMessage[]>();
        const files = await this.io.listJsonFiles(this.dirPath);
        for (const fileName of files) {
            const sessionId = safeDecodeEntityFileName(fileName);
            if (!sessionId) continue;

            const filePath = this.filePath(sessionId);
            try {
                const history = await this.io.readJsonFile<HistoryMessage[]>(filePath);
                if (!history) continue;
                items.set(sessionId, history);
            } catch (error) {
                console.error(`Error loading history ${sessionId}:`, error);
            }
        }
        return items;
    }

    async save(sessionId: string, history: HistoryMessage[]): Promise<void> {
        await this.io.writeJsonFile(this.filePath(sessionId), history);
    }

    private filePath(sessionId: string): string {
        return path.join(this.dirPath, encodeEntityFileName(sessionId));
    }
}
