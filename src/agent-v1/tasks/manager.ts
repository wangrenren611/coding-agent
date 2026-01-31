/**
 * Task Manager - 任务管理器
 *
 * 管理任务的创建、更新、状态跟踪和统计
 */

import { EventEmitter } from 'events';
import type {
    Task,
    TaskPlan,
    TaskStats,
} from '../types';
import { TaskStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * 任务管理器配置
 */
export interface TaskManagerConfig {
    /** 是否启用任务跟踪 */
    enableTracking?: boolean;
}

/**
 * TaskManager - 任务状态和依赖管理
 */
export class TaskManager extends EventEmitter {
    private tasks: Map<string, Task> = new Map();
    private config: Required<TaskManagerConfig>;

    constructor(config: TaskManagerConfig = {}) {
        super();
        this.config = {
            enableTracking: config.enableTracking ?? true,
        };
    }

    // ========================================================================
    // 任务管理
    // ========================================================================

    /**
     * 添加任务
     */
    addTask(task: Omit<Task, 'id' | 'createdAt'>): Task {
        const newTask: Task = {
            id: uuidv4(),
            ...task,
            createdAt: new Date(),
        };

        this.tasks.set(newTask.id, newTask);

        this.emit('task:created', { task: newTask });

        return newTask;
    }

    /**
     * 获取任务
     */
    getTask(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /**
     * 获取所有任务
     */
    getAllTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    /**
     * 按状态获取任务
     */
    getTasksByStatus(status: TaskStatus): Task[] {
        return Array.from(this.tasks.values()).filter(t => t.status === status);
    }

    /**
     * 获取根任务（没有父任务的任务）
     */
    getRootTasks(): Task[] {
        return Array.from(this.tasks.values()).filter(t => !t.parentTaskId);
    }

    /**
     * 获取子任务
     */
    getSubtasks(parentTaskId: string): Task[] {
        return Array.from(this.tasks.values()).filter(
            t => t.parentTaskId === parentTaskId
        );
    }

    /**
     * 删除任务
     */
    deleteTask(id: string): boolean {
        // 递归删除子任务
        const task = this.tasks.get(id);
        if (task) {
            for (const subtaskId of task.subtaskIds) {
                this.deleteTask(subtaskId);
            }
        }

        return this.tasks.delete(id);
    }

    // ========================================================================
    // 状态更新
    // ========================================================================

    /**
     * 更新任务状态
     */
    updateTaskStatus(id: string, status: TaskStatus, result?: unknown, error?: Error): void {
        const task = this.tasks.get(id);
        if (!task) return;

        const oldStatus = task.status;
        task.status = status;

        // 更新时间戳
        if (status === 'in_progress' && !task.startedAt) {
            task.startedAt = new Date();
        } else if (
            status === 'completed' ||
            status === 'failed' ||
            status === 'cancelled'
        ) {
            task.completedAt = new Date();
        }

        // 更新结果
        if (result !== undefined) {
            task.result = result;
        }

        if (error) {
            task.error = error;
        }

        this.emit('task:updated', { task, oldStatus });
    }

    /**
     * 标记任务为进行中
     */
    startTask(id: string): void {
        this.updateTaskStatus(id, TaskStatus.IN_PROGRESS);
    }

    /**
     * 标记任务完成
     */
    completeTask(id: string, result?: unknown): void {
        this.updateTaskStatus(id, TaskStatus.COMPLETED, result);
    }

    /**
     * 标记任务失败
     */
    failTask(id: string, error: Error): void {
        this.updateTaskStatus(id, TaskStatus.FAILED, undefined, error);
    }

    /**
     * 取消任务
     */
    cancelTask(id: string): void {
        this.updateTaskStatus(id, TaskStatus.CANCELLED);
    }

    // ========================================================================
    // 依赖管理
    // ========================================================================

    /**
     * 检查任务依赖是否满足
     */
    areDependenciesMet(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task || task.dependencies.length === 0) return true;

        return task.dependencies.every(depId => {
            const depTask = this.tasks.get(depId);
            return depTask?.status === 'completed';
        });
    }

    /**
     * 获取阻塞的任务
     */
    getBlockingTasks(taskId: string): Task[] {
        const task = this.tasks.get(taskId);
        if (!task) return [];

        return task.dependencies
            .map(depId => this.tasks.get(depId))
            .filter((t): t is Task => t !== undefined && t.status !== 'completed');
    }

    /**
     * 获取被阻塞的任务
     */
    getBlockedTasks(taskId: string): Task[] {
        return Array.from(this.tasks.values()).filter(task =>
            task.dependencies.includes(taskId) && task.status === 'blocked'
        );
    }

    /**
     * 更新阻塞状态
     */
    updateBlockedStatus(): void {
        for (const task of this.tasks.values()) {
            if (task.status === TaskStatus.PENDING && !this.areDependenciesMet(task.id)) {
                task.status = TaskStatus.BLOCKED;
            } else if (task.status === TaskStatus.BLOCKED && this.areDependenciesMet(task.id)) {
                task.status = TaskStatus.PENDING;
            }
        }
    }

    // ========================================================================
    // 下一个任务
    // ========================================================================

    /**
     * 获取下一个可执行的任务
     */
    getNextTask(): Task | null {
        // 更新阻塞状态
        this.updateBlockedStatus();

        // 找到第一个待处理的任务
        for (const task of this.tasks.values()) {
            if (task.status === TaskStatus.PENDING && !task.parentTaskId) {
                return task;
            }
        }

        // 如果没有根任务，查找待处理的子任务
        for (const task of this.tasks.values()) {
            if (task.status === TaskStatus.PENDING) {
                return task;
            }
        }

        return null;
    }

    /**
     * 检查是否所有任务都完成
     */
    areAllTasksComplete(): boolean {
        for (const task of this.tasks.values()) {
            if (task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED) {
                return false;
            }
        }
        return true;
    }

    /**
     * 检查是否有任务失败
     */
    hasFailedTasks(): boolean {
        return Array.from(this.tasks.values()).some(t => t.status === TaskStatus.FAILED);
    }

    // ========================================================================
    // 统计
    // ========================================================================

    /**
     * 获取任务统计
     */
    getStats(): TaskStats {
        const tasks = Array.from(this.tasks.values());

        return {
            total: tasks.length,
            completed: tasks.filter(t => t.status === TaskStatus.COMPLETED).length,
            inProgress: tasks.filter(t => t.status === TaskStatus.IN_PROGRESS).length,
            pending: tasks.filter(t => t.status === TaskStatus.PENDING).length,
            failed: tasks.filter(t => t.status === TaskStatus.FAILED).length,
        };
    }

    /**
     * 获取进度百分比
     */
    getProgress(): number {
        const stats = this.getStats();
        if (stats.total === 0) return 0;

        const finished = stats.completed + stats.failed;
        return Math.round((finished / stats.total) * 100);
    }

    /**
     * 获取任务树
     */
    getTaskTree(rootId?: string): Array<Task & { subtasks: Task[] }> {
        const roots = rootId
            ? [this.tasks.get(rootId)].filter((t): t is Task => t !== undefined)
            : this.getRootTasks();

        return roots.map(task => this.buildTaskTree(task));
    }

    /**
     * 构建任务树
     */
    private buildTaskTree(task: Task): Task & { subtasks: Task[] } {
        return {
            ...task,
            subtasks: task.subtaskIds
                .map(id => this.tasks.get(id))
                .filter((t): t is Task => t !== undefined)
                .map(t => this.buildTaskTree(t)),
        };
    }

    // ========================================================================
    // 清理
    // ========================================================================

    /**
     * 清空所有任务
     */
    clear(): void {
        this.tasks.clear();
        this.emit('cleared');
    }

    /**
     * 移除已完成的任务
     */
    removeCompleted(): void {
        for (const [id, task] of this.tasks) {
            if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
                this.tasks.delete(id);
            }
        }
    }

    /**
     * 获取任务数量
     */
    getCount(): number {
        return this.tasks.size;
    }
}
