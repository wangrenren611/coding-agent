import { v4 as uuid } from "uuid";
import { Message } from "./types";
import type { IMemoryManager } from "../memory/types";
import { Compaction, CompactionConfig, CompactionResult } from "./compaction";
import { LLMProvider } from "../../providers";
import { ToolCallRepairer } from "./tool-call-repairer";

export interface SessionConfig {
  sessionId?: string;
  systemPrompt: string;
  memoryManager?: IMemoryManager;
  /** 是否启用自动压缩 */
  enableCompaction?: boolean;
  /** 压缩配置 */
  compactionConfig?: Partial<Omit<CompactionConfig, "llmProvider">>;
  /** LLM Provider（启用压缩时需要） */
  provider?: LLMProvider;
}

export type { Message, SessionOptions } from './types';
export type { CompactionConfig, CompactionResult } from './compaction';

/**
 * Session 类 - 管理对话消息
 *
 * 职责：
 * 1. 消息存储和管理（增删改查）
 * 2. 持久化到 MemoryManager
 * 3. 压缩功能入口
 */
export class Session {
  private readonly sessionId: string;
  private messages: Message[] = [];
  private readonly systemPrompt: string;
  private readonly memoryManager?: IMemoryManager;
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly compaction?: Compaction;
  private readonly repairer = new ToolCallRepairer();
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  constructor(options: SessionConfig) {
    this.sessionId = options.sessionId || uuid();
    this.systemPrompt = options.systemPrompt;
    this.memoryManager = options.memoryManager;

    // 初始化压缩器
    if (options.enableCompaction) {
      if (!options.provider) {
        throw new Error('Session compaction requires a provider');
      }
      this.compaction = new Compaction({
        maxTokens: options.compactionConfig?.maxTokens ?? options.provider.getLLMMaxTokens() ?? 200000,
        maxOutputTokens: options.compactionConfig?.maxOutputTokens ?? options.provider.getMaxOutputTokens() ?? 8000,
        llmProvider: options.provider,
        keepMessagesNum: options.compactionConfig?.keepMessagesNum ?? 40,
        triggerRatio: options.compactionConfig?.triggerRatio ?? 0.90,
      });
    }

    // 初始化系统消息
    this.messages = [{
      messageId: 'system',
      role: 'system',
      content: this.systemPrompt,
    }];

    // 无 MemoryManager 时直接标记为已初始化
    if (!this.memoryManager) {
      this.initialized = true;
    }
  }

  // ==================== 初始化 ====================

  /**
   * 初始化会话（创建或加载历史）
   * 使用 initializePromise 防止并发初始化导致的竞态条件
   */
  async initialize(): Promise<void> {
    // 已初始化则直接返回
    if (this.initialized) return;
    if (!this.memoryManager) {
      this.initialized = true;
      return;
    }

    // 如果已有初始化进行中，等待其完成（防止竞态条件）
    if (this.initializePromise) {
      return this.initializePromise;
    }

    // 创建初始化 Promise 并立即赋值，防止后续调用重复初始化
    this.initializePromise = this.doInitialize();
    
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    if (!this.memoryManager) return;

    const existingSession = await this.memoryManager.getSession(this.sessionId);

    if (existingSession) {
      const context = await this.memoryManager.getCurrentContext(this.sessionId);
      if (context) {
        this.messages = [...context.messages];
      }
    } else {
      await this.memoryManager.createSession(this.sessionId, this.systemPrompt);
    }

    this.initialized = true;
  }

  // ==================== 消息管理 ====================

  /**
   * 添加或更新消息
   * 如果 messageId 与最后一条消息一致，则更新；否则添加新消息
   */
  addMessage(message: Message): string {
    const lastMessage = this.getLastMessage();
    const isUpdate = Boolean(message.messageId && lastMessage?.messageId === message.messageId);

    if (isUpdate) {
      this.messages[this.messages.length - 1] = {
        ...lastMessage,
        ...message,
      };
    } else {
      this.messages.push({ ...message });
    }

    this.schedulePersist(message, isUpdate ? 'update' : 'add');
    return message.messageId;
  }

