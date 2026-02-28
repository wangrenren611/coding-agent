import type { Message } from '../../session/types';
import type { MemoryStoreBundle } from '../ports/stores';
import type {
    CompactContextOptions,
    CompactionRecord,
    ContextExclusionReason,
    CurrentContext,
    HistoryFilter,
    HistoryMessage,
    HistoryQueryOptions,
    IMemoryManager,
    QueryOptions,
    SessionData,
    SessionFilter,
    SubTaskRunData,
    SubTaskRunFilter,
    TaskData,
    TaskFilter,
} from '../types';
import { loadAndRepairCache, prepareStores } from './bootstrap';
import { SessionContextService } from './session-context-service';
import { createMemoryCache } from './state';
import { SubTaskRunService } from './subtask-run-service';
import { TaskService } from './task-service';

export class MemoryOrchestrator implements IMemoryManager {
    private initialized = false;
    private initializePromise: Promise<void> | null = null;
    private readonly cache = createMemoryCache();
    private readonly sessionContext: SessionContextService;
    private readonly taskService: TaskService;
    private readonly subTaskRunService: SubTaskRunService;

    constructor(private readonly stores: MemoryStoreBundle) {
        this.sessionContext = new SessionContextService(this.cache, stores);
        this.taskService = new TaskService(this.cache, stores);
        this.subTaskRunService = new SubTaskRunService(this.cache, stores);
    }

    async initialize(): Promise<void> {
        // 已初始化则直接返回
        if (this.initialized) return;
        // 如果有正在进行的初始化，等待它完成
        if (this.initializePromise) {
            return this.initializePromise;
        }
        // 创建初始化 Promise 并立即赋值，防止并发初始化
        this.initializePromise = this.doInitialize();
        try {
            await this.initializePromise;
        } finally {
            this.initializePromise = null;
        }
    }

    private async doInitialize(): Promise<void> {
        await prepareStores(this.stores);
        await loadAndRepairCache(this.cache, this.stores);
        this.initialized = true;
    }

    async close(): Promise<void> {
        // 等待正在进行的初始化完成
        if (this.initializePromise) {
            await this.initializePromise.catch(() => undefined);
        }
        await this.stores.close();
        this.initialized = false;
    }

    async createSession(sessionId: string | undefined, systemPrompt: string): Promise<string> {
        this.ensureInitialized();
        return this.sessionContext.createSession(sessionId, systemPrompt);
    }

    async getSession(sessionId: string): Promise<SessionData | null> {
        this.ensureInitialized();
        return this.sessionContext.getSession(sessionId);
    }

    async querySessions(filter?: SessionFilter, options?: QueryOptions): Promise<SessionData[]> {
        this.ensureInitialized();
        return this.sessionContext.querySessions(filter, options);
    }

    async getCurrentContext(sessionId: string): Promise<CurrentContext | null> {
        this.ensureInitialized();
        return this.sessionContext.getCurrentContext(sessionId);
    }

    async saveCurrentContext(context: Omit<CurrentContext, 'createdAt' | 'updatedAt'>): Promise<void> {
        this.ensureInitialized();
        await this.sessionContext.saveCurrentContext(context);
    }

    async addMessageToContext(
        sessionId: string,
        message: Message,
        options?: { addToHistory?: boolean }
    ): Promise<void> {
        this.ensureInitialized();
        await this.sessionContext.addMessageToContext(sessionId, message, options);
    }

    async updateMessageInContext(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void> {
        this.ensureInitialized();
        await this.sessionContext.updateMessageInContext(sessionId, messageId, updates);
    }

    async removeMessageFromContext(
        sessionId: string,
        messageId: string,
        reason?: ContextExclusionReason
    ): Promise<boolean> {
        this.ensureInitialized();
        return this.sessionContext.removeMessageFromContext(sessionId, messageId, reason);
    }

    async clearContext(sessionId: string): Promise<void> {
        this.ensureInitialized();
        await this.sessionContext.clearContext(sessionId);
    }

    async compactContext(sessionId: string, options: CompactContextOptions): Promise<CompactionRecord> {
        this.ensureInitialized();
        return this.sessionContext.compactContext(sessionId, options);
    }

    async getFullHistory(filter: HistoryFilter, options?: HistoryQueryOptions): Promise<HistoryMessage[]> {
        this.ensureInitialized();
        return this.sessionContext.getFullHistory(filter, options);
    }

    async getCompactionRecords(sessionId: string): Promise<CompactionRecord[]> {
        this.ensureInitialized();
        return this.sessionContext.getCompactionRecords(sessionId);
    }

    async saveTask(task: Omit<TaskData, 'createdAt' | 'updatedAt'>): Promise<void> {
        this.ensureInitialized();
        await this.taskService.saveTask(task);
    }

    async getTask(taskId: string): Promise<TaskData | null> {
        this.ensureInitialized();
        return this.taskService.getTask(taskId);
    }

    async queryTasks(filter?: TaskFilter, options?: QueryOptions): Promise<TaskData[]> {
        this.ensureInitialized();
        return this.taskService.queryTasks(filter, options);
    }

    async deleteTask(taskId: string): Promise<void> {
        this.ensureInitialized();
        await this.taskService.deleteTask(taskId);
    }

    async saveSubTaskRun(run: Omit<SubTaskRunData, 'createdAt' | 'updatedAt'>): Promise<void> {
        this.ensureInitialized();
        await this.subTaskRunService.saveSubTaskRun(run);
    }

    async getSubTaskRun(runId: string): Promise<SubTaskRunData | null> {
        this.ensureInitialized();
        return this.subTaskRunService.getSubTaskRun(runId);
    }

    async querySubTaskRuns(filter?: SubTaskRunFilter, options?: QueryOptions): Promise<SubTaskRunData[]> {
        this.ensureInitialized();
        return this.subTaskRunService.querySubTaskRuns(filter, options);
    }

    async deleteSubTaskRun(runId: string): Promise<void> {
        this.ensureInitialized();
        await this.subTaskRunService.deleteSubTaskRun(runId);
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                'MemoryOrchestrator not initialized. Call initialize() first. ' +
                    'If this error occurs during sub-agent execution, ensure the main agent has completed initialization.'
            );
        }
    }

    /**
     * 等待初始化完成（如果正在进行或尚未开始）
     * 如果尚未初始化，会自动启动初始化
     */
    async waitForInitialization(): Promise<void> {
        if (this.initialized) return;
        if (this.initializePromise) {
            await this.initializePromise;
            return;
        }
        // 未初始化且没有正在进行的初始化，自动启动初始化
        await this.initialize();
    }
}
