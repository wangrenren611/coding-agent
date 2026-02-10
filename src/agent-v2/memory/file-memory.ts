/**
 * 基于文件的 MemoryManager 实现
 *
 * 设计目标：
 * 1. 所有写操作立即落盘，避免隐式后台状态
 * 2. 上下文与历史保持一致（尤其是流式 message upsert 与压缩）
 * 3. 去除兼容迁移和元数据噪音，降低维护复杂度
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import type { Message } from '../session/types';
import {
  CompactContextOptions,
  CompactionRecord,
  CurrentContext,
  HistoryFilter,
  HistoryMessage,
  HistoryQueryOptions,
  IMemoryManager,
  MemoryManagerOptions,
  QueryOptions,
  SessionData,
  SessionFilter,
  SubTaskRunData,
  SubTaskRunFilter,
  TaskData,
  TaskFilter,
} from './types';

interface FileStorageConfig {
  basePath: string;
}

interface MemoryCache {
  sessions: Map<string, SessionData>;
  contexts: Map<string, CurrentContext>;
  histories: Map<string, HistoryMessage[]>;
  compactionRecords: Map<string, CompactionRecord[]>;
  tasks: Map<string, TaskData>;
  subTaskRuns: Map<string, SubTaskRunData>;
}

interface Timestamped {
  createdAt: number;
  updatedAt: number;
}

export class FileMemoryManager implements IMemoryManager {
  private readonly basePath: string;
  private readonly sessionsPath: string;
  private readonly contextsPath: string;
  private readonly historiesPath: string;
  private readonly compactionsPath: string;
  private readonly tasksPath: string;
  private readonly subTaskRunsPath: string;

  private initialized = false;

  private readonly cache: MemoryCache = {
    sessions: new Map(),
    contexts: new Map(),
    histories: new Map(),
    compactionRecords: new Map(),
    tasks: new Map(),
    subTaskRuns: new Map(),
  };

  constructor(options: MemoryManagerOptions) {
    const config = this.resolveConfig(options);
    this.basePath = config.basePath;

    this.sessionsPath = path.join(this.basePath, 'sessions');
    this.contextsPath = path.join(this.basePath, 'contexts');
    this.historiesPath = path.join(this.basePath, 'histories');
    this.compactionsPath = path.join(this.basePath, 'compactions');
    this.tasksPath = path.join(this.basePath, 'tasks');
    this.subTaskRunsPath = path.join(this.basePath, 'subtask-runs');
  }

  // ==================== 生命周期 ====================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Promise.all([
      fs.mkdir(this.sessionsPath, { recursive: true }),
      fs.mkdir(this.contextsPath, { recursive: true }),
      fs.mkdir(this.historiesPath, { recursive: true }),
      fs.mkdir(this.compactionsPath, { recursive: true }),
      fs.mkdir(this.tasksPath, { recursive: true }),
      fs.mkdir(this.subTaskRunsPath, { recursive: true }),
    ]);

    await this.loadAllData();
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  // ==================== 会话管理 ====================

  async createSession(sessionId: string | undefined, systemPrompt: string): Promise<string> {
    this.ensureInitialized();

    const sid = sessionId || uuid();
    if (this.cache.sessions.has(sid)) {
      throw new Error(`Session already exists: ${sid}`);
    }

    const now = Date.now();
    const contextId = uuid();

    const session: SessionData = {
      id: sid,
      sessionId: sid,
      systemPrompt,
      currentContextId: contextId,
      totalMessages: 1,
      compactionCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const systemMessage: Message = {
      messageId: 'system',
      role: 'system',
      content: systemPrompt,
    };

    const context: CurrentContext = {
      id: contextId,
      contextId,
      sessionId: sid,
      systemPrompt,
      messages: [systemMessage],
      version: 1,
      createdAt: now,
      updatedAt: now,
      stats: {
        totalMessagesInHistory: 1,
        compactionCount: 0,
      },
    };

    const history: HistoryMessage[] = [{
      ...systemMessage,
      sequence: 1,
      turn: 0,
    }];

    this.cache.sessions.set(sid, session);
    this.cache.contexts.set(sid, context);
    this.cache.histories.set(sid, history);
    this.cache.compactionRecords.set(sid, []);

    await Promise.all([
      this.saveSessionFile(sid),
      this.saveContextFile(sid),
      this.saveHistoryFile(sid),
      this.saveCompactionFile(sid),
    ]);

    return sid;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    this.ensureInitialized();
    const session = this.cache.sessions.get(sessionId);
    return session ? this.clone(session) : null;
  }

  async querySessions(filter?: SessionFilter, options?: QueryOptions): Promise<SessionData[]> {
    this.ensureInitialized();

    let sessions = Array.from(this.cache.sessions.values());

    if (filter) {
      if (filter.sessionId) {
        sessions = sessions.filter((item) => item.sessionId === filter.sessionId);
      }
      if (filter.status) {
        sessions = sessions.filter((item) => item.status === filter.status);
      }
      const startTime = filter.startTime;
      if (startTime !== undefined) {
        sessions = sessions.filter((item) => item.createdAt >= startTime);
      }
      const endTime = filter.endTime;
      if (endTime !== undefined) {
        sessions = sessions.filter((item) => item.createdAt <= endTime);
      }
    }

    const sorted = this.sortByTimestamp(sessions, options);
    return this.paginate(sorted, options).map((item) => this.clone(item));
  }

  // ==================== 当前上下文管理 ====================

  async getCurrentContext(sessionId: string): Promise<CurrentContext | null> {
    this.ensureInitialized();
    const context = this.cache.contexts.get(sessionId);
    return context ? this.clone(context) : null;
  }

  async saveCurrentContext(context: Omit<CurrentContext, 'createdAt' | 'updatedAt'>): Promise<void> {
    this.ensureInitialized();

    const session = this.requireSession(context.sessionId);
    const now = Date.now();
    const existing = this.cache.contexts.get(context.sessionId);

    const nextContext: CurrentContext = {
      ...this.clone(context),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.cache.contexts.set(context.sessionId, nextContext);

    session.updatedAt = now;

    await Promise.all([
      this.saveContextFile(context.sessionId),
      this.saveSessionFile(context.sessionId),
    ]);
  }

  async addMessageToContext(
    sessionId: string,
    message: Message,
    options: { addToHistory?: boolean } = {}
  ): Promise<void> {
    this.ensureInitialized();

    const session = this.requireSession(sessionId);
    const context = this.requireContext(sessionId);

    const isNewContextMessage = this.upsertContextMessage(context, message);
    const shouldAddToHistory = options.addToHistory !== false;

    let historyChanged = false;
    let historyLength = this.cache.histories.get(sessionId)?.length ?? 0;

    if (shouldAddToHistory) {
      const history = this.ensureHistoryList(sessionId);
      this.upsertHistoryMessage(history, message);
      historyLength = history.length;
      historyChanged = true;
      session.totalMessages = historyLength;
    }

    const now = Date.now();
    context.updatedAt = now;
    if (isNewContextMessage) {
      context.version += 1;
    }

    if (context.stats) {
      context.stats.totalMessagesInHistory = historyLength;
    }

    session.updatedAt = now;

    const writes: Promise<void>[] = [
      this.saveContextFile(sessionId),
      this.saveSessionFile(sessionId),
    ];
    if (historyChanged) {
      writes.push(this.saveHistoryFile(sessionId));
    }

    await Promise.all(writes);
  }

  async updateMessageInContext(
    sessionId: string,
    messageId: string,
    updates: Partial<Message>
  ): Promise<void> {
    this.ensureInitialized();

    const session = this.requireSession(sessionId);
    const context = this.requireContext(sessionId);

    const contextIndex = this.findLastContextIndex(context.messages, messageId);
    if (contextIndex === -1) {
      throw new Error(`Message not found in context: ${messageId}`);
    }

    context.messages[contextIndex] = {
      ...context.messages[contextIndex],
      ...this.clone(updates),
    };

    const history = this.cache.histories.get(sessionId);
    let historyChanged = false;
    if (history) {
      const historyIndex = this.findLastHistoryIndex(history, messageId);
      if (historyIndex !== -1) {
        history[historyIndex] = {
          ...history[historyIndex],
          ...this.clone(updates),
          sequence: history[historyIndex].sequence,
        };
        historyChanged = true;
      }
    }

    const now = Date.now();
    context.updatedAt = now;
    session.updatedAt = now;

    const writes: Promise<void>[] = [
      this.saveContextFile(sessionId),
      this.saveSessionFile(sessionId),
    ];
    if (historyChanged) {
      writes.push(this.saveHistoryFile(sessionId));
    }

    await Promise.all(writes);
  }

  async clearContext(sessionId: string): Promise<void> {
    this.ensureInitialized();

    const session = this.requireSession(sessionId);
    const context = this.requireContext(sessionId);

    const systemMessage = context.messages.find((item) => item.role === 'system');
    context.messages = systemMessage ? [systemMessage] : [];
    context.version += 1;

    const now = Date.now();
    context.updatedAt = now;
    session.updatedAt = now;

    await Promise.all([
      this.saveContextFile(sessionId),
      this.saveSessionFile(sessionId),
    ]);
  }

  async compactContext(sessionId: string, options: CompactContextOptions): Promise<CompactionRecord> {
    this.ensureInitialized();

    const session = this.requireSession(sessionId);
    const context = this.requireContext(sessionId);
    const history = this.ensureHistoryList(sessionId);

    const keepLastN = Math.max(0, options.keepLastN);
    const now = Date.now();

    const systemMessage = context.messages.find((item) => item.role === 'system');
    const nonSystemMessages = context.messages.filter((item) => item.role !== 'system');

    const archiveCount = Math.max(0, nonSystemMessages.length - keepLastN);
    const messagesToArchive = nonSystemMessages.slice(0, archiveCount);
    const keptMessages = nonSystemMessages.slice(archiveCount);

    const archivedMessageIds = messagesToArchive.map((item) => item.messageId);
    const archivedIdSet = new Set(archivedMessageIds);

    const summaryMessage: Message = {
      ...this.clone(options.summaryMessage),
      type: options.summaryMessage.type ?? 'summary',
    };

    const recordId = uuid();
    for (const message of history) {
      if (archivedIdSet.has(message.messageId)) {
        message.archivedBy = recordId;
      }
    }

    this.upsertHistoryMessage(history, summaryMessage, {
      isSummary: true,
      archivedBy: undefined,
    });

    const previousMessageCount = context.messages.length;
    context.messages = systemMessage
      ? [systemMessage, summaryMessage, ...keptMessages]
      : [summaryMessage, ...keptMessages];
    context.version += 1;
    context.lastCompactionId = recordId;
    context.updatedAt = now;

    session.compactionCount += 1;
    session.totalMessages = history.length;
    session.updatedAt = now;

    context.stats = {
      totalMessagesInHistory: history.length,
      compactionCount: session.compactionCount,
      lastCompactionAt: now,
    };

    const record: CompactionRecord = {
      id: recordId,
      recordId,
      sessionId,
      compactedAt: now,
      messageCountBefore: previousMessageCount,
      messageCountAfter: context.messages.length,
      archivedMessageIds,
      summaryMessageId: summaryMessage.messageId,
      reason: options.reason ?? 'manual',
      metadata: {
        tokenCountBefore: options.tokenCountBefore,
        tokenCountAfter: options.tokenCountAfter,
        triggerMessageId: options.triggerMessageId,
      },
      createdAt: now,
      updatedAt: now,
    };

    const records = this.cache.compactionRecords.get(sessionId) || [];
    records.push(record);
    this.cache.compactionRecords.set(sessionId, records);

    await Promise.all([
      this.saveContextFile(sessionId),
      this.saveHistoryFile(sessionId),
      this.saveSessionFile(sessionId),
      this.saveCompactionFile(sessionId),
    ]);

    return this.clone(record);
  }

  // ==================== 完整历史管理 ====================

  async getFullHistory(filter: HistoryFilter, options?: HistoryQueryOptions): Promise<HistoryMessage[]> {
    this.ensureInitialized();

    let result = [...(this.cache.histories.get(filter.sessionId) || [])];

    if (filter.messageIds && filter.messageIds.length > 0) {
      const messageIdSet = new Set(filter.messageIds);
      result = result.filter((item) => messageIdSet.has(item.messageId));
    }
    const sequenceStart = filter.sequenceStart;
    if (sequenceStart !== undefined) {
      result = result.filter((item) => item.sequence >= sequenceStart);
    }
    const sequenceEnd = filter.sequenceEnd;
    if (sequenceEnd !== undefined) {
      result = result.filter((item) => item.sequence <= sequenceEnd);
    }
    if (filter.includeSummary === false) {
      result = result.filter((item) => !item.isSummary);
    }
    if (filter.archivedBy) {
      result = result.filter((item) => item.archivedBy === filter.archivedBy);
    }

    const direction = options?.orderDirection ?? 'asc';
    result.sort((a, b) => {
      const comparison = a.sequence - b.sequence;
      return direction === 'asc' ? comparison : -comparison;
    });

    return this.paginate(result, options).map((item) => this.clone(item));
  }

  async getCompactionRecords(sessionId: string): Promise<CompactionRecord[]> {
    this.ensureInitialized();
    const records = this.cache.compactionRecords.get(sessionId) || [];
    return records.map((item) => this.clone(item));
  }

  // ==================== 任务管理 ====================

  async saveTask(task: Omit<TaskData, 'createdAt' | 'updatedAt'>): Promise<void> {
    this.ensureInitialized();

    const now = Date.now();
    const existing = this.cache.tasks.get(task.taskId);

    const taskData: TaskData = {
      ...this.clone(task),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.cache.tasks.set(task.taskId, taskData);
    await this.persistTaskListFile(taskData.sessionId);
  }

  async getTask(taskId: string): Promise<TaskData | null> {
    this.ensureInitialized();
    const task = this.cache.tasks.get(taskId);
    return task ? this.clone(task) : null;
  }

  async queryTasks(filter?: TaskFilter, options?: QueryOptions): Promise<TaskData[]> {
    this.ensureInitialized();

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

    const sorted = this.sortByTimestamp(tasks, options);
    return this.paginate(sorted, options).map((item) => this.clone(item));
  }

  async deleteTask(taskId: string): Promise<void> {
    this.ensureInitialized();

    const existing = this.cache.tasks.get(taskId);
    if (!existing) return;

    this.cache.tasks.delete(taskId);
    await this.persistTaskListFile(existing.sessionId);
  }

  // ==================== 子任务运行管理 ====================

  async saveSubTaskRun(run: Omit<SubTaskRunData, 'createdAt' | 'updatedAt'>): Promise<void> {
    this.ensureInitialized();

    const now = Date.now();
    const existing = this.cache.subTaskRuns.get(run.runId);
    const normalized = this.normalizeSubTaskRun(run as SubTaskRunData);

    const runData: SubTaskRunData = {
      ...normalized,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.cache.subTaskRuns.set(run.runId, runData);
    await this.saveSubTaskRunFile(run.runId);
  }

  async getSubTaskRun(runId: string): Promise<SubTaskRunData | null> {
    this.ensureInitialized();
    const run = this.cache.subTaskRuns.get(runId);
    return run ? this.clone(run) : null;
  }

  async querySubTaskRuns(filter?: SubTaskRunFilter, options?: QueryOptions): Promise<SubTaskRunData[]> {
    this.ensureInitialized();

    let runs = Array.from(this.cache.subTaskRuns.values());

    if (filter) {
      if (filter.runId) {
        runs = runs.filter((item) => item.runId === filter.runId);
      }
      if (filter.parentSessionId) {
        runs = runs.filter((item) => item.parentSessionId === filter.parentSessionId);
      }
      if (filter.childSessionId) {
        runs = runs.filter((item) => item.childSessionId === filter.childSessionId);
      }
      if (filter.status) {
        runs = runs.filter((item) => item.status === filter.status);
      }
      if (filter.mode) {
        runs = runs.filter((item) => item.mode === filter.mode);
      }
    }

    const sorted = this.sortByTimestamp(runs, options);
    return this.paginate(sorted, options).map((item) => this.clone(item));
  }

  async deleteSubTaskRun(runId: string): Promise<void> {
    this.ensureInitialized();

    this.cache.subTaskRuns.delete(runId);
    await this.deleteSubTaskRunFile(runId);
  }

  // ==================== 私有方法 - 加载 ====================

  private async loadAllData(): Promise<void> {
    this.cache.sessions.clear();
    this.cache.contexts.clear();
    this.cache.histories.clear();
    this.cache.compactionRecords.clear();
    this.cache.tasks.clear();
    this.cache.subTaskRuns.clear();

    await this.loadSessions();
    await this.loadContexts();
    await this.loadHistories();
    await this.loadCompactions();
    await this.loadTaskLists();
    await this.loadSubTaskRuns();
  }

  private async loadSessions(): Promise<void> {
    const files = await this.listJsonFiles(this.sessionsPath);
    for (const fileName of files) {
      const sessionId = this.decodeEntityFileName(fileName);
      const filePath = this.getSessionFilePath(sessionId);
      try {
        const session = await this.readJsonFile<SessionData>(filePath);
        if (!session) continue;
        this.cache.sessions.set(sessionId, {
          ...session,
          sessionId,
        });
      } catch (error) {
        console.error(`Error loading session ${sessionId}:`, error);
      }
    }
  }

  private async loadContexts(): Promise<void> {
    const files = await this.listJsonFiles(this.contextsPath);
    for (const fileName of files) {
      const sessionId = this.decodeEntityFileName(fileName);
      const filePath = this.getContextFilePath(sessionId);
      try {
        const context = await this.readJsonFile<CurrentContext>(filePath);
        if (!context) continue;
        this.cache.contexts.set(sessionId, {
          ...context,
          sessionId,
        });
      } catch (error) {
        console.error(`Error loading context ${sessionId}:`, error);
      }
    }
  }

  private async loadHistories(): Promise<void> {
    const files = await this.listJsonFiles(this.historiesPath);
    for (const fileName of files) {
      const sessionId = this.decodeEntityFileName(fileName);
      const filePath = this.getHistoryFilePath(sessionId);
      try {
        const history = await this.readJsonFile<HistoryMessage[]>(filePath);
        if (!history) continue;
        this.cache.histories.set(sessionId, history);
      } catch (error) {
        console.error(`Error loading history ${sessionId}:`, error);
      }
    }
  }

  private async loadCompactions(): Promise<void> {
    const files = await this.listJsonFiles(this.compactionsPath);
    for (const fileName of files) {
      const sessionId = this.decodeEntityFileName(fileName);
      const filePath = this.getCompactionFilePath(sessionId);
      try {
        const records = await this.readJsonFile<CompactionRecord[]>(filePath);
        if (!records) continue;
        this.cache.compactionRecords.set(sessionId, records);
      } catch (error) {
        console.error(`Error loading compactions ${sessionId}:`, error);
      }
    }
  }

  private async loadTaskLists(): Promise<void> {
    const files = await this.listJsonFiles(this.tasksPath);
    for (const fileName of files) {
      if (!fileName.startsWith('task-list-')) continue;

      const sessionId = this.decodeTaskListFileName(fileName);
      const filePath = this.getTaskListFilePath(sessionId);

      try {
        const tasks = await this.readJsonFile<TaskData[]>(filePath);
        if (!tasks) continue;

        for (const task of tasks) {
          this.cache.tasks.set(task.taskId, {
            ...task,
            sessionId,
          });
        }
      } catch (error) {
        console.error(`Error loading task list ${sessionId}:`, error);
      }
    }
  }

  private async loadSubTaskRuns(): Promise<void> {
    const files = await this.listJsonFiles(this.subTaskRunsPath);
    for (const fileName of files) {
      if (!fileName.startsWith('subtask-run-')) continue;

      const runId = this.decodeSubTaskRunFileName(fileName);
      const filePath = this.getSubTaskRunFilePath(runId);

      try {
        const rawRun = await this.readJsonFile<SubTaskRunData>(filePath);
        if (!rawRun) continue;

        this.cache.subTaskRuns.set(runId, this.normalizeSubTaskRun(rawRun));
      } catch (error) {
        console.error(`Error loading sub task run ${runId}:`, error);
      }
    }
  }

  // ==================== 私有方法 - 持久化 ====================

  private async saveSessionFile(sessionId: string): Promise<void> {
    const session = this.cache.sessions.get(sessionId);
    if (!session) return;
    await this.writeJsonFile(this.getSessionFilePath(sessionId), session);
  }

  private async saveContextFile(sessionId: string): Promise<void> {
    const context = this.cache.contexts.get(sessionId);
    if (!context) return;
    await this.writeJsonFile(this.getContextFilePath(sessionId), context);
  }

  private async saveHistoryFile(sessionId: string): Promise<void> {
    const history = this.cache.histories.get(sessionId);
    if (!history) return;
    await this.writeJsonFile(this.getHistoryFilePath(sessionId), history);
  }

  private async saveCompactionFile(sessionId: string): Promise<void> {
    const records = this.cache.compactionRecords.get(sessionId);
    if (!records) return;
    await this.writeJsonFile(this.getCompactionFilePath(sessionId), records);
  }

  private async persistTaskListFile(sessionId: string): Promise<void> {
    const tasks = Array.from(this.cache.tasks.values())
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt);

    const filePath = this.getTaskListFilePath(sessionId);
    if (tasks.length === 0) {
      await this.deleteFileIfExists(filePath);
      return;
    }

    await this.writeJsonFile(filePath, tasks);
  }

  private async saveSubTaskRunFile(runId: string): Promise<void> {
    const run = this.cache.subTaskRuns.get(runId);
    if (!run) return;

    await this.writeJsonFile(this.getSubTaskRunFilePath(runId), run);
  }

  private async deleteSubTaskRunFile(runId: string): Promise<void> {
    await this.deleteFileIfExists(this.getSubTaskRunFilePath(runId));
  }

  // ==================== 私有方法 - 模型操作 ====================

  private requireSession(sessionId: string): SessionData {
    const session = this.cache.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private requireContext(sessionId: string): CurrentContext {
    const context = this.cache.contexts.get(sessionId);
    if (!context) {
      throw new Error(`Context not found for session: ${sessionId}`);
    }
    return context;
  }

  private ensureHistoryList(sessionId: string): HistoryMessage[] {
    const existing = this.cache.histories.get(sessionId);
    if (existing) return existing;

    const created: HistoryMessage[] = [];
    this.cache.histories.set(sessionId, created);
    return created;
  }

  private upsertContextMessage(context: CurrentContext, message: Message): boolean {
    const last = context.messages[context.messages.length - 1];
    if (last?.messageId === message.messageId) {
      context.messages[context.messages.length - 1] = this.clone(message);
      return false;
    }

    context.messages.push(this.clone(message));
    return true;
  }

  private upsertHistoryMessage(
    history: HistoryMessage[],
    message: Message,
    extras: Partial<HistoryMessage> = {}
  ): void {
    const existingIndex = this.findLastHistoryIndex(history, message.messageId);

    if (existingIndex === -1) {
      history.push({
        ...this.clone(message),
        sequence: history.length + 1,
        ...extras,
      });
      return;
    }

    history[existingIndex] = {
      ...history[existingIndex],
      ...this.clone(message),
      ...extras,
      sequence: history[existingIndex].sequence,
    };
  }

  private findLastHistoryIndex(history: HistoryMessage[], messageId: string): number {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].messageId === messageId) {
        return index;
      }
    }
    return -1;
  }

  private findLastContextIndex(messages: Message[], messageId: string): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].messageId === messageId) {
        return index;
      }
    }
    return -1;
  }

  private normalizeSubTaskRun(raw: SubTaskRunData): SubTaskRunData {
    const messageCount = raw.messageCount ?? (Array.isArray(raw.messages) ? raw.messages.length : 0);
    const { messages: _ignoredMessages, ...rest } = raw;

    return {
      ...rest,
      messageCount,
    };
  }

  // ==================== 私有方法 - 通用工具 ====================

  private resolveConfig(options: MemoryManagerOptions): FileStorageConfig {
    const config = options.config as { basePath?: unknown } | undefined;
    const configBasePath = typeof config?.basePath === 'string' ? config.basePath : undefined;

    return {
      basePath: configBasePath || options.connectionString || '.memory',
    };
  }

  private sortByTimestamp<T extends Timestamped>(items: T[], options?: QueryOptions): T[] {
    const orderBy = options?.orderBy ?? 'updatedAt';
    const direction = options?.orderDirection ?? 'desc';

    return [...items].sort((a, b) => {
      const comparison = a[orderBy] - b[orderBy];
      return direction === 'asc' ? comparison : -comparison;
    });
  }

  private paginate<T>(items: T[], options?: { limit?: number; offset?: number }): T[] {
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = Math.max(0, options?.limit ?? items.length);
    return items.slice(offset, offset + limit);
  }

  private async listJsonFiles(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name);
  }

  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
  }

  private async deleteFileIfExists(filePath: string): Promise<void> {
    await fs.unlink(filePath).catch(() => {});
  }

  private encodeEntityFileName(id: string): string {
    return `${encodeURIComponent(id)}.json`;
  }

  private decodeEntityFileName(fileName: string): string {
    return decodeURIComponent(fileName.replace(/\.json$/, ''));
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionsPath, this.encodeEntityFileName(sessionId));
  }

  private getContextFilePath(sessionId: string): string {
    return path.join(this.contextsPath, this.encodeEntityFileName(sessionId));
  }

  private getHistoryFilePath(sessionId: string): string {
    return path.join(this.historiesPath, this.encodeEntityFileName(sessionId));
  }

  private getCompactionFilePath(sessionId: string): string {
    return path.join(this.compactionsPath, this.encodeEntityFileName(sessionId));
  }

  private getTaskListFilePath(sessionId: string): string {
    return path.join(this.tasksPath, this.encodeTaskListFileName(sessionId));
  }

  private encodeTaskListFileName(sessionId: string): string {
    return `task-list-${encodeURIComponent(sessionId)}.json`;
  }

  private decodeTaskListFileName(fileName: string): string {
    return decodeURIComponent(fileName.replace(/^task-list-/, '').replace(/\.json$/, ''));
  }

  private getSubTaskRunFilePath(runId: string): string {
    return path.join(this.subTaskRunsPath, this.encodeSubTaskRunFileName(runId));
  }

  private encodeSubTaskRunFileName(runId: string): string {
    return `subtask-run-${encodeURIComponent(runId)}.json`;
  }

  private decodeSubTaskRunFileName(fileName: string): string {
    return decodeURIComponent(fileName.replace(/^subtask-run-/, '').replace(/\.json$/, ''));
  }

  private isNotFound(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('FileMemoryManager not initialized. Call initialize() first.');
    }
  }
}
