/**
 * MemoryManager 类型定义
 * 提供可扩展的存储接口，支持消息、任务等数据的持久化
 *
 * 核心概念：
 * 1. 当前上下文 (Current Context) - 用于 LLM 对话的活跃消息，可能被压缩
 * 2. 完整历史 (Full History) - 所有原始消息，包含被压缩替换的消息
 * 3. 压缩记录 (Compaction Records) - 记录何时发生了压缩，原始消息归档位置
 */

import type { Message } from '../session/types';

export type { Message };

/**
 * 存储项的基础接口
 */
export interface StorageItem {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 消息来源类型
 */
export type MessageSource = 'user' | 'assistant' | 'system' | 'tool' | 'summary';

/**
 * 历史消息项 - 包含完整元数据
 */
export interface HistoryMessage extends Message {
  /** 消息序号，用于排序 */
  sequence: number;
  /** 会话轮次 */
  turn?: number;
  /** 是否是压缩后的摘要消息 */
  isSummary?: boolean;
  /** 被哪个压缩记录归档 */
  archivedBy?: string;
}

/**
 * 压缩记录 - 记录上下文压缩事件
 */
export interface CompactionRecord extends StorageItem {
  recordId: string;
  sessionId: string;
  /** 压缩发生时间 */
  compactedAt: number;
  /** 压缩前消息数量 */
  messageCountBefore: number;
  /** 压缩后消息数量 */
  messageCountAfter: number;
  /** 被归档的消息ID列表 */
  archivedMessageIds: string[];
  /** 摘要消息ID */
  summaryMessageId?: string;
  /** 压缩原因 */
  reason: 'token_limit' | 'manual' | 'auto';
  /** 原始消息存储位置 */
  archiveLocation?: string;
  /** 元数据 */
  metadata?: {
    tokenCountBefore?: number;
    tokenCountAfter?: number;
    triggerMessageId?: string;
  };
}

/**
 * 当前上下文数据 - 用于 LLM 对话
 */
export interface CurrentContext extends StorageItem {
  contextId: string;
  sessionId: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 当前活跃消息（可能包含摘要消息） */
  messages: Message[];
  /** 当前上下文版本号，每次修改递增 */
  version: number;
  /** 最后压缩记录ID */
  lastCompactionId?: string;
  /** 统计信息 */
  stats?: {
    totalMessagesInHistory: number;
    compactionCount: number;
    lastCompactionAt?: number;
  };
}

/**
 * 会话数据接口 - 聚合所有会话相关信息
 */
export interface SessionData extends StorageItem {
  sessionId: string;
  title?: string;
  systemPrompt: string;
  /** 当前上下文引用 */
  currentContextId: string;
  /** 完整历史消息数量 */
  totalMessages: number;
  /** 压缩记录数量 */
  compactionCount: number;
  /** 会话状态 */
  status: 'active' | 'archived' | 'deleted';
  metadata?: Record<string, unknown>;
}

/**
 * 任务数据接口
 */
export interface TaskData extends StorageItem {
  taskId: string;
  sessionId: string;
  parentTaskId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  title: string;
  description?: string;
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 子任务运行数据（用于记录 task 工具触发的子 Agent 运行状态与索引）
 * 详细对话内容存储在 childSessionId 对应的 contexts/histories 中。
 */
export interface SubTaskRunData extends StorageItem {
  runId: string;
  /** 父会话 ID（调用 task 工具的会话） */
  parentSessionId: string;
  /** 子 Agent 会话 ID（独立于父会话） */
  childSessionId: string;
  /** 任务运行模式 */
  mode: 'foreground' | 'background';
  status: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
  description: string;
  prompt: string;
  subagentType: string;
  model?: string;
  resume?: string;
  startedAt: number;
  finishedAt?: number;
  /** 最近一次有进展的时间 */
  lastActivityAt?: number;
  /** 最近一次调用的工具名 */
  lastToolName?: string;
  turns?: number;
  toolsUsed: string[];
  output?: string;
  error?: string;
  /** 子会话消息数量（实际消息存于 contexts/histories） */
  messageCount?: number;
  /** 兼容历史数据：旧版本可能会直接内嵌 messages */
  messages?: Message[];
  metadata?: Record<string, unknown>;
}

/**
 * 查询选项接口
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';
}

/**
 * 历史查询选项接口
 */
export interface HistoryQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt' | 'sequence';
  orderDirection?: 'asc' | 'desc';
}

/**
 * 会话查询过滤条件
 */
export interface SessionFilter {
  sessionId?: string;
  status?: SessionData['status'];
  startTime?: number;
  endTime?: number;
}

/**
 * 任务查询过滤条件
 */
export interface TaskFilter {
  sessionId?: string;
  taskId?: string;
  parentTaskId?: string | null;
  status?: TaskData['status'];
}

/**
 * 子任务运行查询过滤条件
 */
export interface SubTaskRunFilter {
  runId?: string;
  parentSessionId?: string;
  childSessionId?: string;
  status?: SubTaskRunData['status'];
  mode?: SubTaskRunData['mode'];
}

/**
 * 历史消息查询过滤条件
 */
export interface HistoryFilter {
  sessionId: string;
  /** 查询特定消息ID */
  messageIds?: string[];
  /** 查询范围 */
  sequenceStart?: number;
  sequenceEnd?: number;
  /** 是否包含摘要消息 */
  includeSummary?: boolean;
  /** 查询被特定压缩记录归档的消息 */
  archivedBy?: string;
}

/**
 * 压缩上下文参数
 */
export interface CompactContextOptions {
  /** 保留最近 N 条消息 */
  keepLastN: number;
  /** 摘要消息内容 */
  summaryMessage: Message;
  /** 压缩原因 */
  reason?: CompactionRecord['reason'];
  /** 触发压缩的消息ID */
  triggerMessageId?: string;
  /** 压缩前 token 数量 */
  tokenCountBefore?: number;
  /** 压缩后 token 数量 */
  tokenCountAfter?: number;
}

/**
 * MemoryManager 接口定义
 * 所有存储实现必须遵循此接口
 */
export interface IMemoryManager {
  // ==================== 会话管理 ====================

