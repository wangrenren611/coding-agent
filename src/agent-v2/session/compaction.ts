import { v4 as uuid } from "uuid";
import { Message } from "./types";
import { LLMProvider } from "../../providers";
import { IMemoryManager, CompactionRecord } from "../memory/types";

export interface CompactionConfig {
  /** 最大 Token 数 */
  maxTokens: number;
  /** 最大输出 Token 数 */
  maxOutputTokens: number;
  /** LLM Provider */
  llmProvider: LLMProvider;
  /** 保留消息数量（默认 40） */
  keepMessagesNum?: number;
  /** 触发压缩的阈值比例（默认 0.90） */
  triggerRatio?: number;
}

/** Token 统计信息 */
export interface TokenCountInfo {
  /** 基于消息内容估算的总 token 数 */
  estimatedTotal: number;
  /** 从消息 usage 字段累计的总 token 数（可能不准确，压缩后） */
  accumulatedTotal: number;
  /** 是否有可靠的 usage 数据 */
  hasReliableUsage: boolean;
}

/**
 * 上下文压缩器
 * 当 Token 使用量超过阈值时，压缩历史消息
 */
export class Compaction {
  private readonly maxTokens: number;
  private readonly maxOutputTokens: number;
  private readonly triggerRatio: number;
  private readonly keepMessagesNum: number;
  private llmProvider: LLMProvider;

  constructor(config: CompactionConfig) {
    this.maxTokens = config.maxTokens;
    this.maxOutputTokens = config.maxOutputTokens;
    this.llmProvider = config.llmProvider;
    this.keepMessagesNum = config.keepMessagesNum ?? 40;
    this.triggerRatio = config.triggerRatio ?? 0.90;
  }

