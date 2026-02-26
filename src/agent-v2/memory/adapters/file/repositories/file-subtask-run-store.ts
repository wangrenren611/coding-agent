import * as path from 'path';
import type { SubTaskRunData } from '../../../types';
import type { SubTaskRunStore } from '../../../ports/stores';
import { AtomicJsonStore } from '../atomic-json';
import { encodeSubTaskRunFileName, safeDecodeSubTaskRunFileName } from '../filename-codec';

export class FileSubTaskRunStore implements SubTaskRunStore {
    private readonly dirPath: string;

    constructor(
        basePath: string,
        private readonly io: AtomicJsonStore
    ) {
        this.dirPath = path.join(basePath, 'subtask-runs');
    }

    async prepare(): Promise<void> {
        await this.io.ensureDir(this.dirPath);
    }

    async loadAll(): Promise<Map<string, SubTaskRunData>> {
        const items = new Map<string, SubTaskRunData>();
        const files = await this.io.listJsonFiles(this.dirPath);

        for (const fileName of files) {
            if (!fileName.startsWith('subtask-run-')) continue;
            const runId = safeDecodeSubTaskRunFileName(fileName);
            if (!runId) continue;

            try {
                const run = await this.io.readJsonFile<SubTaskRunData>(this.filePath(runId));
                if (!run) continue;
                items.set(runId, run);
            } catch (error) {
                console.error(`Error loading sub task run ${runId}:`, error);
            }
        }

        return items;
    }

    async save(runId: string, run: SubTaskRunData): Promise<void> {
        await this.io.writeJsonFile(this.filePath(runId), run);
    }

    async delete(runId: string): Promise<void> {
        await this.io.deleteFileIfExists(this.filePath(runId));
    }

    private filePath(runId: string): string {
        return path.join(this.dirPath, encodeSubTaskRunFileName(runId));
    }
}
