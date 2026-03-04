import { v4 as uuid } from 'uuid';
import { Message } from './types';
import {
    InputContentPart,
    LLMProvider,
    LLMResponse,
    type LLMGenerateOptions,
    type LLMRequestMessage,
    type Tool,
} from '../../providers';
import { IMemoryManager, CompactionRecord } from '../memory/types';
import { getLogger, type Logger } from '../logger';

type ToolCallLike = { id?: string };

function getAssistantToolCalls(message: Message): ToolCallLike[] {
    if (message.role !== 'assistant') {
        return [];
    }
    const rawToolCalls = message.tool_calls;
    if (!Array.isArray(rawToolCalls)) {
        return [];
    }
    return rawToolCalls.filter((call): call is ToolCallLike => typeof call === 'object' && call !== null);
}

function getToolCallId(message: Message): string | undefined {
    if (message.role !== 'tool') {
        return undefined;
    }
    const toolCallId = message.tool_call_id;
    return typeof toolCallId === 'string' ? toolCallId : undefined;
}

export interface CompactionConfig {
    /** 最大上下文 Token 数 */
    maxTokens: number;
    /** 最大输出 Token 数 */
    maxOutputTokens: number;
    /** LLM Provider（用于生成摘要） */
    llmProvider: LLMProvider;
    /** 保留最近消息数（默认 40） */
    keepMessagesNum?: number;
    /** 触发压缩的阈值比例（默认 0.90） */
    triggerRatio?: number;
    /** 日志器（可选，不提供则使用默认日志器） */
    logger?: Logger;
    /** 获取工具 Schema 的回调（用于计算 tools 定义的 token） */
    getTools?: () => Tool[];
    /** 摘要语言，跟随主 agent language 配置（默认 'English'） */
    language?: string;
}

export interface TokenInfo {
    /** 当前使用的总 token 数（估算或累加） */
    totalUsed: number;
    /** 基于内容估算的总 token 数 */
    estimatedTotal: number;
    /** usage 数据是否可靠（压缩后不可靠） */
    hasReliableUsage: boolean;
    /** 可用上限（maxTokens - maxOutputTokens） */
    usableLimit: number;
    /** 触发阈值 */
    threshold: number;
    /** 是否需要压缩 */
    shouldCompact: boolean;
}

export interface CompactionResult {
    /** 是否执行了压缩 */
    isCompacted: boolean;
    /** 摘要消息（压缩时生成） */
    summaryMessage: Message | null;
    /** 压缩后的消息列表 */
    messages: Message[];
    /** 压缩记录（有 MemoryManager 时） */
    record?: CompactionRecord;
}

function buildSummaryPrompt(language = 'English'): string {
    return `You are an expert conversation compressor. Compress conversation history into a structured summary organized in following 8 sections:
1. **Primary Request and Intent**: What is user's core goal?
2. **Key Technical Concepts**: Frameworks, libraries, tech stacks, etc.
3. **Files and Code Sections**: All file paths mentioned or modified.
4. **Errors and Fixes**: Record error messages and solutions.
5. **Problem Solving**: The thought process and decision path.
6. **All User Messages**: Preserve key instructions and feedback.
7. **Pending Tasks**: Work items that remain unfinished.
8. **Current Work**: The progress at the point conversation was interrupted.

## Requirements:
- Maintain high density and accuracy of information
- Highlight key technical decisions and solutions
- Ensure continuity of context
- Retain all important file paths
- Use concise ${language} expression`;
}

/**
 * 上下文压缩器
 *
 * 职责：
 * 1. Token 使用量计算
 * 2. 压缩判断
 * 3. 摘要生成
 * 4. 消息重组
 */
export class Compaction {
    private readonly maxTokens: number;
    private readonly maxOutputTokens: number;
    private readonly usableLimit: number;
    private readonly triggerRatio: number;
    private readonly keepMessagesNum: number;
    private readonly llmProvider: LLMProvider;
    private readonly logger: Logger;
    private readonly getTools?: () => Tool[];
    private readonly language: string;

    constructor(config: CompactionConfig) {
        this.maxTokens = config.maxTokens;
        this.maxOutputTokens = config.maxOutputTokens;
        this.usableLimit = Math.max(1, config.maxTokens - config.maxOutputTokens);
        this.llmProvider = config.llmProvider;
        this.keepMessagesNum = config.keepMessagesNum ?? 40;
        this.triggerRatio = config.triggerRatio ?? 0.9;
        this.logger = config.logger ?? getLogger();
        this.getTools = config.getTools;
        this.language = config.language ?? 'English';
    }

