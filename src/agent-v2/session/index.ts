import { v4 as uuid } from "uuid";
import { Message, SessionOptions } from "./types";
import type { IMemoryManager, CurrentContext } from "../memory/types";
import { Compaction, CompactionConfig } from "./compaction";
import { LLMProvider } from "../../providers";

export interface SessionConfig extends SessionOptions {
  sessionId?: string;
  memoryManager?: IMemoryManager;
  /** 是否启用自动压缩 */
  enableCompaction?: boolean;
  /** 压缩配置 */
  compactionConfig?: Omit<CompactionConfig, "llmProvider">;
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

  constructor(options: SessionConfig) {
    this.sessionId = options.sessionId || uuid();
    this.systemPrompt = options.systemPrompt;
    this.memoryManager = options.memoryManager;
    this.enableCompaction = options.enableCompaction ?? false;

    // 初始化压缩器
    if (this.enableCompaction && options.provider) {
      this.compaction = new Compaction({
        maxTokens: options.provider.getLLMMaxTokens() ?? 200*1000,
        maxOutputTokens: options.provider.getMaxOutputTokens() ?? 8000,
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
    }
  }

  /**
   * 初始化会话（创建或加载）
   * 使用 MemoryManager 时需要先调用此方法
   */
  async initialize(): Promise<void> {
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
  }

  /**
   * 添加或更新消息
   * - 如果 message.id 存在且与最后一条消息的 id 相同，则更新最后一条消息
   * - 否则添加新消息
   * @returns 返回消息的 messageId
   */
  addMessage(message: Message): string {
    const messageIdentifier = message.messageId;
    const lastMessage = this.getLastMessage();

    // 如果是同一条消息的更新，替换最后一条消息
    if (messageIdentifier && lastMessage?.messageId === messageIdentifier) {
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
      this.queuePersistMessage(message);
    }

    // 如果启用了自动压缩，检查是否需要压缩
    if (this.enableCompaction && this.compaction) {
      this.checkAndCompactAsync();
    }

    return messageIdentifier;
  }

  /**
   * 异步检查并执行压缩
   */
  private async checkAndCompactAsync(): Promise<void> {
    if (!this.compaction) return;

    const info = this.compaction.getTokenInfo(this.messages);
    if (info.shouldCompact) {
      console.log(`[Session] 自动触发压缩，当前 Token: ${info.totalUsed}`);
      try {
        const compacted = await this.compact();
        if (compacted) {
          console.log(`[Session] 自动压缩完成，新消息数: ${this.messages.length}`);
        }
      } catch (error) {
        console.error('[Session] 自动压缩失败:', error);
      }
    }
  }

  /**
   * 批量添加消息
   */
  addMessages(messages: Message[]): void {
    for (const message of messages) {
      const lastMessage = this.getLastMessage();
      if (message.messageId && lastMessage?.messageId === message.messageId) {
        this.messages[this.messages.length - 1] = message;
      } else {
        this.messages.push(message);
      }
    }

    // 异步持久化
    if (this.memoryManager) {
      for (const message of messages) {
        this.queuePersistMessage(message);
      }
    }

    // 如果启用了自动压缩，检查是否需要压缩
    if (this.enableCompaction && this.compaction) {
      this.checkAndCompactAsync();
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
   * 获取压缩配置
   */
  private getCompactionConfig(): { maxTokens: number; triggerRatio: number; keepMessagesNum: number } | null {
    if (!this.compaction) return null;
    return this.compaction.getConfig();
  }

  /**
   * 检查是否需要压缩
   * 压缩后基于内容重新估算 token 数，而不是累加可能不准确的 usage
   */
  shouldCompact(): boolean {
    if (!this.compaction) return false;

    const tokenInfo = this.compaction.getCurrentTokenCount(this.messages);
    const config = this.getCompactionConfig();
    if (!config) return false;

    const threshold = config.maxTokens * config.triggerRatio;

    // 使用估算值（压缩后更准确）
    return (
      tokenInfo.estimatedTotal >= threshold &&
      this.messages.length > config.keepMessagesNum
    );
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

  contextLeft() {
    // TODO: 返回剩余上下文
    return this.messages;
  }

  /**
   * 计算 Token 使用量
   */
  calculateTokens(): number {
    return this.messages.reduce((acc, msg) => acc + msg.content.length, 0);
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
   * 将会话数据持久化到 MemoryManager
   * 使用队列确保顺序执行，避免竞态条件
   */
  private queuePersistMessage(message: Message): void {
    this.persistQueue = this.persistQueue
      .then(async () => {
        if (!this.memoryManager) return;
        await this.memoryManager.addMessageToContext(this.sessionId, message);
      })
      .catch((error) => {
        console.error('Failed to persist message:', error);
      });
  }
}
