import { v4 as uuid } from 'uuid';
import { Message } from './types';
import type { ContextExclusionReason, IMemoryManager } from '../memory/types';
import { Compaction, CompactionConfig, CompactionResult } from './compaction';
import { LLMProvider, type MessageContent, type ToolCall } from '../../providers';
import { ToolCallRepairer } from './tool-call-repairer';

export interface SessionConfig {
    sessionId?: string;
    systemPrompt: string;
    memoryManager?: IMemoryManager;
    /** 是否启用自动压缩 */
    enableCompaction?: boolean;
    /** 压缩配置 */
    compactionConfig?: Partial<Omit<CompactionConfig, 'llmProvider'>>;
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
                maxOutputTokens:
                    options.compactionConfig?.maxOutputTokens ?? options.provider.getMaxOutputTokens() ?? 8000,
                llmProvider: options.provider,
                keepMessagesNum: options.compactionConfig?.keepMessagesNum ?? 40,
                triggerRatio: options.compactionConfig?.triggerRatio ?? 0.9,
            });
        }

        // 初始化系统消息
        this.messages = [
            {
                messageId: 'system',
                role: 'system',
                content: this.systemPrompt,
            },
        ];

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
        // 先检查是否有初始化进行中（防止竞态条件）
        if (this.initializePromise) {
            return this.initializePromise;
        }
        // 已初始化则直接返回
        if (this.initialized) return;
        if (!this.memoryManager) {
            this.initialized = true;
            return;
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

        // 启动时修复 tool 协议脏数据（同时更新 context + history）
        await this.repairContextToolProtocol();

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
        const systemMessage = this.messages.find((m) => m.role === 'system');
        this.messages = systemMessage ? [systemMessage] : [];
        this.memoryManager?.clearContext(this.sessionId).catch(console.error);
    }

    /**
     * 删除指定消息（内存 + 持久化）
     * reason 用于标记该消息为何从 context 排除（history 保留）
     * @returns 被删除的消息；消息不存在或是 system 消息时返回 undefined
     */
    async removeMessageById(
        messageId: string,
        reason: ContextExclusionReason = 'manual'
    ): Promise<Message | undefined> {
        const index = this.findLastMessageIndex(messageId);
        if (index === -1) {
            return undefined;
        }

        const target = this.messages[index];
        if (!target || target.role === 'system') {
            return undefined;
        }

        this.messages.splice(index, 1);

        this.persistQueue = this.persistQueue
            .then(() => this.doRemovePersist(messageId, reason))
            .catch((error) => {
                console.error(`[Session] Failed to remove message (${messageId}):`, error);
            });

        await this.persistQueue;
        return target;
    }

    /**
     * 根据 messageId 查找消息
     */
    getMessageById(messageId: string): Message | undefined {
        return this.messages.find((m) => m.messageId === messageId);
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
        if (this.memoryManager) {
            await this.persistQueue;
        }

        // 先修复中断/异常的 tool 协议（同时更新 context + history）
        await this.repairContextToolProtocol();

        if (!this.compaction) {
            return false;
        }

        // 等待持久化完成
        if (this.memoryManager) {
            await this.persistQueue;
        }

        // 执行压缩（compaction.compact 内部会检查是否需要压缩）
        const result = await this.compaction.compact(this.messages, this.sessionId, this.memoryManager);

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
            .catch((error) => {
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

    private async doRemovePersist(messageId: string, reason: ContextExclusionReason): Promise<void> {
        if (!this.memoryManager) return;
        await this.memoryManager.removeMessageFromContext(this.sessionId, messageId, reason);
    }

    private findLastMessageIndex(messageId: string): number {
        for (let index = this.messages.length - 1; index >= 0; index -= 1) {
            if (this.messages[index].messageId === messageId) {
                return index;
            }
        }
        return -1;
    }

    // ==================== 工具调用修复 ====================

    /**
     * 修复异常中断导致的 tool 协议脏数据（修复 context，并同步 history）
     */
    private async repairContextToolProtocol(): Promise<void> {
        const originalMessages = [...this.messages];
        const { messages, changed } = this.normalizeContextToolProtocol(this.messages);
        if (!changed) {
            return;
        }

        this.messages = messages;
        await this.persistProtocolRepair(originalMessages, messages);
    }

    private async persistProtocolRepair(originalMessages: Message[], normalizedMessages: Message[]): Promise<void> {
        if (!this.memoryManager) return;

        // 先同步 history（新增/更新/排除），最后再强制回写 context 顺序。
        await this.syncRepairIntoHistory(originalMessages, normalizedMessages);
        await this.persistContextSnapshot(normalizedMessages);
    }

    private async persistContextSnapshot(messages: Message[]): Promise<void> {
        if (!this.memoryManager) return;

        const context = await this.memoryManager.getCurrentContext(this.sessionId);
        if (!context) return;

        await this.memoryManager.saveCurrentContext({
            ...context,
            version: (context.version ?? 0) + 1,
            messages: [...messages],
        });
    }

    private async syncRepairIntoHistory(originalMessages: Message[], normalizedMessages: Message[]): Promise<void> {
        if (!this.memoryManager) return;

        const originalById = new Map(originalMessages.map((message) => [message.messageId, message]));
        const normalizedById = new Map(normalizedMessages.map((message) => [message.messageId, message]));

        // 1) 更新已有消息（会同时更新 context + history）
        for (const [messageId, normalized] of normalizedById.entries()) {
            const original = originalById.get(messageId);
            if (!original) continue;
            if (this.isMessageEquivalent(original, normalized)) continue;
            const { messageId: _ignored, ...updates } = normalized;
            await this.memoryManager.updateMessageInContext(this.sessionId, messageId, updates);
        }

        // 2) 排除已移除消息（history 会标记 excludedFromContext）
        for (const [messageId] of originalById.entries()) {
            if (normalizedById.has(messageId)) continue;
            await this.memoryManager.removeMessageFromContext(this.sessionId, messageId, 'invalid_response');
        }

        // 3) 新增修复消息（写入 context + history）
        for (const [messageId, normalized] of normalizedById.entries()) {
            if (originalById.has(messageId)) continue;
            await this.memoryManager.addMessageToContext(this.sessionId, normalized);
        }
    }

    private isMessageEquivalent(left: Message, right: Message): boolean {
        return JSON.stringify(left) === JSON.stringify(right);
    }

    private normalizeContextToolProtocol(messages: Message[]): { messages: Message[]; changed: boolean } {
        const normalized: Message[] = [];
        let changed = false;

        for (let index = 0; index < messages.length; ) {
            const message = messages[index];

            if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
                const validToolCalls = this.getValidToolCalls(message.tool_calls);

                if (validToolCalls.length === 0) {
                    if (this.hasAssistantOutput(message)) {
                        const { tool_calls: _ignored, ...rest } = message;
                        normalized.push({
                            ...rest,
                            type: rest.type === 'tool-call' ? 'text' : rest.type,
                        });
                    }
                    changed = true;
                    index += 1;
                    continue;
                }

                if (validToolCalls.length !== message.tool_calls.length) {
                    changed = true;
                    normalized.push({ ...message, tool_calls: validToolCalls, type: 'tool-call' });
                } else {
                    normalized.push(message);
                }

                const expectedToolCallIds = new Set(validToolCalls.map((call) => call.id));
                const respondedToolCallIds = new Set<string>();
                let cursor = index + 1;

                while (cursor < messages.length && messages[cursor].role === 'tool') {
                    const toolMessage = messages[cursor];
                    const toolCallId =
                        typeof toolMessage.tool_call_id === 'string' ? toolMessage.tool_call_id.trim() : '';

                    if (expectedToolCallIds.has(toolCallId) && !respondedToolCallIds.has(toolCallId)) {
                        normalized.push(toolMessage);
                        respondedToolCallIds.add(toolCallId);
                    } else {
                        changed = true;
                    }
                    cursor += 1;
                }

                for (const call of validToolCalls) {
                    if (!respondedToolCallIds.has(call.id)) {
                        normalized.push(this.repairer.createInterruptedResult(call.id));
                        changed = true;
                    }
                }

                index = cursor;
                continue;
            }

            if (message.role === 'tool') {
                // 丢弃游离 tool 消息（不在 assistant tool_calls 连续块之后）
                changed = true;
                index += 1;
                continue;
            }

            if (message.role === 'assistant' && !this.hasAssistantOutput(message)) {
                // 丢弃空 assistant 消息，避免上下文污染
                changed = true;
                index += 1;
                continue;
            }

            normalized.push(message);
            index += 1;
        }

        return { messages: normalized, changed };
    }

    private hasAssistantOutput(message: Pick<Message, 'content' | 'reasoning_content'>): boolean {
        return this.hasContent(message.content) || this.hasReasoningOutput(message.reasoning_content);
    }

    private hasReasoningOutput(reasoning: unknown): reasoning is string {
        return typeof reasoning === 'string' && reasoning.trim().length > 0;
    }

    private hasContent(content: MessageContent): boolean {
        if (typeof content === 'string') {
            return content.trim().length > 0;
        }
        if (Array.isArray(content)) {
            return content.length > 0;
        }
        return content !== undefined && content !== null;
    }

    private getValidToolCalls(toolCalls: ToolCall[]): ToolCall[] {
        return toolCalls.filter((toolCall) => {
            if (!toolCall || typeof toolCall !== 'object') return false;
            const hasValidId = typeof toolCall.id === 'string' && toolCall.id.trim().length > 0;
            const hasValidType = toolCall.type === 'function';
            const hasValidFunction =
                !!toolCall.function &&
                typeof toolCall.function.name === 'string' &&
                toolCall.function.name.trim().length > 0 &&
                typeof toolCall.function.arguments === 'string';
            return hasValidId && hasValidType && hasValidFunction;
        });
    }
}
