import * as path from 'path';
import type { CompactionRecord } from '../../../types';
import type { CompactionStore } from '../../../ports/stores';
import { AtomicJsonStore } from '../atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from '../filename-codec';

export class FileCompactionStore implements CompactionStore {
    private readonly dirPath: string;

    constructor(
        basePath: string,
        private readonly io: AtomicJsonStore
    ) {
        this.dirPath = path.join(basePath, 'compactions');
    }

    async prepare(): Promise<void> {
        await this.io.ensureDir(this.dirPath);
    }

    async loadAll(): Promise<Map<string, CompactionRecord[]>> {
        const items = new Map<string, CompactionRecord[]>();
        const files = await this.io.listJsonFiles(this.dirPath);
        for (const fileName of files) {
            const sessionId = safeDecodeEntityFileName(fileName);
            if (!sessionId) continue;

            const filePath = this.filePath(sessionId);
            try {
                const records = await this.io.readJsonFile<CompactionRecord[]>(filePath);
                if (!records) continue;
                items.set(sessionId, records);
            } catch (error) {
                console.error(`Error loading compactions ${sessionId}:`, error);
            }
        }
        return items;
    }

    async save(sessionId: string, records: CompactionRecord[]): Promise<void> {
        await this.io.writeJsonFile(this.filePath(sessionId), records);
    }

    private filePath(sessionId: string): string {
        return path.join(this.dirPath, encodeEntityFileName(sessionId));
    }
}
