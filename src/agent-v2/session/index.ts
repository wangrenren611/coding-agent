import { v4 as uuid } from "uuid";
import { Message, SessionOptions } from "./types";
import type { IMemoryManager } from "../memory/types";
import { Compaction, CompactionConfig } from "./compaction";
import { LLMProvider } from "../../providers";

export interface SessionConfig extends SessionOptions {
  sessionId?: string;
  memoryManager?: IMemoryManager;
  /** 是否启用自动压缩 */
  enableCompaction?: boolean;
  /** 压缩配置 */
  compactionConfig?: Partial<Omit<CompactionConfig, "llmProvider">>;
  /** LLM Provider（启用压缩时需要） */
  provider?: LLMProvider;
}

export type { Message, SessionOptions } from './types';
export type { CompactionConfig } from './compaction';

/**
 * Session 类 - 管理对话消息
 *
 * 核心概念：
 * 1. 当前上下文 (Current Context) - 用于 LLM 对话的活跃消息，可能被压缩
 * 2. 完整历史 (Full History) - 所有原始消息，通过 MemoryManager 管理
 *
 * 设计原则：
 * 1. 所有消息操作保持同步，确保 Agent 执行流程不被阻塞
 * 2. 持久化操作异步在后台执行，失败不影响主流程
 * 3. 支持通过 MemoryManager 恢复历史会话
 */
