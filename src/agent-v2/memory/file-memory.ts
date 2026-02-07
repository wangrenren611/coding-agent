/**
 * 基于文件的 MemoryManager 实现
 * 支持当前上下文和历史消息的分离存储
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  IMemoryManager,
  SessionData,
  CurrentContext,
  HistoryMessage,
  TaskData,
  SubTaskRunData,
  CompactionRecord,
  QueryOptions,
  HistoryQueryOptions,
  SessionFilter,
  TaskFilter,
  SubTaskRunFilter,
  HistoryFilter,
  CompactContextOptions,
  MemoryManagerOptions,
} from './types';
import { v4 as uuid } from 'uuid';
import { Message } from '../session/types';

/**
 * 文件存储配置
 */
interface FileStorageConfig {
  /** 存储目录路径 */
  basePath: string;
  /** 是否自动保存 */
  autoSave: boolean;
  /** 保存间隔（毫秒） */
  saveInterval?: number;
}

/**
 * 内存缓存结构
 */
interface MemoryCache {
  sessions: Map<string, SessionData>;
  contexts: Map<string, CurrentContext>;
  histories: Map<string, HistoryMessage[]>; // sessionId -> messages
  compactionRecords: Map<string, CompactionRecord[]>; // sessionId -> records
  tasks: Map<string, TaskData>;
  subTaskRuns: Map<string, SubTaskRunData>;
}

/**
 * 文件存储 MemoryManager 实现
 */
export class FileMemoryManager implements IMemoryManager {
  private config: FileStorageConfig;
  private basePath: string;
  private sessionsPath: string;
  private contextsPath: string;
  private historiesPath: string;
  private compactionsPath: string;
  private tasksPath: string;
  private saveTimer?: NodeJS.Timeout;
  private initialized = false;

  // 内存缓存
  private cache: MemoryCache = {
    sessions: new Map(),
    contexts: new Map(),
    histories: new Map(),
    compactionRecords: new Map(),
    tasks: new Map(),
    subTaskRuns: new Map(),
  };

  constructor(options: MemoryManagerOptions) {
    const config = options.config as unknown as FileStorageConfig | undefined;
    this.basePath = config?.basePath || options.connectionString || '.memory';
    this.config = {
      basePath: this.basePath,
      autoSave: config?.autoSave ?? true,
      saveInterval: config?.saveInterval,
    };

    this.sessionsPath = path.join(this.basePath, 'sessions');
    this.contextsPath = path.join(this.basePath, 'contexts');
    this.historiesPath = path.join(this.basePath, 'histories');
    this.compactionsPath = path.join(this.basePath, 'compactions');
    this.tasksPath = path.join(this.basePath, 'tasks');
  }

  // ==================== 初始化与生命周期 ====================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // 创建存储目录
      await fs.mkdir(this.sessionsPath, { recursive: true });
      await fs.mkdir(this.contextsPath, { recursive: true });
      await fs.mkdir(this.historiesPath, { recursive: true });
      await fs.mkdir(this.compactionsPath, { recursive: true });
      await fs.mkdir(this.tasksPath, { recursive: true });

      // 加载已有数据
      await this.loadAllData();