  /**
   * 创建新会话
   * @param sessionId 可选的会话ID，不提供则自动生成
   * @param systemPrompt 系统提示词
   * @returns 创建的会话ID
   */
  createSession(sessionId: string | undefined, systemPrompt: string): Promise<string>;

  /**
   * 获取会话信息
   * @param sessionId 会话ID
   */
  getSession(sessionId: string): Promise<SessionData | null>;

  /**
   * 查询会话列表
   * @param filter 过滤条件
   * @param options 查询选项
   */
  querySessions(filter?: SessionFilter, options?: QueryOptions): Promise<SessionData[]>;

  /**
   * 更新会话信息
   * @param sessionId 会话ID
   * @param updates 更新的字段
   */
  updateSession(sessionId: string, updates: Partial<Omit<SessionData, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void>;

  /**
   * 删除会话（包括所有关联数据）
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * 归档会话（保留数据但标记为非活跃）
   * @param sessionId 会话ID
   */
  archiveSession(sessionId: string): Promise<void>;

  // ==================== 当前上下文管理 ====================

  /**
   * 获取当前上下文（用于 LLM 对话）
   * @param sessionId 会话ID
   * @returns 当前上下文数据
   */
  getCurrentContext(sessionId: string): Promise<CurrentContext | null>;

  /**
   * 保存当前上下文
   * @param context 上下文数据
   */
  saveCurrentContext(context: Omit<CurrentContext, 'createdAt' | 'updatedAt'>): Promise<void>;

  /**
   * 添加消息到当前上下文
   * @param sessionId 会话ID
   * @param message 消息对象
   * @param options 可选配置
   */
  addMessageToContext(
    sessionId: string,
    message: Message,
    options?: { addToHistory?: boolean }
  ): Promise<void>;

  /**
   * 批量添加消息到当前上下文
   * @param sessionId 会话ID
   * @param messages 消息数组
   * @param options 可选配置
   */
  addMessagesToContext(
    sessionId: string,
    messages: Message[],
    options?: { addToHistory?: boolean }
  ): Promise<void>;

  /**
   * 更新当前上下文中的消息
   * @param sessionId 会话ID
   * @param messageId 消息ID
   * @param updates 更新的字段
   */
  updateMessageInContext(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void>;

  /**
   * 清空当前上下文（保留系统消息）
   * @param sessionId 会话ID
   */
  clearContext(sessionId: string): Promise<void>;

  /**
   * 压缩当前上下文
   * 将 keepLastN 之前的消息归档到历史，替换为摘要消息
   * @param sessionId 会话ID
   * @param options 压缩选项
   * @returns 压缩记录
   */
  compactContext(sessionId: string, options: CompactContextOptions): Promise<CompactionRecord>;

  // ==================== 完整历史管理 ====================

  /**
   * 获取完整历史消息（按时间顺序）
   * @param filter 过滤条件
   * @param options 查询选项
   */
  getFullHistory(filter: HistoryFilter, options?: QueryOptions): Promise<HistoryMessage[]>;

  /**
   * 添加消息到完整历史
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessageToHistory(sessionId: string, message: HistoryMessage): Promise<void>;

  /**
   * 批量添加消息到完整历史
   * @param sessionId 会话ID
   * @param messages 消息数组
   */
  addMessagesToHistory(sessionId: string, messages: HistoryMessage[]): Promise<void>;

  /**
   * 获取特定压缩记录归档的原始消息
   * @param recordId 压缩记录ID
   */
  getArchivedMessages(recordId: string): Promise<HistoryMessage[]>;

  /**
   * 获取会话的所有压缩记录
   * @param sessionId 会话ID
   */
  getCompactionRecords(sessionId: string): Promise<CompactionRecord[]>;

  /**
   * 获取特定压缩记录
   * @param recordId 压缩记录ID
   */
  getCompactionRecord(recordId: string): Promise<CompactionRecord | null>;

  // ==================== 任务管理 ====================

  /**
   * 保存或更新任务
   * @param task 任务数据
   */
  saveTask(task: Omit<TaskData, 'createdAt' | 'updatedAt'>): Promise<void>;

  /**
   * 获取任务
   * @param taskId 任务ID
   */
  getTask(taskId: string): Promise<TaskData | null>;

  /**
   * 查询任务列表
   * @param filter 过滤条件
   * @param options 查询选项
   */
  queryTasks(filter?: TaskFilter, options?: QueryOptions): Promise<TaskData[]>;

  /**
   * 删除任务
   * @param taskId 任务ID
   */
  deleteTask(taskId: string): Promise<void>;

  // ==================== 子任务运行管理 ====================

  /**
   * 保存或更新子任务运行记录
   * @param run 子任务运行数据
   */
  saveSubTaskRun(run: Omit<SubTaskRunData, 'createdAt' | 'updatedAt'>): Promise<void>;

  /**
   * 获取子任务运行记录
   * @param runId 运行 ID
   */
  getSubTaskRun(runId: string): Promise<SubTaskRunData | null>;

  /**
   * 查询子任务运行记录
   * @param filter 过滤条件
   * @param options 查询选项
   */
  querySubTaskRuns(filter?: SubTaskRunFilter, options?: QueryOptions): Promise<SubTaskRunData[]>;

  /**
   * 删除子任务运行记录
   * @param runId 运行 ID
   */
  deleteSubTaskRun(runId: string): Promise<void>;

  // ==================== 通用操作 ====================

  /**
   * 初始化存储
   */
  initialize(): Promise<void>;

  /**
   * 关闭存储连接/清理资源
   */
  close(): Promise<void>;

  /**
   * 检查存储是否可用
   */
  isHealthy(): Promise<boolean>;
}

/**
 * MemoryManager 配置选项
 */
export interface MemoryManagerOptions {
  /** 存储类型 */
  type: 'file' | 'sqlite' | 'memory' | string;
  /** 存储路径/连接字符串 */
  connectionString?: string;
  /** 其他配置参数 */
  config?: Record<string, unknown>;
}

/**
 * MemoryManager 工厂函数类型
 */
export type MemoryManagerFactory = (options: MemoryManagerOptions) => IMemoryManager;