    /**
     * 获取 Token 使用情况
     */
    getTokenInfo(messages: Message[]): TokenInfo {
        const nonSystemMessages = messages.filter((m) => m.role !== 'system');
        const tokenCount = this.calculateTokenCount(messages);
        const threshold = this.usableLimit * this.triggerRatio;

        return {
            ...tokenCount,
            usableLimit: this.usableLimit,
            threshold,
            shouldCompact: tokenCount.totalUsed >= threshold && nonSystemMessages.length > this.keepMessagesNum,
        };
    }

    /**
     * 判断是否需要压缩
     */
    shouldCompact(messages: Message[]): boolean {
        return this.getTokenInfo(messages).shouldCompact;
    }

    /**
     * 执行压缩
     *
     * 流程：
     * 1. 检查是否需要压缩
     * 2. 分离系统消息、待压缩区、保护区
     * 3. 处理工具调用配对
     * 4. 生成摘要
     * 5. 重组消息
     */
    async compact(messages: Message[], sessionId?: string, memoryManager?: IMemoryManager): Promise<CompactionResult> {
        const tokenInfo = this.getTokenInfo(messages);

        // 不需要压缩
        if (!tokenInfo.shouldCompact) {
            return { isCompacted: false, summaryMessage: null, messages };
        }

        this.logger.info(
            `[Compaction] Triggered. tokens=${tokenInfo.totalUsed}, threshold=${Math.floor(tokenInfo.threshold)}`
        );

        // 分离消息区域
        const { systemMessage, pending, active } = this.splitMessages(messages);

        // 处理工具调用配对
        const { pending: finalPending, active: finalActive } = this.processToolCallPairs(pending, active);

        // 生成摘要
        const summaryContent = await this.generateSummary({
            pendingMessages: finalPending,
            sourceMessages: messages,
            activeMessages: finalActive,
        });

        const summaryMessage: Message = {
            messageId: uuid(),
            role: 'assistant',
            type: 'summary',
            content: summaryContent,
        };

        // 重组消息
        const newMessages = this.rebuildMessages(systemMessage, summaryMessage, finalActive);

        // 创建压缩记录
        let record: CompactionRecord | undefined;
        if (memoryManager && sessionId) {
            const newTokenCount = this.calculateTokenCount(newMessages);
            record = await memoryManager.compactContext(sessionId, {
                keepLastN: this.keepMessagesNum,
                summaryMessage,
                reason: 'token_limit',
                tokenCountBefore: tokenInfo.totalUsed,
                tokenCountAfter: newTokenCount.totalUsed,
            });
        }

        this.logger.info(`[Compaction] Completed. messages=${messages.length}->${newMessages.length}`);

        return {
            isCompacted: true,
            summaryMessage,
            messages: newMessages,
            record,
        };
    }

    /**
     * 获取配置
     */
    getConfig() {
        return {
            maxTokens: this.maxTokens,
            maxOutputTokens: this.maxOutputTokens,
            keepMessagesNum: this.keepMessagesNum,
            triggerRatio: this.triggerRatio,
        };
    }

    // ==================== 私有方法 ====================

    /**
     * 分离消息区域
     *
     * 确保保留最后一条 user 消息，因为某些 LLM API（如 GLM-5）要求消息列表必须包含 user 消息
     */
    private splitMessages(messages: Message[]): {
        systemMessage: Message | undefined;
        pending: Message[];
        active: Message[];
    } {
        const systemMessage = messages.find((m) => m.role === 'system');
        const nonSystemMessages = messages.filter((m) => m.role !== 'system');

        // 找到最后一条 user 消息的索引
        let lastUserIndex = -1;
        for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
            if (nonSystemMessages[i].role === 'user') {
                lastUserIndex = i;
                break;
            }
        }

        // 默认的切分点
        let splitPoint = nonSystemMessages.length - this.keepMessagesNum;

        // 如果最后一条 user 消息在 pending 区域，需要调整切分点
        if (lastUserIndex !== -1 && lastUserIndex < splitPoint) {
            // 将切分点移动到包含最后一条 user 消息的位置
            splitPoint = lastUserIndex;
        }

        // 确保 splitPoint 不为负
        splitPoint = Math.max(0, splitPoint);