      // 设置自动保存
      if (this.config.autoSave && this.config.saveInterval) {
        this.saveTimer = setInterval(() => {
          this.persistAll().catch(console.error);
        }, this.config.saveInterval);
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize FileMemoryManager: ${error}`);
    }
  }

  async close(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.persistAll();
    this.initialized = false;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await fs.access(this.basePath, fs.constants.W_OK);
      return this.initialized;
    } catch {
      return false;
    }
  }

  // ==================== 会话管理 ====================

  async createSession(sessionId: string | undefined, systemPrompt: string): Promise<string> {
    this.ensureInitialized();

    const sid = sessionId || uuid();
    const now = Date.now();
    const contextId = uuid();

    // 创建会话数据
    const session: SessionData = {
      id: sid,
      sessionId: sid,
      systemPrompt,
      currentContextId: contextId,
      totalMessages: 1, // 系统消息
      compactionCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    // 创建初始上下文
    const context: CurrentContext = {
      id: contextId,
      contextId,
      sessionId: sid,
      systemPrompt,
      messages: [{
        messageId: 'system',
        role: 'system',
        content: systemPrompt,
      }],
      version: 1,
      createdAt: now,
      updatedAt: now,
      stats: {
        totalMessagesInHistory: 1,
        compactionCount: 0,
      },
    };

    // 创建初始历史
    const historyMessage: HistoryMessage = {
      messageId: 'system',
      role: 'system',
      content: systemPrompt,
      sequence: 1,
      turn: 0,
    };

    // 更新缓存
    this.cache.sessions.set(sid, session);
    this.cache.contexts.set(sid, context);
    this.cache.histories.set(sid, [historyMessage]);
    this.cache.compactionRecords.set(sid, []);

    // 持久化
    await this.saveSessionFile(sid);
    await this.saveContextFile(sid);
    await this.saveHistoryFile(sid);

    return sid;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    this.ensureInitialized();
    return this.cache.sessions.get(sessionId) || null;
  }

  async querySessions(filter?: SessionFilter, options?: QueryOptions): Promise<SessionData[]> {
    this.ensureInitialized();

    let sessions = Array.from(this.cache.sessions.values());

    // 应用过滤
    if (filter) {
      if (filter.sessionId) {
        sessions = sessions.filter((s) => s.sessionId === filter.sessionId);
      }
      if (filter.status) {
        sessions = sessions.filter((s) => s.status === filter.status);
      }
      if (filter.startTime) {
        sessions = sessions.filter((s) => s.createdAt >= filter.startTime!);
      }
      if (filter.endTime) {
        sessions = sessions.filter((s) => s.createdAt <= filter.endTime!);
      }
    }

    // 应用排序
    const orderBy = options?.orderBy ?? 'updatedAt';
    const direction = options?.orderDirection ?? 'desc';
    sessions.sort((a, b) => {
      const comparison = a[orderBy as keyof SessionData] as number - (b[orderBy as keyof SessionData] as number);
      return direction === 'asc' ? comparison : -comparison;
    });

    // 应用分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sessions.length;
    return sessions.slice(offset, offset + limit);
  }

  async updateSession(
    sessionId: string,
    updates: Partial<Omit<SessionData, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    this.ensureInitialized();

    const session = this.cache.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    Object.assign(session, updates, { updatedAt: Date.now() });
    await this.saveSessionFile(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized();

    // 从缓存中删除
    this.cache.sessions.delete(sessionId);
    this.cache.contexts.delete(sessionId);
    this.cache.histories.delete(sessionId);
    this.cache.compactionRecords.delete(sessionId);

    // 删除关联的任务
    for (const [taskId, task] of this.cache.tasks.entries()) {
      if (task.sessionId === sessionId) {
        this.cache.tasks.delete(taskId);
        await this.deleteTaskFile(taskId);
      }
    }

    // 删除关联的子任务运行记录
    for (const [runId, run] of this.cache.subTaskRuns.entries()) {
      if (run.parentSessionId === sessionId || run.childSessionId === sessionId) {
        this.cache.subTaskRuns.delete(runId);
        await this.deleteSubTaskRunFile(runId);
      }
    }

    // 删除文件
    await this.deleteSessionFile(sessionId);
    await this.deleteContextFile(sessionId);
    await this.deleteHistoryFile(sessionId);
    await this.deleteCompactionFile(sessionId);

    await this.persistMetadata();
  }

  async archiveSession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    await this.updateSession(sessionId, { status: 'archived' });
  }

  // ==================== 当前上下文管理 ====================

  async getCurrentContext(sessionId: string): Promise<CurrentContext | null> {
    this.ensureInitialized();
    return this.cache.contexts.get(sessionId) || null;
  }

  async saveCurrentContext(context: Omit<CurrentContext, 'createdAt' | 'updatedAt'>): Promise<void> {
    this.ensureInitialized();

    const now = Date.now();
    const fullContext: CurrentContext = {
      ...context,
      createdAt: this.cache.contexts.get(context.sessionId)?.createdAt ?? now,
      updatedAt: now,
    };

    this.cache.contexts.set(context.sessionId, fullContext);
    await this.saveContextFile(context.sessionId);

    // 更新会话的 updatedAt
    const session = this.cache.sessions.get(context.sessionId);
    if (session) {
      session.updatedAt = now;
      await this.saveSessionFile(context.sessionId);
    }
  }

  async addMessageToContext(
    sessionId: string,
    message: Message,
    options: { addToHistory?: boolean } = {}
  ): Promise<void> {
    this.ensureInitialized();

    const context = this.cache.contexts.get(sessionId);
    if (!context) {
      throw new Error(`Context not found for session: ${sessionId}`);
    }

    const isNewContextMessage = this.upsertContextMessage(context, message);

    context.updatedAt = Date.now();

    // 同时添加到历史（默认启用）
    if (options.addToHistory !== false) {
      const history = this.ensureHistoryList(sessionId);
      this.upsertHistoryMessage(history, message);
      await this.saveHistoryFile(sessionId);

      // 更新会话统计
      const session = this.cache.sessions.get(sessionId);
      if (session) {
        session.totalMessages = history.length;
        session.updatedAt = context.updatedAt;
        await this.saveSessionFile(sessionId);
      }
    }

    if (isNewContextMessage) {
      context.version++;
    }

    await this.saveContextFile(sessionId);
  }

  async addMessagesToContext(
    sessionId: string,
    messages: Message[],
    options: { addToHistory?: boolean } = {}
  ): Promise<void> {
    this.ensureInitialized();

    const context = this.cache.contexts.get(sessionId);
    if (!context) {
      throw new Error(`Context not found for session: ${sessionId}`);
    }

    let newContextMessages = 0;
    for (const message of messages) {
      if (this.upsertContextMessage(context, message)) {
        newContextMessages++;
      }
    }
    context.version += newContextMessages;
    context.updatedAt = Date.now();

    // 同时添加到历史
    if (options.addToHistory !== false) {
      const history = this.ensureHistoryList(sessionId);
      for (const message of messages) {
        this.upsertHistoryMessage(history, message);
      }

      await this.saveHistoryFile(sessionId);

      // 更新会话统计
      const session = this.cache.sessions.get(sessionId);
      if (session) {
        session.totalMessages = history.length;
        session.updatedAt = context.updatedAt;
        await this.saveSessionFile(sessionId);
      }
    }

    await this.saveContextFile(sessionId);
  }

  async updateMessageInContext(
    sessionId: string,
    messageId: string,
    updates: Partial<Message>
  ): Promise<void> {
    this.ensureInitialized();

    const context = this.cache.contexts.get(sessionId);
    if (!context) {
      throw new Error(`Context not found for session: ${sessionId}`);
    }

    const index = this.findLastContextIndex(context.messages, messageId);
    if (index === -1) {
      throw new Error(`Message not found in context: ${messageId}`);
    }

    context.messages[index] = { ...context.messages[index], ...updates };
    context.updatedAt = Date.now();

    const history = this.cache.histories.get(sessionId);
    if (history) {
      const historyIndex = this.findLastHistoryIndex(history, messageId);
      if (historyIndex !== -1) {
        history[historyIndex] = {
          ...history[historyIndex],
          ...updates,
          sequence: history[historyIndex].sequence,
        };
      }
      await this.saveHistoryFile(sessionId);
    }

    const session = this.cache.sessions.get(sessionId);
    if (session) {
      session.updatedAt = context.updatedAt;
      await this.saveSessionFile(sessionId);
    }

    await this.saveContextFile(sessionId);
  }

  async clearContext(sessionId: string): Promise<void> {
    this.ensureInitialized();

    const context = this.cache.contexts.get(sessionId);
    if (!context) {
      throw new Error(`Context not found for session: ${sessionId}`);
    }

    // 保留系统消息
    const systemMessage = context.messages.find((m) => m.role === 'system');
    context.messages = systemMessage ? [systemMessage] : [];
    context.version++;
    context.updatedAt = Date.now();

    await this.saveContextFile(sessionId);
  }

  async compactContext(sessionId: string, options: CompactContextOptions): Promise<CompactionRecord> {
    this.ensureInitialized();

    const context = this.cache.contexts.get(sessionId);
    const session = this.cache.sessions.get(sessionId);
    const history = this.cache.histories.get(sessionId);

    if (!context || !session || !history) {
      throw new Error(`Session data not found: ${sessionId}`);
    }

    const { keepLastN, summaryMessage, reason = 'manual', triggerMessageId, tokenCountBefore, tokenCountAfter } = options;

    // 计算要归档的消息
    const messagesToArchive = context.messages.slice(0, -keepLastN);
    const archivedMessageIds = messagesToArchive.map((m) => m.messageId);

    // 创建压缩记录
    const recordId = uuid();
    const now = Date.now();
    const record: CompactionRecord = {
      id: recordId,
      recordId,
      sessionId,
      compactedAt: now,
      messageCountBefore: context.messages.length,
      messageCountAfter: keepLastN + 1, // 保留的消息 + 摘要
      archivedMessageIds,
      summaryMessageId: summaryMessage.messageId,
      reason,
      metadata: {
        tokenCountBefore,
        tokenCountAfter,
        triggerMessageId,
      },
      createdAt: now,
      updatedAt: now,
    };

    // 更新历史中的消息标记
    for (const msg of history) {
      if (archivedMessageIds.includes(msg.messageId)) {
        msg.archivedBy = recordId;
      }
    }

    // 将摘要消息添加到历史
    const summaryHistoryMessage: HistoryMessage = {
      ...summaryMessage,
      sequence: history.length + 1,
      isSummary: true,
    };
    history.push(summaryHistoryMessage);

    // 更新上下文：保留最近消息 + 摘要消息
    const keptMessages = context.messages.slice(-keepLastN);
    context.messages = [summaryMessage, ...keptMessages];
    context.version++;
    context.lastCompactionId = recordId;
    context.updatedAt = now;
    context.stats = {
      totalMessagesInHistory: history.length,
      compactionCount: (context.stats?.compactionCount || 0) + 1,
      lastCompactionAt: now,
    };

    // 更新会话
    session.compactionCount++;
    session.updatedAt = now;

    // 保存压缩记录
    const records = this.cache.compactionRecords.get(sessionId) || [];
    records.push(record);
    this.cache.compactionRecords.set(sessionId, records);

    // 持久化所有变更
    await this.saveContextFile(sessionId);
    await this.saveHistoryFile(sessionId);
    await this.saveSessionFile(sessionId);
    await this.saveCompactionFile(sessionId);

    return record;
  }

  // ==================== 完整历史管理 ====================

  async getFullHistory(filter: HistoryFilter, options?: HistoryQueryOptions): Promise<HistoryMessage[]> {
    this.ensureInitialized();

    const history = this.cache.histories.get(filter.sessionId) || [];
    let result = [...history];

    // 应用过滤
    if (filter.messageIds) {
      result = result.filter((m) => filter.messageIds!.includes(m.messageId));
    }
    if (filter.sequenceStart !== undefined) {
      result = result.filter((m) => m.sequence >= filter.sequenceStart!);
    }
    if (filter.sequenceEnd !== undefined) {
      result = result.filter((m) => m.sequence <= filter.sequenceEnd!);
    }
    if (filter.includeSummary === false) {
      result = result.filter((m) => !m.isSummary);
    }
    if (filter.archivedBy) {
      result = result.filter((m) => m.archivedBy === filter.archivedBy);
    }

    // 排序（历史消息默认按 sequence 排序）
    result.sort((a, b) => a.sequence - b.sequence);

    // 应用分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? result.length;
    return result.slice(offset, offset + limit);
  }

  async addMessageToHistory(sessionId: string, message: HistoryMessage): Promise<void> {
    this.ensureInitialized();

    const history = this.cache.histories.get(sessionId) || [];
    history.push(message);
    this.cache.histories.set(sessionId, history);

    // 更新会话统计
    const session = this.cache.sessions.get(sessionId);
    if (session) {
      session.totalMessages = history.length;
      session.updatedAt = Date.now();
      await this.saveSessionFile(sessionId);
    }

    await this.saveHistoryFile(sessionId);
  }

  async addMessagesToHistory(sessionId: string, messages: HistoryMessage[]): Promise<void> {
    this.ensureInitialized();

    const history = this.cache.histories.get(sessionId) || [];
    history.push(...messages);
    this.cache.histories.set(sessionId, history);

    // 更新会话统计
    const session = this.cache.sessions.get(sessionId);
    if (session) {
      session.totalMessages = history.length;
      session.updatedAt = Date.now();
      await this.saveSessionFile(sessionId);
    }

    await this.saveHistoryFile(sessionId);
  }

  async getArchivedMessages(recordId: string): Promise<HistoryMessage[]> {
    this.ensureInitialized();

    // 查找所有被该记录归档的消息
    for (const [, history] of this.cache.histories.entries()) {
      const archived = history.filter((m) => m.archivedBy === recordId);
      if (archived.length > 0) {
        return archived.sort((a, b) => a.sequence - b.sequence);
      }
    }

    return [];
  }

  async getCompactionRecords(sessionId: string): Promise<CompactionRecord[]> {
    this.ensureInitialized();
    return this.cache.compactionRecords.get(sessionId) || [];
  }

  async getCompactionRecord(recordId: string): Promise<CompactionRecord | null> {
    this.ensureInitialized();

    for (const records of this.cache.compactionRecords.values()) {
      const record = records.find((r) => r.recordId === recordId);
      if (record) return record;
    }

    return null;
  }

  // ==================== 任务管理 ====================

  async saveTask(task: Omit<TaskData, 'createdAt' | 'updatedAt'>): Promise<void> {
    this.ensureInitialized();

    const now = Date.now();
    const existing = this.cache.tasks.get(task.taskId);

    const taskData: TaskData = {
      ...task,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.cache.tasks.set(task.taskId, taskData);
    await this.saveTaskFile(task.taskId);
  }

  async getTask(taskId: string): Promise<TaskData | null> {
    this.ensureInitialized();
    return this.cache.tasks.get(taskId) || null;
  }

  async queryTasks(filter?: TaskFilter, options?: QueryOptions): Promise<TaskData[]> {
    this.ensureInitialized();

    let tasks = Array.from(this.cache.tasks.values());

    // 应用过滤
    if (filter) {
      if (filter.sessionId) {
        tasks = tasks.filter((t) => t.sessionId === filter.sessionId);
      }
      if (filter.taskId) {
        tasks = tasks.filter((t) => t.taskId === filter.taskId);
      }
      if (filter.parentTaskId !== undefined) {
        if (filter.parentTaskId === null) {
          tasks = tasks.filter((t) => !t.parentTaskId);
        } else {
          tasks = tasks.filter((t) => t.parentTaskId === filter.parentTaskId);
        }
      }
      if (filter.status) {
        tasks = tasks.filter((t) => t.status === filter.status);
      }
    }

    // 应用排序
    const orderBy = options?.orderBy ?? 'updatedAt';
    const direction = options?.orderDirection ?? 'desc';
    tasks.sort((a, b) => {
      const aValue = a[orderBy as keyof TaskData] as number;
      const bValue = b[orderBy as keyof TaskData] as number;
      const comparison = aValue - bValue;
      return direction === 'asc' ? comparison : -comparison;
    });

    // 应用分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? tasks.length;
    return tasks.slice(offset, offset + limit);
  }

  async deleteTask(taskId: string): Promise<void> {
    this.ensureInitialized();

    this.cache.tasks.delete(taskId);
    await this.deleteTaskFile(taskId);
  }

  async saveSubTaskRun(run: Omit<SubTaskRunData, 'createdAt' | 'updatedAt'>): Promise<void> {
    this.ensureInitialized();

    const now = Date.now();
    const existing = this.cache.subTaskRuns.get(run.runId);
    const normalizedMessageCount =
      run.messageCount ??
      (Array.isArray(run.messages) ? run.messages.length : 0);
    const { messages: _legacyMessages, ...runWithoutMessages } = run as SubTaskRunData;

    const runData: SubTaskRunData = {
      ...runWithoutMessages,
      messageCount: normalizedMessageCount,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.cache.subTaskRuns.set(run.runId, runData);
    await this.saveSubTaskRunFile(run.runId);
  }

  async getSubTaskRun(runId: string): Promise<SubTaskRunData | null> {
    this.ensureInitialized();
    return this.cache.subTaskRuns.get(runId) || null;
  }

  async querySubTaskRuns(filter?: SubTaskRunFilter, options?: QueryOptions): Promise<SubTaskRunData[]> {
    this.ensureInitialized();

    let runs = Array.from(this.cache.subTaskRuns.values());

    if (filter) {
      if (filter.runId) {
        runs = runs.filter((r) => r.runId === filter.runId);
      }
      if (filter.parentSessionId) {
        runs = runs.filter((r) => r.parentSessionId === filter.parentSessionId);
      }
      if (filter.childSessionId) {
        runs = runs.filter((r) => r.childSessionId === filter.childSessionId);
      }
      if (filter.status) {
        runs = runs.filter((r) => r.status === filter.status);
      }
      if (filter.mode) {
        runs = runs.filter((r) => r.mode === filter.mode);
      }
    }

    const orderBy = options?.orderBy ?? 'updatedAt';
    const direction = options?.orderDirection ?? 'desc';
    runs.sort((a, b) => {
      const aValue = a[orderBy as keyof SubTaskRunData] as number;
      const bValue = b[orderBy as keyof SubTaskRunData] as number;
      const comparison = aValue - bValue;
      return direction === 'asc' ? comparison : -comparison;
    });

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? runs.length;
    return runs.slice(offset, offset + limit);
  }

  async deleteSubTaskRun(runId: string): Promise<void> {
    this.ensureInitialized();
    this.cache.subTaskRuns.delete(runId);
    await this.deleteSubTaskRunFile(runId);
  }

  // ==================== 私有方法 - 数据加载 ====================

  private async loadAllData(): Promise<void> {
    // 加载会话
    const sessionFiles = await fs.readdir(this.sessionsPath).catch(() => []);
    for (const file of sessionFiles) {
      if (file.endsWith('.json')) {
        const sessionId = file.replace('.json', '');
        await this.loadSessionFile(sessionId);
      }
    }

    // 加载上下文
    const contextFiles = await fs.readdir(this.contextsPath).catch(() => []);
    for (const file of contextFiles) {
      if (file.endsWith('.json')) {
        const sessionId = file.replace('.json', '');
        await this.loadContextFile(sessionId);
      }
    }

    // 加载历史
    const historyFiles = await fs.readdir(this.historiesPath).catch(() => []);
    for (const file of historyFiles) {
      if (file.endsWith('.json')) {
        const sessionId = file.replace('.json', '');
        await this.loadHistoryFile(sessionId);
      }
    }

    // 加载压缩记录
    const compactionFiles = await fs.readdir(this.compactionsPath).catch(() => []);
    for (const file of compactionFiles) {
      if (file.endsWith('.json')) {
        const sessionId = file.replace('.json', '');
        await this.loadCompactionFile(sessionId);
      }
    }

    // 加载任务
    const taskFiles = await fs.readdir(this.tasksPath).catch(() => []);
    for (const file of taskFiles) {
      if (file.endsWith('.json')) {
        if (file.startsWith('subtask-run-')) {
          const encodedRunId = file.replace('subtask-run-', '').replace('.json', '');
          const runId = decodeURIComponent(encodedRunId);
          await this.loadSubTaskRunFile(runId);
        } else {
          const taskId = file.replace('.json', '');
          await this.loadTaskFile(taskId);
        }
      }
    }

    // 加载元数据
    await this.loadMetadata();
  }

  private async loadMetadata(): Promise<void> {
    const metadataPath = path.join(this.basePath, 'metadata.json');
    try {
      const data = await fs.readFile(metadataPath, 'utf-8');
      const parsed = JSON.parse(data);
      // 元数据仅用于信息展示，不影响核心功能
      console.log('Loaded metadata:', parsed.metadata);
    } catch {
      // 元数据文件不存在或损坏，忽略
    }
  }

  private async loadSessionFile(sessionId: string): Promise<void> {
    const filePath = path.join(this.sessionsPath, `${sessionId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const session: SessionData = JSON.parse(data);
      this.cache.sessions.set(sessionId, session);
    } catch (error) {
      console.error(`Error loading session ${sessionId}:`, error);
    }
  }

