import { clone, paginate, sortByTimestamp } from '../domain/helpers';
import type { MemoryStoreBundle } from '../ports/stores';
import type { QueryOptions, TaskData, TaskFilter } from '../types';
import type { MemoryCache } from './state';

export class TaskService {
    constructor(
        private readonly cache: MemoryCache,
        private readonly stores: MemoryStoreBundle
    ) {}

    async saveTask(task: Omit<TaskData, 'createdAt' | 'updatedAt'>): Promise<void> {
        const now = Date.now();
        const existing = this.cache.tasks.get(task.taskId);
        if (existing && existing.sessionId !== task.sessionId) {
            throw new Error(
                `Task ID collision detected: ${task.taskId} belongs to session ${existing.sessionId}, cannot write to ${task.sessionId}`
            );
        }

        const taskData: TaskData = {
            ...clone(task),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        this.cache.tasks.set(task.taskId, taskData);
        await this.persistTaskListFile(taskData.sessionId);
    }

    getTask(taskId: string): TaskData | null {
        const task = this.cache.tasks.get(taskId);
        return task ? clone(task) : null;
    }

    queryTasks(filter?: TaskFilter, options?: QueryOptions): TaskData[] {
        let tasks = Array.from(this.cache.tasks.values());

        if (filter) {
            if (filter.sessionId) {
                tasks = tasks.filter((item) => item.sessionId === filter.sessionId);
            }
            if (filter.taskId) {
                tasks = tasks.filter((item) => item.taskId === filter.taskId);
            }
            if (filter.parentTaskId !== undefined) {
                if (filter.parentTaskId === null) {
                    tasks = tasks.filter((item) => !item.parentTaskId);
                } else {
                    tasks = tasks.filter((item) => item.parentTaskId === filter.parentTaskId);
                }
            }
            if (filter.status) {
                tasks = tasks.filter((item) => item.status === filter.status);
            }
        }

        return paginate(sortByTimestamp(tasks, options), options).map((item) => clone(item));
    }

    async deleteTask(taskId: string): Promise<void> {
        const existing = this.cache.tasks.get(taskId);
        if (!existing) return;

        this.cache.tasks.delete(taskId);
        await this.persistTaskListFile(existing.sessionId);
    }

    private async persistTaskListFile(sessionId: string): Promise<void> {
        const tasks = Array.from(this.cache.tasks.values()).filter((item) => item.sessionId === sessionId);
        await this.stores.tasks.saveBySession(sessionId, tasks);
    }
}
