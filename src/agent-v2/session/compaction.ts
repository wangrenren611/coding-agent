import { uuid } from "uuidv4";
import { Message } from "./types";
import { LLMProvider } from "../../providers";

export class Compaction {
  private readonly maxTokens: number;
  private readonly maxOutputTokens: number;
  private readonly triggerRatio = 0.90; // 92% 触发压缩
  private keepMessagesNum: number = 40;


  constructor(config: { llmProvider: LLMProvider; keepMessagesNum?: number }) {
    this.maxTokens = config.llmProvider.getLLMMaxTokens();
    this.maxOutputTokens = config.llmProvider.getMaxOutputTokens();
    this.logger = (...args: any[]) => console.log("[Compaction]",...args);
    this.llmProvider = config.llmProvider;
    this.keepMessagesNum = config.keepMessagesNum || this.keepMessagesNum;
  }

  getToken(history: Message[],tools:any[]) {
    const totalUsed = this.calculateTotalUsage(history,tools);
    const usableLimit = this.maxTokens;
  
    return {
      totalUsed,
      usableLimit: usableLimit * this.triggerRatio
    };
  }

  /**
   * 性能优化：构建 tool_call_id 到 assistant 索引的映射表
   * 时间复杂度：O(n)，其中 n 是 history 的长度
   * @returns Map<tool_call_id, assistant_index>
   */
  private buildToolCallToAssistantIndex(messages: Message[]): Map<string, number> {
    const index = new Map<string, number>();

    // 遍历所有消息，记录每个 tool_call_id 对应的 assistant 索引
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const call of msg.tool_calls) {
          if (call.id) {
            index.set(call.id, i);
          }
        }
      }
    }

    return index;
  }

  /**
   * 性能优化：构建消息列表中 tool 消息的索引映射
   * 时间复杂度：O(m)，其中 m 是 messages 的长度
   * @returns Map<tool_call_id, message>
   */
  private buildToolMessageMap(messages: Message[]): Map<string, Message> {
    const map = new Map<string, Message>();

    for (const msg of messages) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        map.set(msg.tool_call_id, msg);
      }
    }

    return map;
  }

  async compact(history: Message[],tools:any[]): Promise<{
    isCompacted: boolean,
    summaryMessage: Message | null,
    list: Message[]
  }> {
    const totalUsed = this.calculateTotalUsage(history,tools);
    const usableLimit = this.maxTokens - this.maxOutputTokens;
    const threshold = usableLimit * this.triggerRatio;

    // 只有当消息数量超过保留数量且 token 达到阈值时，才触发压缩
    const shouldCompact = history.length > this.keepMessagesNum && totalUsed >= threshold;
     history = history.filter(msg => msg.role !== 'system');
    // 如果没达到压缩条件，直接返回原数据
    if (!shouldCompact) {
      return {
        isCompacted: false,
        summaryMessage: null,
        list: history
      };
    }

    this.logger.info(
      `[Compaction] 触发压缩。当前 Token: ${totalUsed}, 阈值: ${Math.floor(threshold)}`
    );

    let activeMessages = history.slice(-this.keepMessagesNum); // 保护区
    let pendingMessages = history.slice(0, -this.keepMessagesNum); // 待压缩区

    // 限制保护区的最大膨胀倍数（防止从 6 条膨胀到 100+ 条）
    const MAX_ACTIVE_SIZE = this.keepMessagesNum * 2;

    // 检查保护区的所有 tool 消息，确保它们的配对 assistant 以及所有相关的 tool 回复都被保留
    // 需要处理多个 assistant 的情况（连续多次工具调用）

    // 性能优化：一次性构建所有索引，避免 O(n²) 的多次查找
    // 时间复杂度：O(n + m + k)，其中 n=history长度，m=pending长度，k=active长度
    const toolCallToAssistantIndex = this.buildToolCallToAssistantIndex(history);
    const pendingToolMap = this.buildToolMessageMap(pendingMessages);
    const activeToolMap = this.buildToolMessageMap(activeMessages);

    const toolMessagesInActive = activeMessages.filter(m =>
      m.role === 'tool' && m.tool_call_id  // 过滤掉无效的 tool_call_id
    );

    if (toolMessagesInActive.length > 0) {
      // 收集所有需要保留的 assistant 消息和需要重新排序的 tool 回复
      // 修复：将 tool 回复与对应的 assistant 分组，确保消息顺序正确
      const assistantsToKeep: Map<string, { message: Message; index: number; tools: Message[] }> = new Map();
      // 跟踪从 pendingMessages 移到 toolsToKeep 的 tool_call_id
      const movedToolCallIds = new Set<string>();

      // 计算分割点，用于判断 assistant 在哪个区域
      // history[:splitPoint] = pendingMessages
      // history[splitPoint:] = activeMessages
      const splitPoint = history.length - this.keepMessagesNum;

      // 修复：识别唯一需要处理的 assistant 索引
      // 这确保我们只处理每个 assistant 一次，但会收集该 assistant 的所有 tools
      const uniqueAssistantIndices = new Set<number>();
      for (const toolMessage of toolMessagesInActive) {
        const toolCallId = toolMessage.tool_call_id;
        if (!toolCallId) continue;
        const assistantIndex = toolCallToAssistantIndex.get(toolCallId);
        if (assistantIndex !== undefined) {
          uniqueAssistantIndices.add(assistantIndex);
        }
      }

      // 为每个唯一的 assistant 处理一次，收集其所有 tools
      for (const assistantIndex of uniqueAssistantIndices) {
        // 从 history 中获取 assistant 消息
        const assistantMessage = history[assistantIndex];
        if (!assistantMessage || !assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          continue;
        }

        const assistantKey = assistantIndex.toString();
        const toolCalls = assistantMessage.tool_calls?.filter(call => call.id) || [];

        // 收集该 assistant 的所有 tools（从两个区域按 tool_calls 顺序收集）
        const allTools: Message[] = [];
        for (const toolCall of toolCalls) {
          // 先检查 active 区域，再检查 pending 区域
          let toolMessage = activeToolMap.get(toolCall.id);
          if (!toolMessage) {
            toolMessage = pendingToolMap.get(toolCall.id);
            if (toolMessage) {
              movedToolCallIds.add(toolCall.id); // 跟踪从 pending 移动的 tool
            }
          }
          if (toolMessage) {
            allTools.push(toolMessage);
          }
        }

        const toolCallIds = toolCalls.map(c => c.id);

        // 无论 assistant 在哪个区域，都从 activeMessages 中移除它的 tools（稍后会重新添加）
        // 这避免 tools 在 activeMessages 中被重复计算
        activeMessages = activeMessages.filter(m => {
          // 如果 assistant 在 active 区域，也要移除它
          if (assistantIndex >= splitPoint && m === assistantMessage) return false;
          // 移除这些 tool 回复（无论 assistant 在哪，都要移除 active 中的 tools）
          if (m.role === 'tool' && toolCallIds.includes(m.tool_call_id || '')) return false;
          return true;
        });

        // 记录这个 assistant 需要保留，以及它的所有 tools
        assistantsToKeep.set(assistantKey, {
          message: assistantMessage,
          index: assistantIndex,
          tools: allTools,
        });

        this.logger.info(
          `[Compaction] 处理 assistant（索引 ${assistantIndex}）：` +
          `${toolCalls.length} 个 tool_calls，收集到 ${allTools.length} 个 tool 回复`
        );
      }

      // 将需要保留的 assistant 和 tool 回复按正确顺序加入保护区
      if (assistantsToKeep.size > 0) {
        // 按索引排序 assistants（保持原始顺序）
        const sortedAssistantsWithTools = Array.from(assistantsToKeep.values())
          .sort((a, b) => a.index - b.index);

        // 从 pendingMessages 中移除这些 assistants（如果它们在 pendingMessages 中）
        // 同时移除已移动的 tool 消息
        // 修复：使用 splitPoint 而不是 pendingMessages.length
        // item.index 是原 history 数组的索引，需要与 splitPoint 比较
        const indicesToRemove = Array.from(assistantsToKeep.values())
          .filter(item => item.index < splitPoint)
          .map(item => item.index);

        if (indicesToRemove.length > 0 || movedToolCallIds.size > 0) {
          pendingMessages = pendingMessages.filter((msg, i) => {
            // 移除 assistant 消息
            if (indicesToRemove.includes(i)) return false;
            // 移除已移动的 tool 消息
            if (msg.role === 'tool' && msg.tool_call_id && movedToolCallIds.has(msg.tool_call_id)) return false;
            return true;
          });
        }

        // 构建新的 activeMessages，将每个 assistant 与它的 tools 交错排列
        // 正确的结构应该是：Assistant1, Tool1, Tool2, Assistant2, Tool3, Tool4, ...
        const newActiveMessages: Message[] = [];

        for (const { message: assistantMsg, tools: assistantTools } of sortedAssistantsWithTools) {
          newActiveMessages.push(assistantMsg);
          newActiveMessages.push(...assistantTools);
        }

        // 添加剩余的 activeMessages
        newActiveMessages.push(...activeMessages);

        // 检查是否超过最大限制
        if (newActiveMessages.length > MAX_ACTIVE_SIZE) {
          this.logger.warn(
            `[Compaction] 保护区膨胀：从 ${this.keepMessagesNum} 条增长到 ${newActiveMessages.length} 条` +
            `(超过最大限制 ${MAX_ACTIVE_SIZE})，将进行裁剪`
          );

          // 计算 assistants 和 tools 的总消息数
          const totalAssistantsAndTools = sortedAssistantsWithTools.reduce(
            (sum, item) => sum + 1 + item.tools.length, 0);

          // 裁剪：保留前面的 assistants 和 tools，裁剪后面的原始 activeMessages
          const overflow = newActiveMessages.length - MAX_ACTIVE_SIZE;
          if (overflow > 0 && totalAssistantsAndTools < MAX_ACTIVE_SIZE) {
            // 可以安全地裁剪后面的消息
            newActiveMessages.length = MAX_ACTIVE_SIZE;
          }
        }

        activeMessages = newActiveMessages;

        // 计算统计信息
        const totalAssistants = sortedAssistantsWithTools.length;
        const totalTools = sortedAssistantsWithTools.reduce((sum, item) => sum + item.tools.length, 0);

        this.logger.info(
          `[Compaction] 已将 ${totalAssistants} 个 assistant 和 ${totalTools} 个 tool 回复移到保护区` +
          `（保护区大小：${activeMessages.length}）`
        );
      }
    }

    // 3. 提取之前的摘要（如果存在）
    let previousSummary= "";
    if (pendingMessages.length > 0 && pendingMessages[0].type === "summary") {
      previousSummary = pendingMessages[0].content as string;
      pendingMessages = pendingMessages.slice(1);
    }

    // 4. 将待压缩的消息序列化为文本
    // 特别处理：将 tool 消息与其 result 格式化，方便 LLM 理解
    const textToSummarize = pendingMessages
      .map((m) => {
        const prefix = m.type ? `[${m.role}:${m.type}]` : `[${m.role}]`;
        // 如果内容过长（如巨大的代码输出），在摘要前进行初步截断
        const content =
          m.content.length > 2000
            ? m.content.slice(0, 1000) + "...(省略)..."
            : m.content;
        return `${prefix}: ${content}`;
      })
      .join("\n");

    // 5. 执行异步摘要
    const newSummaryContent = await this.summarizer(
      textToSummarize,
      previousSummary,
    );

    const summaryMessage: Message = {
      messageId: uuid(),
      role: "assistant",
      type: "summary",
      content: `${newSummaryContent}`,
    };

    // 6. 重组历史
    const newHistory = [summaryMessage, ...activeMessages, {
      messageId: uuid(),
      role: "user" as const,
      type: "text" as const,
      content: "Confirm task completion. If the task is not finished, define next actions and continue execution until all user requirements are satisfied.",
    }];

    return {
      isCompacted: true,
      summaryMessage,
      list: newHistory
    };

  }

  /**
   * 计算整个对话数组的 Token 用量
   */
  public calculateTotalUsage(messages: Message[], tools?: any[]): number {
    const allMessages = [...messages];
    if (tools && Array.isArray(tools)) {
      allMessages.push(...tools);
    }
    return allMessages.reduce((acc, m) => {
      // 每条消息基础开销 4 tokens (role, name, newline)
      return acc + this.estimate(JSON.stringify(m)) + 4;
    }, 0);
  }

  /**
   * 估算单段文本的 Token
   */
  private estimate(text: string): number {
    if (!text) return 0;
    return Math.ceil(
      text.length / 4,
    );
  }

  async summarizer(textToSummarize: string, previousSummary?: string) {


    const spinner = this.logger.spinner("上下文压缩...");

    const llmResponse = await this.llmProvider.generate(
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

${previousSummary ? `<previous_summary>
  ${previousSummary}
</previous_summary>
` : ''}

<current_mesage_history>
${textToSummarize}
</current_mesage_history>

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
        maxOutputTokens: 8000,
        temperature: 0.3,
      },
    );
    spinner.succeed("上下文压缩成功");
    return llmResponse?.content || '';

  }
}
