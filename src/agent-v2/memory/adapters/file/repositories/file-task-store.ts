import * as path from 'path';
import type { TaskData } from '../../../types';
import type { TaskStore } from '../../../ports/stores';
import { AtomicJsonStore } from '../atomic-json';
import { encodeTaskListFileName, safeDecodeTaskListFileName } from '../filename-codec';

export class FileTaskStore implements TaskStore {
    private readonly dirPath: string;

    constructor(basePath: string, private readonly io: AtomicJsonStore) {
        this.dirPath = path.join(basePath, 'tasks');
    }

    async prepare(): Promise<void> {
        await this.io.ensureDir(this.dirPath);
    }

    async loadAll(): Promise<Map<string, TaskData>> {
        const items = new Map<string, TaskData>();
        const files = await this.io.listJsonFiles(this.dirPath);

        for (const fileName of files) {
            if (!fileName.startsWith('task-list-')) continue;
            const sessionId = safeDecodeTaskListFileName(fileName);
            if (!sessionId) continue;

            try {
                const tasks = await this.io.readJsonFile<TaskData[]>(this.filePath(sessionId));
                if (!tasks) continue;

                for (const task of tasks) {
                    const existing = items.get(task.taskId);
                    if (existing && existing.sessionId !== sessionId) {
                        console.error(
                            `Task ID collision while loading: ${task.taskId} appears in both ${existing.sessionId} and ${sessionId}. Keeping latest file value.`
                        );
                    }
                    items.set(task.taskId, {
                        ...task,
                        sessionId,
                    });
                }
            } catch (error) {
                console.error(`Error loading task list ${sessionId}:`, error);
            }
        }

        return items;
    }

    async saveBySession(sessionId: string, tasks: TaskData[]): Promise<void> {
        const filePath = this.filePath(sessionId);
        if (tasks.length === 0) {
            await this.io.deleteFileIfExists(filePath);
            return;
        }

        const sorted = [...tasks].sort((a, b) => a.createdAt - b.createdAt);
        await this.io.writeJsonFile(filePath, sorted);
    }

    private filePath(sessionId: string): string {
        return path.join(this.dirPath, encodeTaskListFileName(sessionId));
    }
}