  /**
   * 批量添加消息
   */
  addMessages(messages: Message[]): void {
    for (const message of messages) {
      const lastMessage = this.getLastMessage();
      const isUpdate = Boolean(message.messageId && lastMessage?.messageId === message.messageId);
      
      if (isUpdate) {
        this.messages[this.messages.length - 1] = message;
      } else {
        this.messages.push(message);
      }
      
      this.schedulePersist(message, isUpdate ? 'update' : 'add');
    }
  }

  getMessages(): Message[] {
    return this.messages;
  }

  getLastMessage(): Message | undefined {
    return this.messages[this.messages.length - 1];
  }

  getFirstMessage(): Message | undefined {
    return this.messages[0];
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  clearMessages(): void {
    const systemMessage = this.messages.find(m => m.role === 'system');
    this.messages = systemMessage ? [systemMessage] : [];
    this.memoryManager?.clearContext(this.sessionId).catch(console.error);
  }

  // ==================== 压缩功能 ====================

  /**
   * 在 LLM 调用前检查并执行压缩
   * 
   * 此方法会：
   * 1. 修复中断的工具调用
   * 2. 等待持久化完成
   * 3. 检查是否需要压缩
   * 4. 如果需要，执行压缩
   */
  async compactBeforeLLMCall(): Promise<boolean> {
    // 先修复中断的工具调用
    this.repairInterruptedToolCalls();

    if (!this.compaction) {
      return false;
    }

    // 等待持久化完成
    if (this.memoryManager) {
      await this.persistQueue;
    }

    // 执行压缩（compaction.compact 内部会检查是否需要压缩）
    const result = await this.compaction.compact(
      this.messages,
      this.sessionId,
      this.memoryManager
    );

    if (result.isCompacted) {
      this.messages = result.messages;
      return true;
    }

    return false;
  }

  /**
   * 获取压缩器实例（用于外部查询 token 信息等）
   */
  getCompaction(): Compaction | undefined {
    return this.compaction;
  }

  /**
   * 获取当前 Token 使用情况
   */
  getTokenInfo() {
    if (!this.compaction) {
      return {
        estimatedTotal: 0,
        accumulatedTotal: 0,
        hasReliableUsage: false,
        messageCount: this.messages.length,
        threshold: 0,
        shouldCompact: false,
      };
    }

    const info = this.compaction.getTokenInfo(this.messages);
    return {
      ...info,
      messageCount: this.messages.length,
    };
  }

  // ==================== 持久化 ====================

  /**
   * 获取 MemoryManager 实例
   */
  getMemoryManager(): IMemoryManager | undefined {
    return this.memoryManager;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 立即同步当前状态到 MemoryManager
   */
  async sync(): Promise<void> {
    if (!this.memoryManager) return;
    await this.persistQueue;
    
    const context = await this.memoryManager.getCurrentContext(this.sessionId);
    if (context) {
      await this.memoryManager.saveCurrentContext({
        ...context,
        messages: [...this.messages],
      });
    }
  }

  private schedulePersist(message: Message, operation: 'add' | 'update'): void {
    this.persistQueue = this.persistQueue
      .then(() => this.doPersist(message, operation))
      .catch(error => {
        console.error(`[Session] Failed to persist message (${operation}):`, error);
      });
  }

  private async doPersist(message: Message, operation: 'add' | 'update'): Promise<void> {
    if (!this.memoryManager) return;

    if (operation === 'update') {
      const { messageId: _, ...updates } = message;
      await this.memoryManager.updateMessageInContext(this.sessionId, message.messageId, updates);
    } else {
      await this.memoryManager.addMessageToContext(this.sessionId, message);
    }
  }

  // ==================== 工具调用修复 ====================

  /**
   * 修复异常中断导致的未闭合 tool call
   */
  private repairInterruptedToolCalls(): void {
    // 使用 ToolCallRepairer 进行修复
    this.repairer.repairInPlace(this.messages, (msg) => {
      this.schedulePersist(msg, 'add');
    });
  }
}