export class Session {
  private sessionId: string;
  private messages: Message[] = [];
  private systemPrompt: string;
  private memoryManager?: IMemoryManager;
  private persistQueue: Promise<void> = Promise.resolve();
  private compaction?: Compaction;
  private enableCompaction: boolean;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  constructor(options: SessionConfig) {
    this.sessionId = options.sessionId || uuid();
    this.systemPrompt = options.systemPrompt;
    this.memoryManager = options.memoryManager;
    this.enableCompaction = options.enableCompaction ?? false;

    if (this.enableCompaction && !options.provider) {
      throw new Error('Session compaction requires a provider');
    }

    // 初始化压缩器
    if (this.enableCompaction && options.provider) {
      const maxTokens = options.compactionConfig?.maxTokens ?? options.provider.getLLMMaxTokens() ?? 200 * 1000;
      const maxOutputTokens = options.compactionConfig?.maxOutputTokens ?? options.provider.getMaxOutputTokens() ?? 8000;
      this.compaction = new Compaction({
        maxTokens,
        maxOutputTokens,
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

    // 如果有 memoryManager，需要异步初始化会话
    if (this.memoryManager) {
      // 注意：构造函数不能是 async，所以这里只启动初始化
      // 调用者应该在使用前确保初始化完成
    } else {
      this.initialized = true;
    }
  }

  /**
   * 初始化会话（创建或加载）
   * 使用 MemoryManager 时需要先调用此方法
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.memoryManager) {
      this.initialized = true;
      return;
    }

    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = (async () => {
      if (!this.memoryManager) return;

      // 尝试加载已有会话
      const existingSession = await this.memoryManager.getSession(this.sessionId);

      if (existingSession) {
        // 加载已有会话的上下文
        const context = await this.memoryManager.getCurrentContext(this.sessionId);
        if (context) {
          this.messages = context.messages;
          this.systemPrompt = context.systemPrompt;
        }
      } else {
        // 创建新会话
        await this.memoryManager.createSession(this.sessionId, this.systemPrompt);
      }

      this.initialized = true;
    })();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  /**
   * 添加或更新消息
   * - 如果 message.messageId 与最后一条消息一致，则更新最后一条消息
   * - 否则添加新消息
   * @returns 返回消息的 messageId
   */
  addMessage(message: Message): string {
    const messageIdentifier = message.messageId;
    const lastMessage = this.getLastMessage();
    const isUpdate = Boolean(messageIdentifier && lastMessage?.messageId === messageIdentifier);

    // 如果是同一条消息的更新，替换最后一条消息
    if (isUpdate) {
      this.messages[this.messages.length - 1] = message;
    } else {
      // 添加新消息
      const messageId = message.messageId;
      const newMessage: Message = {
        ...message,
        messageId,
      };
      this.messages.push(newMessage);
    }

    // 异步持久化到 MemoryManager
    if (this.memoryManager) {
      this.queuePersistOperation(message, isUpdate ? 'update' : 'add');
    }

    return messageIdentifier;
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

      if (this.memoryManager) {
        this.queuePersistOperation(message, isUpdate ? 'update' : 'add');
      }
    }
  }

  getMessages() {
    return this.messages;
  }

  getSessionId() {
    return this.sessionId;
  }

  clearMessages() {
    // 保留系统消息
    const systemMessage = this.messages.find((m) => m.role === 'system');
    this.messages = systemMessage ? [systemMessage] : [];

    if (this.memoryManager) {
      this.memoryManager.clearContext(this.sessionId).catch(console.error);
    }
  }

  getMessageCount() {
    return this.messages.length;
  }

  getLastMessage() {
    return this.messages[this.messages.length - 1];
  }

  getFirstMessage() {
    return this.messages[0];
  }

  /**
   * 检查是否需要压缩
   * 压缩后基于内容重新估算 token 数，而不是累加可能不准确的 usage
   */
  shouldCompact(): boolean {
    if (!this.compaction) return false;
    return this.compaction.shouldCompact(this.messages);
  }

  /**
   * 获取当前 Token 使用情况
   */
  getTokenInfo(): {
    estimatedTotal: number;
    accumulatedTotal: number;
    hasReliableUsage: boolean;
    messageCount: number;
  } {
    if (!this.compaction) {
      return {
        estimatedTotal: 0,
        accumulatedTotal: 0,
        hasReliableUsage: false,
        messageCount: this.messages.length,
      };
    }

    const info = this.compaction.getCurrentTokenCount(this.messages);
    return {
      ...info,
      messageCount: this.messages.length,
    };
  }

  /**
   * 执行压缩
   * 使用 Compaction 类自动压缩上下文
   */
  async compact(): Promise<boolean> {
    if (!this.compaction) return false;

    // 压缩前等待消息持久化队列，确保 MemoryManager 侧上下文与内存一致
    await this.persistQueue;

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
   * 在发起下一次 LLM 请求前进行压缩检查
   * 仅在启用压缩时生效
   */
  async compactBeforeLLMCall(): Promise<boolean> {
    if (!this.enableCompaction || !this.compaction) {
      return false;
    }

    if (this.memoryManager) {
      await this.persistQueue;
    }

    if (!this.compaction.shouldCompact(this.messages)) {
      return false;
    }

    console.log('[Session] LLM 调用前触发压缩检查，执行上下文压缩');
    return this.compact();
  }

  /**
   * 手动压缩上下文（指定保留消息数和摘要）
   * @param keepLastN 保留最近 N 条消息
   * @param summaryMessage 摘要消息
   */
  async manualCompact(keepLastN: number, summaryMessage: Message): Promise<void> {
    if (!this.memoryManager) {
      // 没有 MemoryManager 时，简单截断内存中的消息
      const systemMessage = this.messages.find((m) => m.role === 'system');
      const recentMessages = this.messages.slice(-keepLastN);
      this.messages = systemMessage
        ? [systemMessage, summaryMessage, ...recentMessages.filter(m => m.role !== 'system')]
        : [summaryMessage, ...recentMessages];
      return;
    }

    // 使用 MemoryManager 的压缩功能
    await this.memoryManager.compactContext(this.sessionId, {
      keepLastN,
      summaryMessage,
      reason: 'manual',
    });

    // 重新加载当前上下文
    const context = await this.memoryManager.getCurrentContext(this.sessionId);
    if (context) {
      this.messages = context.messages;
    }
  }

  /**
   * 计算 Token 使用量
   */
  calculateTokens(): number {
    return this.messages.reduce((acc, msg) => acc + this.getContentLength(msg.content), 0);
  }

  /**
   * 获取 MemoryManager 实例
   */
  getMemoryManager(): IMemoryManager | undefined {
    return this.memoryManager;
  }

  /**
   * 立即同步当前状态到 MemoryManager
   */
  async sync(): Promise<void> {
    if (!this.memoryManager) return;

    // 等待所有待处理的持久化操作完成
    await this.persistQueue;

    // 保存当前上下文
    const context = await this.memoryManager.getCurrentContext(this.sessionId);
    if (context) {
      await this.memoryManager.saveCurrentContext({
        ...context,
        messages: [...this.messages],
      });
    }
  }

  /**
   * 将消息持久化操作串行化，避免流式更新时出现竞态
   */
  private queuePersistOperation(
    message: Message,
    operation: 'add' | 'update'
  ): void {
    this.persistQueue = this.persistQueue
      .then(async () => {
        if (!this.memoryManager) return;

        if (operation === 'update') {
          const { messageId: _messageId, ...updates } = message;
          await this.memoryManager.updateMessageInContext(
            this.sessionId,
            message.messageId,
            updates
          );
          return;
        }

        await this.memoryManager.addMessageToContext(this.sessionId, message);
      })
      .catch((error) => {
        console.error(`Failed to persist message (${operation}):`, error);
      });
  }

  private getContentLength(content: Message['content']): number {
    if (typeof content === 'string') {
      return content.length;
    }
    return JSON.stringify(content).length;
  }
}