        return {
            systemMessage,
            pending: nonSystemMessages.slice(0, splitPoint),
            active: nonSystemMessages.slice(splitPoint),
        };
    }

    /**
     * 处理工具调用配对
     * 确保保护区的 tool 消息有对应的 assistant 消息
     */
    private processToolCallPairs(pending: Message[], active: Message[]): { pending: Message[]; active: Message[] } {
        // 构建工具调用 ID -> assistant 消息的映射
        const toolCallToAssistant = new Map<string, Message>();

        for (const msg of [...pending, ...active]) {
            for (const call of getAssistantToolCalls(msg)) {
                if (call.id) {
                    toolCallToAssistant.set(call.id, msg);
                }
            }
        }

        // 找出保护区中需要配对的 tool 消息
        const toolsNeedingPair = active.filter((msg) => {
            if (msg.role !== 'tool') return false;
            const toolCallId = getToolCallId(msg);
            return typeof toolCallId === 'string' && toolCallToAssistant.has(toolCallId);
        });

        if (toolsNeedingPair.length === 0) {
            return { pending, active };
        }

        // 收集需要移动的 assistant 消息
        const assistantsToMove = new Set<Message>();
        const toolCallIdsToMove = new Set<string>();

        for (const toolMsg of toolsNeedingPair) {
            const toolCallId = getToolCallId(toolMsg);
            if (!toolCallId) {
                continue;
            }
            const assistantMsg = toolCallToAssistant.get(toolCallId);
            if (assistantMsg) {
                assistantsToMove.add(assistantMsg);
                toolCallIdsToMove.add(toolCallId);
            }
        }

        // 从 pending 中移除
        const newPending = pending.filter((msg) => {
            if (assistantsToMove.has(msg)) return false;
            if (msg.role === 'tool') {
                const toolCallId = getToolCallId(msg);
                if (toolCallId && toolCallIdsToMove.has(toolCallId)) return false;
            }
            return true;
        });

        // 构建新的 active 区域
        const newActive: Message[] = [];
        const addedMessages = new Set<Message>();

        // 先添加需要移动的 assistant + 对应的 tool
        for (const assistantMsg of assistantsToMove) {
            newActive.push(assistantMsg);
            addedMessages.add(assistantMsg);

            // 添加对应的 tool 消息
            for (const call of getAssistantToolCalls(assistantMsg)) {
                if (call?.id) {
                    const toolMsg = active.find((m) => m.role === 'tool' && getToolCallId(m) === call.id);
                    if (toolMsg && !addedMessages.has(toolMsg)) {
                        newActive.push(toolMsg);
                        addedMessages.add(toolMsg);
                    }
                }
            }
        }

        // 添加剩余的 active 消息
        for (const msg of active) {
            if (!addedMessages.has(msg)) {
                newActive.push(msg);
            }
        }

        return { pending: newPending, active: newActive };
    }

    private async generateSummary(input: {
        pendingMessages: Message[];
        sourceMessages: Message[];
        activeMessages: Message[];
    }): Promise<string> {
        const cacheSafe = await this.generateSummaryWithCacheSafeFork(input);
        if (cacheSafe) {
            return cacheSafe;
        }
        this.logger.warn('[Compaction] cache_safe_fork summary returned empty output');
        return this.extractPreviousSummary(input.pendingMessages) || 'Summary generation failed.';
    }

    /**
     * 生成摘要（cache-safe fork）
     * - 复用主会话消息前缀
     * - 追加 compaction message 触发摘要
     * - 复用同一工具定义，避免独立摘要请求导致缓存失效
     */
    private async generateSummaryWithCacheSafeFork(input: {
        pendingMessages: Message[];
        sourceMessages: Message[];
        activeMessages: Message[];
    }): Promise<string | null> {
        const { pendingMessages, sourceMessages, activeMessages } = input;
        if (pendingMessages.length === 0) {
            return null;
        }

        let previousSummary = '';
        if (pendingMessages[0]?.type === 'summary') {
            previousSummary = this.contentToText(pendingMessages[0].content);
        }

        const pendingBoundaryMessageId = pendingMessages[pendingMessages.length - 1]?.messageId;
        const requestMessages: LLMRequestMessage[] = [
            ...sourceMessages,
            {
                role: 'user',
                content: this.buildCacheSafeCompactionMessage(
                    pendingBoundaryMessageId,
                    activeMessages.length,
                    previousSummary
                ),
            },
        ];

        const summaryAbortSignal = this.createSummaryAbortSignal();
        const options: LLMGenerateOptions = {
            ...(summaryAbortSignal ? { abortSignal: summaryAbortSignal } : {}),
            max_tokens: Math.min(1024, this.maxOutputTokens),
        };

        const configuredModel = this.llmProvider.config?.model;
        if (typeof configuredModel === 'string' && configuredModel.trim().length > 0) {
            options.model = configuredModel;
        }

        const tools = this.getTools?.();
        if (tools && tools.length > 0) {
            options.tools = tools;
        }

        const response = await this.llmProvider.generate(requestMessages, options);
        if (!response || typeof response !== 'object' || !('choices' in response)) {
            return null;
        }

        const choice = (response as LLMResponse).choices?.[0];
        const hasToolCalls = Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0;
        if (hasToolCalls) {
            return null;
        }

        const content = this.contentToText(choice?.message?.content || '').trim();
        return content || null;
    }

    private extractPreviousSummary(pendingMessages: Message[]): string {
        if (pendingMessages[0]?.type === 'summary') {
            return this.contentToText(pendingMessages[0].content);
        }
        return '';
    }

    private buildCacheSafeCompactionMessage(
        pendingBoundaryMessageId: string | undefined,
        activeMessagesCount: number,
        previousSummary: string
    ): string {
        const summaryPrompt = buildSummaryPrompt(this.language);
        const boundaryLine = pendingBoundaryMessageId
            ? `Summarize historical context up to and including messageId "${pendingBoundaryMessageId}".`
            : 'Summarize earlier historical context in this conversation.';
        const previousSummaryBlock = previousSummary
            ? `\n<previous_summary>\n${previousSummary}\n</previous_summary>\n`
            : '';

        return `<compaction-message>
${summaryPrompt}

Compaction constraints:
- ${boundaryLine}
- Keep the most recent ${activeMessagesCount} messages untouched (they remain in active context).
- Return plain summary text only; do NOT call tools.
- Preserve key decisions, file paths, unresolved tasks, and user constraints.
${previousSummaryBlock}
</compaction-message>`;
    }

    /**
     * 重组消息
     */
    private rebuildMessages(systemMessage: Message | undefined, summaryMessage: Message, active: Message[]): Message[] {
        const messages: Message[] = [];
        if (systemMessage) {
            messages.push(systemMessage);
        }
        messages.push(summaryMessage);
        messages.push(...active);
        return messages;
    }

    /**
     * 计算 Token 使用量
     */
    private calculateTokenCount(messages: Message[]): {
        totalUsed: number;
        estimatedTotal: number;
        hasReliableUsage: boolean;
    } {
        // 计算消息内容的 token
        const messagesEstimatedTotal = messages.reduce((acc, m) => {
            return acc + this.estimateTokens(JSON.stringify(m)) + 4;
        }, 0);

        // 计算 tools schema 的 token
        const toolsEstimatedTotal = this.calculateToolsTokenCount();

        // 总计：消息 + tools 定义
        const estimatedTotal = messagesEstimatedTotal + toolsEstimatedTotal;

        return {
            totalUsed: estimatedTotal,
            estimatedTotal,
            hasReliableUsage: false,
        };
    }

    /**
     * 计算 Tools Schema 的 Token 使用量
     */
    private calculateToolsTokenCount(): number {
        if (!this.getTools) {
            return 0;
        }

        const tools = this.getTools();
        if (!tools || tools.length === 0) {
            return 0;
        }

        // 序列化所有 tools schema 并估算 token
        const toolsText = JSON.stringify(tools);
        return this.estimateTokens(toolsText);
    }

    /**
     * 估算文本 Token 数
     *
     * 算法说明：
     * - 中文字符（Unicode \u4e00-\u9fa5）：1 字符 ≈ 1.5 token
     * - 其他字符（英文、数字、符号等）：1 字符 ≈ 0.25 token（1/4）
     *
     * 此估算基于常见 LLM（GPT、GLM 等）的 BPE 分词特点：
     * - 中文通常每个字为 1-2 个 token，平均约 1.5
     * - 英文单词平均为 0.5-1 个 token，按字符算是约 0.25
     */
    private estimateTokens(text: string): number {
        if (!text) return 0;

        let cnCount = 0;
        let otherCount = 0;

        for (const char of text) {
            // 判断是否为中文字符（CJK 统一表意文字范围）
            if (char >= '\u4e00' && char <= '\u9fa5') {
                cnCount++;
            } else {
                otherCount++;
            }
        }

        // 中文：1.5 token/字符，其他：0.25 token/字符
        const totalTokens = cnCount * 1.5 + otherCount * 0.25;
        return Math.ceil(totalTokens);
    }

    private createSummaryAbortSignal(): AbortSignal | undefined {
        const timeoutMs = this.normalizeTimeoutMs(this.llmProvider.getTimeTimeout());
        if (!timeoutMs) return undefined;

        try {
            return AbortSignal.timeout(timeoutMs);
        } catch {
            return undefined;
        }
    }

    private normalizeTimeoutMs(value: number | undefined): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return undefined;
        }
        return value;
    }

    /**
     * 内容转文本
     */
    private contentToText(content: Message['content']): string {
        if (!content) return '';

        if (typeof content === 'string') {
            return content;
        }

        // 额外检查：确保是数组类型
        if (!Array.isArray(content)) {
            return '';
        }

        return content
            .map((part) => this.stringifyContentPart(part))
            .filter(Boolean)
            .join('\n');
    }

    private stringifyContentPart(part: InputContentPart): string {
        switch (part.type) {
            case 'text':
                return part.text || '';
            case 'image_url':
                return `[image] ${part.image_url?.url || ''}`.trim();
            case 'file':
                return `[file] ${part.file?.filename || part.file?.file_id || ''}`.trim();
            case 'input_audio':
                return '[audio]';
            case 'input_video':
                return `[video] ${part.input_video?.url || part.input_video?.file_id || ''}`.trim();
            default:
                return '';
        }
    }
}