  /**
   * 获取当前 Token 使用情况
   * 优先使用消息中的 usage 数据，如果没有则估算
   */
  getTokenInfo(messages: Message[]) {
    const totalUsed = this.calculateTotalUsage(messages);
    const usableLimit = this.maxTokens;

    return {
      totalUsed,
      usableLimit: usableLimit * this.triggerRatio,
      shouldCompact: totalUsed >= usableLimit * this.triggerRatio && messages.length > this.keepMessagesNum,
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

  /**
   * 获取当前上下文的实际 Token 使用量
   * 压缩后需要基于当前消息重新计算，而不是简单累加
   */
  getCurrentTokenCount(messages: Message[]): TokenCountInfo {
    // 方法1：累加 usage（压缩后可能不准确）
    let accumulatedTotal = 0;
    let hasUsageCount = 0;

    for (const msg of messages) {
      if (msg.usage?.total_tokens) {
        accumulatedTotal += msg.usage.total_tokens;
        hasUsageCount++;
      }
    }

    // 如果大部分消息都有 usage，认为数据可靠
    // 但如果有摘要消息，说明发生过压缩，数据不可靠
    const hasSummary = messages.some((m) => m.type === "summary");
    const hasReliableUsage = hasUsageCount > messages.length * 0.5 && !hasSummary;

    // 方法2：基于内容估算（始终可用）
    const estimatedTotal = this.estimateMessagesTokens(messages);

    return {
      estimatedTotal,
      accumulatedTotal,
      hasReliableUsage,
    };
  }

  /**
   * 估算消息列表的 token 数
   */
  private estimateMessagesTokens(messages: Message[]): number {
    return messages.reduce((acc, m) => {
      // 每条消息基础开销 4 tokens (role, name, newline)
      return acc + this.estimateTokens(JSON.stringify(m)) + 4;
    }, 0);
  }

  /**
   * 执行压缩
   * @param messages 当前消息列表
   * @param sessionId 会话 ID
   * @param memoryManager MemoryManager 实例（可选，用于持久化压缩记录）
   * @returns 压缩结果
   */
  async compact(
    messages: Message[],
    sessionId?: string,
    memoryManager?: IMemoryManager
  ): Promise<{
    isCompacted: boolean;
    summaryMessage: Message | null;
    messages: Message[];
    record?: CompactionRecord;
  }> {
    const totalUsed = this.calculateTotalUsage(messages);
    const usableLimit = this.maxTokens - this.maxOutputTokens;
    const threshold = usableLimit * this.triggerRatio;

    // 过滤系统消息用于压缩计算
    const nonSystemMessages = messages.filter((msg) => msg.role !== "system");

    // 只有当消息数量超过保留数量且 token 达到阈值时，才触发压缩
    const shouldCompact = nonSystemMessages.length > this.keepMessagesNum && totalUsed >= threshold;

    // 如果没达到压缩条件，直接返回原数据
    if (!shouldCompact) {
      return {
        isCompacted: false,
        summaryMessage: null,
        messages,
      };
    }

    console.log(`[Compaction] 触发压缩。当前 Token: ${totalUsed}, 阈值: ${Math.floor(threshold)}`);

    // 分离保护区（最近 N 条）和待压缩区
    const systemMessage = messages.find((msg) => msg.role === "system");
    const activeMessages = nonSystemMessages.slice(-this.keepMessagesNum);
    let pendingMessages = nonSystemMessages.slice(0, -this.keepMessagesNum);

    // 处理工具调用配对
    const processedMessages = this.processToolCallPairs(pendingMessages, activeMessages);
    pendingMessages = processedMessages.pending;
    const finalActiveMessages = processedMessages.active;

    // 提取之前的摘要（如果存在）
    let previousSummary = "";
    if (pendingMessages.length > 0 && pendingMessages[0].type === "summary") {
      previousSummary = pendingMessages[0].content;
      pendingMessages = pendingMessages.slice(1);
    }

    // 生成新摘要
    const summaryContent = await this.summarizer(
      this.serializeMessages(pendingMessages),
      previousSummary
    );

    const summaryMessage: Message = {
      messageId: uuid(),
      role: "assistant",
      type: "summary",
      content: summaryContent,
    };

    // 重组消息：系统消息 + 摘要 + 保护区
    const newMessages: Message[] = [];
    if (systemMessage) {
      newMessages.push(systemMessage);
    }
    newMessages.push(summaryMessage);
    newMessages.push(...finalActiveMessages);

    // 如果有 MemoryManager，创建压缩记录
    let record: CompactionRecord | undefined;
    if (memoryManager && sessionId) {
      record = await memoryManager.compactContext(sessionId, {
        keepLastN: this.keepMessagesNum,
        summaryMessage,
        reason: "token_limit",
        tokenCountBefore: totalUsed,
        tokenCountAfter: this.calculateTotalUsage(newMessages),
      });
    }

    console.log(`[Compaction] 压缩完成。消息数: ${messages.length} -> ${newMessages.length}`);

    return {
      isCompacted: true,
      summaryMessage,
      messages: newMessages,
      record,
    };
  }

  /**
   * 处理工具调用配对
   * 确保保护区的 tool 消息有对应的 assistant 消息
   */
  private processToolCallPairs(
    pendingMessages: Message[],
    activeMessages: Message[]
  ): { pending: Message[]; active: Message[] } {
    // 构建工具调用映射
    const toolCallMap = new Map<string, Message>();

    for (const msg of [...pendingMessages, ...activeMessages]) {
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const calls = msg.tool_calls;
        for (const call of calls) {
          if (call && typeof call.id === "string") {
            toolCallMap.set(call.id, msg);
          }
        }
      }
    }

    // 找出保护区中需要配对的 tool 消息
    const toolsNeedingPair = activeMessages.filter(
      (msg) => {
        if (msg.role !== "tool") return false;
        const toolCallId = (msg as { tool_call_id?: string }).tool_call_id;
        return typeof toolCallId === "string" && toolCallMap.has(toolCallId);
      }
    );

    if (toolsNeedingPair.length === 0) {
      return { pending: pendingMessages, active: activeMessages };
    }

    // 收集需要移动的 assistant 消息
    const assistantsToMove = new Map<string, Message>();
    const toolCallIdsToMove = new Set<string>();

    for (const toolMsg of toolsNeedingPair) {
      const toolMsgCast = toolMsg as { tool_call_id?: string };
      const toolCallId: string | undefined = toolMsgCast.tool_call_id;
      if (typeof toolCallId !== "string") continue;
      const assistantMsg = toolCallMap.get(toolCallId);
      if (assistantMsg) {
        assistantsToMove.set(assistantMsg.messageId, assistantMsg);
        toolCallIdsToMove.add(toolCallId);
      }
    }

    // 从 pending 中移除这些消息
    const newPending = pendingMessages.filter((msg) => {
      if (assistantsToMove.has(msg.messageId)) return false;
      const msgToolCallId = (msg as { tool_call_id?: string }).tool_call_id;
      if (msg.role === "tool" && typeof msgToolCallId === "string" && toolCallIdsToMove.has(msgToolCallId))
        return false;
      return true;
    });

    // 将 assistant 和 tool 按顺序添加到保护区前面
    const newActive: Message[] = [];
    const assistantList = Array.from(assistantsToMove.values());
    for (const assistantMsg of assistantList) {
      newActive.push(assistantMsg);
      // 添加对应的 tool 消息
      const toolCalls = Array.isArray(assistantMsg.tool_calls) ? assistantMsg.tool_calls : [];
      for (const call of toolCalls) {
        if (call && typeof call.id === "string") {
          const toolMsg = activeMessages.find(
            (m) => {
              const mToolCallId = (m as { tool_call_id?: string }).tool_call_id;
              return m.role === "tool" && mToolCallId === call.id;
            }
          );
          if (toolMsg) {
            newActive.push(toolMsg);
          }
        }
      }
    }

    // 添加剩余的保护区消息
    for (const msg of activeMessages) {
      if (!assistantsToMove.has(msg.messageId)) {
        // 检查是否是需要配对的 tool 消息
        const msgToolCallId = (msg as { tool_call_id?: string }).tool_call_id;
        if (msg.role === "tool" && typeof msgToolCallId === "string" && toolCallIdsToMove.has(msgToolCallId)) {
          continue; // 已添加
        }
        newActive.push(msg);
      }
    }

    return { pending: newPending, active: newActive };
  }

  /**
   * 将消息序列化为文本用于摘要
   */
  private serializeMessages(messages: Message[]): string {
    return messages
      .map((m) => {
        const prefix = m.type ? `[${m.role}:${m.type}]` : `[${m.role}]`;
        const content =
          m.content.length > 2000 ? m.content.slice(0, 1000) + "...(省略)..." : m.content;
        return `${prefix}: ${content}`;
      })
      .join("\n");
  }

  /**
   * 生成摘要
   */
  private async summarizer(textToSummarize: string, previousSummary?: string): Promise<string> {
    console.log("[Compaction] 正在生成摘要...");

    const response = await this.llmProvider.generate(
      [
        {
          role: "user",
          content: `You are an expert conversation compressor. Compress conversation history into a structured summary organized in following 8 sections:
1. **Primary Request and Intent**: What is user's core goal?
2. **Key Technical Concepts**: Frameworks, libraries, tech stacks, etc., involved in the conversation.
3. **Files and Code Sections**: All file paths mentioned or modified.
4. **Errors and Fixes**: Record error messages encountered and their solutions.
5. **Problem Solving**: The thought process and decision path for solving the problem.
6. **All User Messages**: Preserve key instructions and feedback from user.
7. **Pending Tasks**: Work items that remain unfinished.
8. **Current Work**: The progress at the point conversation was interrupted.

${previousSummary ? `<previous_summary>\n${previousSummary}\n</previous_summary>\n` : ""}

<current_message_history>\n${textToSummarize}\n</current_message_history>

## Requirements:
- Maintain high density and accuracy of information
- Highlight key technical decisions and solutions
- Ensure continuity of context
- Retain all important file paths
- Use concise English expression
`,
        },
      ],
      {
        temperature: 0.3,
      }
    );

    console.log("[Compaction] 摘要生成完成");

    // 处理流式或非流式响应
    if (response && typeof response === 'object' && 'content' in response) {
      return (response as { content?: string }).content || "";
    }

    return "";
  }

  /**
   * 计算整个对话数组的 Token 用量
   * 压缩后基于内容重新估算，而不是累加可能不准确的 usage
   */
  public calculateTotalUsage(messages: Message[]): number {
    const { estimatedTotal, hasReliableUsage, accumulatedTotal } = this.getCurrentTokenCount(messages);

    // 如果有可靠的 usage 数据（未压缩），使用它
    if (hasReliableUsage && accumulatedTotal > 0) {
      return accumulatedTotal;
    }

    // 否则使用估算值（压缩后更准确）
    return estimatedTotal;
  }

  /**
   * 估算单段文本的 Token
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;
    // 简化估算：大约 4 个字符 = 1 个 token
    return Math.ceil(text.length / 4);
  }
}