  private async loadContextFile(sessionId: string): Promise<void> {
    const filePath = path.join(this.contextsPath, `${sessionId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const context: CurrentContext = JSON.parse(data);
      this.cache.contexts.set(sessionId, context);
    } catch (error) {
      console.error(`Error loading context ${sessionId}:`, error);
    }
  }

  private async loadHistoryFile(sessionId: string): Promise<void> {
    const filePath = path.join(this.historiesPath, `${sessionId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const history: HistoryMessage[] = JSON.parse(data);
      this.cache.histories.set(sessionId, history);
    } catch (error) {
      console.error(`Error loading history ${sessionId}:`, error);
    }
  }

  private async loadCompactionFile(sessionId: string): Promise<void> {
    const filePath = path.join(this.compactionsPath, `${sessionId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const records: CompactionRecord[] = JSON.parse(data);
      this.cache.compactionRecords.set(sessionId, records);
    } catch (error) {
      console.error(`Error loading compaction records ${sessionId}:`, error);
    }
  }

  private async loadTaskFile(taskId: string): Promise<void> {
    const filePath = path.join(this.tasksPath, `${taskId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const task: TaskData = JSON.parse(data);
      this.cache.tasks.set(taskId, task);
    } catch (error) {
      console.error(`Error loading task ${taskId}:`, error);
    }
  }

  private async loadSubTaskRunFile(runId: string): Promise<void> {
    const filePath = this.getSubTaskRunFilePath(runId);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed: SubTaskRunData = JSON.parse(data);
      const normalizedMessageCount =
        parsed.messageCount ??
        (Array.isArray(parsed.messages) ? parsed.messages.length : 0);
      const { messages: _legacyMessages, ...runWithoutMessages } = parsed as SubTaskRunData;
      const run: SubTaskRunData = {
        ...runWithoutMessages,
        messageCount: normalizedMessageCount,
      };
      this.cache.subTaskRuns.set(runId, run);
      if (parsed.messages !== undefined || parsed.messageCount !== normalizedMessageCount) {
        await this.saveSubTaskRunFile(runId);
      }
    } catch (error) {
      console.error(`Error loading sub task run ${runId}:`, error);
    }
  }

  // ==================== 私有方法 - 数据持久化 ====================

  private async persistAll(): Promise<void> {
    // 保存所有变更的数据
    for (const sessionId of this.cache.sessions.keys()) {
      await this.saveSessionFile(sessionId);
    }
    for (const sessionId of this.cache.contexts.keys()) {
      await this.saveContextFile(sessionId);
    }
    for (const sessionId of this.cache.histories.keys()) {
      await this.saveHistoryFile(sessionId);
    }
    for (const sessionId of this.cache.compactionRecords.keys()) {
      await this.saveCompactionFile(sessionId);
    }
    for (const taskId of this.cache.tasks.keys()) {
      await this.saveTaskFile(taskId);
    }
    for (const runId of this.cache.subTaskRuns.keys()) {
      await this.saveSubTaskRunFile(runId);
    }
    await this.persistMetadata();
  }

  private async persistMetadata(): Promise<void> {
    const metadataPath = path.join(this.basePath, 'metadata.json');
    const metadata = {
      version: '1.0.0',
      metadata: {
        lastCleanup: Date.now(),
        totalSessions: this.cache.sessions.size,
        totalTasks: this.cache.tasks.size,
        totalSubTaskRuns: this.cache.subTaskRuns.size,
      },
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  private async saveSessionFile(sessionId: string): Promise<void> {
    const session = this.cache.sessions.get(sessionId);
    if (!session) return;

    const filePath = path.join(this.sessionsPath, `${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2));
  }

  private async saveContextFile(sessionId: string): Promise<void> {
    const context = this.cache.contexts.get(sessionId);
    if (!context) return;

    const filePath = path.join(this.contextsPath, `${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(context, null, 2));
  }

  private async saveHistoryFile(sessionId: string): Promise<void> {
    const history = this.cache.histories.get(sessionId);
    if (!history) return;

    const filePath = path.join(this.historiesPath, `${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(history, null, 2));
  }

  private async saveCompactionFile(sessionId: string): Promise<void> {
    const records = this.cache.compactionRecords.get(sessionId);
    if (!records) return;

    const filePath = path.join(this.compactionsPath, `${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(records, null, 2));
  }

  private async saveTaskFile(taskId: string): Promise<void> {
    const task = this.cache.tasks.get(taskId);
    if (!task) return;

    const filePath = path.join(this.tasksPath, `${taskId}.json`);
    await fs.writeFile(filePath, JSON.stringify(task, null, 2));
  }

  private async saveSubTaskRunFile(runId: string): Promise<void> {
    const run = this.cache.subTaskRuns.get(runId);
    if (!run) return;

    const filePath = this.getSubTaskRunFilePath(runId);
    await fs.writeFile(filePath, JSON.stringify(run, null, 2));
  }

  private async deleteSessionFile(sessionId: string): Promise<void> {
    const filePath = path.join(this.sessionsPath, `${sessionId}.json`);
    await fs.unlink(filePath).catch(() => {});
  }

  private async deleteContextFile(sessionId: string): Promise<void> {
    const filePath = path.join(this.contextsPath, `${sessionId}.json`);
    await fs.unlink(filePath).catch(() => {});
  }

  private async deleteHistoryFile(sessionId: string): Promise<void> {
    const filePath = path.join(this.historiesPath, `${sessionId}.json`);
    await fs.unlink(filePath).catch(() => {});
  }

  private async deleteCompactionFile(sessionId: string): Promise<void> {
    const filePath = path.join(this.compactionsPath, `${sessionId}.json`);
    await fs.unlink(filePath).catch(() => {});
  }

  private async deleteTaskFile(taskId: string): Promise<void> {
    const filePath = path.join(this.tasksPath, `${taskId}.json`);
    await fs.unlink(filePath).catch(() => {});
  }

  private async deleteSubTaskRunFile(runId: string): Promise<void> {
    const filePath = this.getSubTaskRunFilePath(runId);
    await fs.unlink(filePath).catch(() => {});
  }

  private getSubTaskRunFilePath(runId: string): string {
    return path.join(this.tasksPath, `subtask-run-${encodeURIComponent(runId)}.json`);
  }

  private ensureHistoryList(sessionId: string): HistoryMessage[] {
    const existing = this.cache.histories.get(sessionId);
    if (existing) return existing;

    const created: HistoryMessage[] = [];
    this.cache.histories.set(sessionId, created);
    return created;
  }

  private upsertContextMessage(context: CurrentContext, message: Message): boolean {
    const lastMessage = context.messages[context.messages.length - 1];
    if (lastMessage?.messageId === message.messageId) {
      context.messages[context.messages.length - 1] = message;
      return false;
    }

    context.messages.push(message);
    return true;
  }

  private upsertHistoryMessage(history: HistoryMessage[], message: Message): void {
    const existingIndex = this.findLastHistoryIndex(history, message.messageId);
    if (existingIndex === -1) {
      history.push({
        ...message,
        sequence: history.length + 1,
      });
      return;
    }

    history[existingIndex] = {
      ...history[existingIndex],
      ...message,
      sequence: history[existingIndex].sequence,
    };
  }

  private findLastHistoryIndex(history: HistoryMessage[], messageId: string): number {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].messageId === messageId) {
        return i;
      }
    }
    return -1;
  }

  private findLastContextIndex(messages: Message[], messageId: string): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].messageId === messageId) {
        return i;
      }
    }
    return -1;
  }

  // ==================== 私有方法 - 工具 ====================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('FileMemoryManager not initialized. Call initialize() first.');
    }
  }
}
