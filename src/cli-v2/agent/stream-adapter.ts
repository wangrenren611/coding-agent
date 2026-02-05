// ==================== 导入类型定义 ====================
// 从 Agent 模块导入所有流式消息类型
// 这些类型定义了 Agent 向 CLI 发送的所有消息格式
import type {
  AgentMessage,           // 联合类型：所有 Agent 消息的统称
  CodePatchMessage,        // 代码补丁消息：包含 diff 内容
  ErrorMessage,            // 错误消息：系统级异常
  StatusMessage,           // 状态消息：任务状态切换
  TextMessage,             // 文本完成消息：文本传输结束
  TextStartMessage,        // 文本开始消息：开始新的文本流
  ThoughtMessage,          // 思考/文本增量消息：流式传输的文本片段
  ToolCallCreatedMessage,  // 工具调用创建消息：准备调用工具
  ToolCallResultMessage,   // 工具调用结果消息：工具执行完成
  ToolCallStreamMessage,   // 工具调用流式输出消息：工具执行中的实时输出
} from '../../agent-v2/agent/stream-types';

// 从 CLI 状态模块导入类型
// 这些类型定义了 CLI UI 层面的消息和事件结构
import type { ToolInvocation, UIEvent } from '../state/types';

// ==================== 流式状态接口 ====================
/**
 * StreamingState - 流式处理器的内部状态
 *
 * 作用：维护当前流式传输过程中的所有状态信息
 * 为什么需要：流式传输是分批到达的，需要累积和管理这些片段
 * 使用场景：处理 Agent 发送的流式文本和工具调用时维护上下文
 */
interface StreamingState {
  // 当前正在处理的消息 ID（来自 Agent 的 msgId）
  // 作用：标识当前流式传输属于哪一条消息
  // 为什么需要：多条消息可能同时或交错到达，需要区分
  messageId: string | null;

  // 文本缓冲区：暂存尚未发送到 UI 的文本片段
  // 作用：累积小片段，减少 UI 更新频率，提升性能
  // 为什么需要：如果每个字符都触发 UI 更新，会非常卡顿
  buffer: string;

  // 完整内容：当前消息的所有文本内容（已累积）
  // 作用：记录完整的消息内容，用于最终完成时发送
  // 为什么需要：text-complete 时需要发送完整内容
  fullContent: string;

  // 是否已经开始：标记当前消息是否已启动
  // 作用：判断是否需要发送 text-start 事件
  // 为什么需要：有些流可能直接从 delta 开始，需要自动补 start
  hasStarted: boolean;

  // 工具调用映射：按 callId 存储正在执行的工具调用
  // 作用：跟踪所有活跃的工具调用状态
  // 为什么需要：工具调用是异步的，需要维护其生命周期（开始→流→结果）
  toolCalls: Map<string, ToolInvocation>;

  // 代码补丁映射：按文件路径存储代码补丁
  // 作用：存储所有生成的代码补丁，用于后续展示
  // 为什么需要：代码补丁可能需要在多个地方引用
  codePatches: Map<string, { path: string; diff: string; language?: string; timestamp: number }>;
}

// ==================== 创建空状态工厂函数 ====================
/**
 * createEmptyState - 创建一个空的流式状态对象
 *
 * 作用：初始化状态时使用，确保所有字段都有默认值
 * 为什么这么做：工厂函数保证每次创建的状态都是一致的初始状态
 * 获得结果：返回一个重置后的 StreamingState 对象
 */
const createEmptyState = (): StreamingState => ({
  messageId: null,      // 初始没有正在处理的消息
  buffer: '',           // 缓冲区为空
  fullContent: '',      // 完整内容为空
  hasStarted: false,    // 尚未开始
  toolCalls: new Map(), // 空的工具调用映射
  codePatches: new Map(), // 空的代码补丁映射
});

// ==================== 工具参数解析函数 ====================
/**
 * parseToolArgs - 解析工具调用的参数
 *
 * 作用：将工具参数从可能的 JSON 字符串转换为对象
 * 为什么需要：LLM 返回的工具参数可能是 JSON 字符串或对象，需要统一处理
 * 获得结果：返回解析后的参数对象，失败时返回包含原始值的对象
 *
 * @param args - 工具参数，可能是字符串（JSON）或对象
 * @returns 解析后的参数对象
 */
const parseToolArgs = (args: unknown): Record<string, unknown> => {
  // 如果参数是字符串，尝试解析为 JSON
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
      // 如果解析成功且结果是对象，则返回
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // JSON 解析失败，返回包含原始字符串的对象
      // 为什么捕获异常而不是抛出：保证函数总能返回有效结果，不中断流程
      return { raw: args };
    }
  }

  // 如果参数已经是对象，直接返回
  if (args && typeof args === 'object') {
    return args as Record<string, unknown>;
  }

  // 其他情况（如 null、undefined、数字等），包装为对象
  return { raw: args };
};

// ==================== 流式适配器类 ====================
/**
 * StreamAdapter - 流式适配器类
 *
 * 核心作用：将 Agent 发送的底层消息（AgentMessage）转换为 UI 可用的事件（UIEvent）
 * 为什么存在：
 *  1. Agent 层和 UI 层的数据格式不同，需要转换
 *  2. 流式数据需要缓冲和批处理，优化性能
 *  3. 需要维护消息状态（开始→增量→完成）
 *
 * 工作流程：
 *  1. 接收 Agent 发送的 AgentMessage
 *  2. 根据消息类型分发到不同的处理函数
 *  3. 处理函数更新内部状态，必要时发送 UIEvent
 *  4. 最终触发 UI 更新
 *
 * 支持的消息类型：
 *  - 文本流：text-start, text-delta, text-complete
 *  - 工具流：tool_call_created, tool_call_stream, tool_call_result
 *  - 其他：code_patch, status, error
 */
export class StreamAdapter {
  // 内部状态：当前流式传输的状态
  private state: StreamingState = createEmptyState();

  /**
   * 最后一条文本消息的 msgId
   *
   * 作用：将后续的工具事件绑定到这条消息上
   * 为什么需要：有些工具调用可能发生在文本消息之后，需要关联显示
   * 使用场景：工具调用流消息（ToolCallStreamMessage）可能不包含 msgId，
   *          此时使用 lastTextMsgId 将工具事件归属到最近的文本消息
   */
  private lastTextMsgId: string | null = null;

  /**
   * 刷新定时器
   *
   * 作用：控制文本缓冲区的刷新频率
   * 为什么需要：批量发送文本更新，避免高频更新导致 UI 卡顿
   * 实现机制：使用 setTimeout 延迟刷新，期间新内容会累积到 buffer
   */
  private flushTimer: NodeJS.Timeout | null = null;

  /**
   * 构造函数
   *
   * @param emit - UI 事件发射函数，将 UIEvent 发送到 UI 层
   * @param flushIntervalMs - 刷新间隔，默认 33ms（约 30fps），平衡流畅度和性能
   */
  constructor(
    private readonly emit: (event: UIEvent) => void,
    private readonly flushIntervalMs = 33
  ) {}

  /**
   * reset - 重置适配器状态
   *
   * 作用：清除所有内部状态，准备处理新的会话
   * 为什么需要：每次新的对话开始时，需要清空之前的状态，避免混淆
   * 获得结果：state、lastTextMsgId、定时器都被重置
   */
  reset(): void {
    this.state = createEmptyState();      // 重置流式状态
    this.lastTextMsgId = null;            // 清空最后文本消息 ID
    this.clearFlushTimer();                // 清除刷新定时器
  }

  /**
   * dispose - 销毁适配器
   *
   * 作用：清理资源，防止内存泄漏
   * 为什么需要：当不再使用适配器时，确保所有定时器都被清除
   * 获得结果：调用 reset 清理所有状态
   */
  dispose(): void {
    this.reset();
  }

  /**
   * handleAgentMessage - 处理 Agent 消息的入口函数
   *
   * 作用：接收 Agent 发送的任何消息，根据类型分发到对应处理函数
   * 为什么使用 switch：清晰地区分不同消息类型，易于扩展
   * 获得结果：消息被正确处理，UI 事件被触发
   *
   * @param message - Agent 发送的消息（联合类型）
   */
  handleAgentMessage(message: AgentMessage): void {
    const messageType = message.type;

    // 根据 message.type 分发到不同的处理函数
    switch (messageType) {
      // 文本开始：新的文本流开始
      case 'text-start':
        this.handleTextStart(message as TextStartMessage);
        break;

      // 文本增量：接收到文本片段（流式传输的核心）
      case 'text-delta':
        this.handleTextDelta(message as ThoughtMessage);
        break;

      // 文本完成：文本流结束
      case 'text-complete':
        this.handleTextComplete(message as TextMessage);
        break;

      // 工具调用创建：Agent 决定调用工具
      case 'tool_call_created':
        this.handleToolCallCreated(message as ToolCallCreatedMessage);
        break;

      // 工具流式输出：工具执行中的实时输出
      case 'tool_call_stream':
        this.handleToolCallStream(message as ToolCallStreamMessage);
        break;

      // 工具调用结果：工具执行完成
      case 'tool_call_result':
        this.handleToolCallResult(message as ToolCallResultMessage);
        break;

      // 代码补丁：生成了代码变更
      case 'code_patch':
        this.handleCodePatch(message as CodePatchMessage);
        break;

      // 状态更新：任务状态变化
      case 'status':
        this.handleStatus(message as StatusMessage);
        break;

      // 错误：系统级异常
      case 'error':
        this.handleError(message as ErrorMessage);
        break;

      default:
        // 忽略未知消息类型（向后兼容）
        break;
    }
  }

  // ==================== 文本流处理 ====================

  /**
   * handleTextStart - 处理文本开始消息
   *
   * 作用：开始一条新的文本流，通知 UI 创建新的消息
   * 为什么需要：UI 需要知道何时开始显示新消息，以及消息的 ID
   * 获得结果：发送 text-start 事件，更新内部状态
   *
   * @param message - 文本开始消息
   */
  private handleTextStart(message: TextStartMessage): void {
    const { msgId, timestamp } = message;

    // 如果已经在处理其他消息，先完成它
    // 为什么：防止消息混淆，确保每条消息独立处理
    if (this.state.messageId && this.state.messageId !== msgId) {
      this.flushAndCompleteCurrent();
    }

    // 更新内部状态
    this.state.messageId = msgId;        // 记录当前消息 ID
    this.lastTextMsgId = msgId;          // 更新最后文本消息 ID
    this.state.buffer = '';              // 清空缓冲区
    this.state.fullContent = '';         // 清空完整内容
    this.state.hasStarted = true;        // 标记已开始

    // 发送 text-start 事件到 UI
    this.emit({
      type: 'text-start',
      messageId: msgId,
      timestamp,
    });
  }

  /**
   * handleTextDelta - 处理文本增量消息（流式传输的核心）
   *
   * 作用：接收到文本片段，累积到缓冲区，定时刷新到 UI
   * 为什么需要：
   *  1. 流式数据是分批到达的，需要累积
   *  2. 频繁更新 UI 会卡顿，需要批处理
   * 获得结果：文本被缓冲，定时触发 UI 更新
   *
   * @param message - 文本增量消息
   */
  private handleTextDelta(message: ThoughtMessage): void {
    const { msgId, payload, timestamp } = message;
    const content = payload.content || '';

    // 如果是新消息，先处理 start
    // 为什么：有些流可能没有发送 text-start，直接从 delta 开始
    if (this.state.messageId !== msgId) {
      this.handleTextStart({
        ...message,
        type: 'text-start',
        timestamp: timestamp ?? Date.now(),
      } as TextStartMessage);
    }

    // 如果有内容，累积到缓冲区
    if (content) {
      this.state.buffer += content;        // 累积到缓冲区（用于刷新）
      this.state.fullContent += content;   // 累积到完整内容（用于完成时）
      this.scheduleFlush(msgId);           // 安排定时刷新
    }
  }

  /**
   * handleTextComplete - 处理文本完成消息
   *
   * 作用：文本流结束，刷新剩余缓冲区，发送完成事件
   * 为什么需要：UI 需要知道消息已完成，可以结束流式显示
   * 获得结果：发送 text-complete 事件，重置状态
   *
   * @param message - 文本完成消息
   */
  private handleTextComplete(message: TextMessage): void {
    const { msgId, payload, timestamp } = message;
    const content = payload.content || '';

    // 确保有一个打开的消息可以完成
    if (this.state.messageId !== msgId) {
      this.handleTextStart({
        type: 'text-start',
        msgId,
        timestamp: timestamp ?? Date.now(),
        payload: { content: '' },
      } as TextStartMessage);
    }

    // 完成前先刷新所有剩余的缓冲内容
    this.flushNow();

    // 确定最终内容（优先使用消息中的内容，否则使用累积的完整内容）
    const finalContent = content || this.state.fullContent;

    // 发送 text-complete 事件到 UI
    this.emit({
      type: 'text-complete',
      messageId: msgId,
      content: finalContent,
    });

    // 重置状态，准备下一条消息
    this.state.messageId = null;
    this.lastTextMsgId = msgId;
    this.state.buffer = '';
    this.state.fullContent = '';
    this.state.hasStarted = false;
    this.clearFlushTimer();
  }

  // ==================== 工具调用处理 ====================

  /**
   * handleToolCallCreated - 处理工具调用创建消息
   *
   * 作用：Agent 决定调用工具，通知 UI 显示工具调用开始
   * 为什么需要：UI 需要显示"正在执行工具 xxx"，让用户知道进度
   * 获得结果：发送 tool-start 事件，创建工具调用记录
   *
   * @param message - 工具调用创建消息
   */
  private handleToolCallCreated(message: ToolCallCreatedMessage): void {
    const { msgId, payload, timestamp } = message;

    // 刷新任何挂起的文本内容
    // 为什么：工具调用应该独立显示，不应与文本混合
    if (this.state.messageId) {
      this.flushNow();
    }

    // 遍历所有工具调用（一次可能调用多个工具）
    for (const toolCall of payload.tool_calls) {
      // 解析工具参数（可能是 JSON 字符串）
      const parsedArgs = parseToolArgs(toolCall.args);

      // 创建工具调用记录
      const invocation: ToolInvocation = {
        id: toolCall.callId,          // 工具调用唯一 ID
        name: toolCall.toolName,      // 工具名称
        args: parsedArgs,             // 解析后的参数
        status: 'running',            // 状态设为运行中
        startedAt: timestamp,         // 记录开始时间
      };

      // 存储到内部状态
      this.state.toolCalls.set(toolCall.callId, invocation);

      // 发送 tool-start 事件到 UI
      this.emit({
        type: 'tool-start',
        messageId: msgId,
        toolCallId: toolCall.callId,
        toolName: toolCall.toolName,
        args: parsedArgs,
        timestamp,
        // 透传正文，便于 UI 在缺失文本事件时回填
        // 为什么：非流式路径可能没有单独的文本事件，需要在这里传递
        content: payload.content,
      });
    }
  }

  /**
   * handleToolCallStream - 处理工具流式输出消息
   *
   * 作用：工具执行过程中的实时输出（如终端日志），实时显示给用户
   * 为什么需要：让用户看到工具执行的实时进度，提升交互体验
   * 获得结果：发送 tool-stream 事件
   *
   * @param message - 工具流式输出消息
   */
  private handleToolCallStream(message: ToolCallStreamMessage): void {
    const { payload, timestamp } = message;
    const { callId, output } = payload;

    // 确定消息 ID（绑定到已知文本消息）
    // 为什么：工具流消息可能不包含 msgId，需要关联到最近的文本消息
    // 优先级：消息自带的 msgId > 当前状态 messageId > 最后文本消息 ID
    const messageId =
      (message as any).msgId ??
      this.state.messageId ??
      this.lastTextMsgId;
    if (!messageId) return; // 无法确定消息 ID，跳过（避免孤立消息）

    // 获取工具调用记录
    const invocation = this.state.toolCalls.get(callId);
    if (!invocation) return; // 工具调用不存在，跳过

    // 累积流式输出
    invocation.streamOutput = (invocation.streamOutput || '') + output;

    // 发送 tool-stream 事件到 UI
    this.emit({
      type: 'tool-stream',
      messageId,
      toolCallId: callId,
      output,
      timestamp,
    });
  }

  /**
   * handleToolCallResult - 处理工具调用结果消息
   *
   * 作用：工具执行完成，发送结果到 UI，记录执行时长
   * 为什么需要：UI 需要显示工具执行结果（成功/失败）、执行时间等
   * 获得结果：发送 tool-complete 或 tool-error 事件，删除工具调用记录
   *
   * @param message - 工具调用结果消息
   */
  private handleToolCallResult(message: ToolCallResultMessage): void {
    const { payload, timestamp } = message;
    const { callId, status, result } = payload;

    // 获取工具调用记录
    const invocation = this.state.toolCalls.get(callId);
    if (!invocation) return;

    // 确定消息 ID
    const messageId =
      (message as any).msgId ??
      this.state.messageId ??
      this.lastTextMsgId;
    if (!messageId) return;

    // 计算执行时长
    const completedAt = timestamp;
    const duration = completedAt - invocation.startedAt;

    // 根据状态发送不同事件
    if (status === 'success') {
      // 工具执行成功
      this.emit({
        type: 'tool-complete',
        messageId,
        toolCallId: callId,
        result,
        duration,
        timestamp: completedAt,
      });
    } else {
      // 工具执行失败
      const error = typeof result === 'string' ? result : JSON.stringify(result);
      this.emit({
        type: 'tool-error',
        messageId,
        toolCallId: callId,
        error,
        duration,
        timestamp: completedAt,
      });
    }

    // 删除工具调用记录（已完成）
    this.state.toolCalls.delete(callId);
  }

  // ==================== 其他事件处理 ====================

  /**
   * handleCodePatch - 处理代码补丁消息
   *
   * 作用：处理代码变更补丁，存储并发送到 UI
   * 为什么需要：代码补丁可以用于显示 diff，或者在后续操作中引用
   * 获得结果：存储补丁到状态，发送 code-patch 事件
   *
   * @param message - 代码补丁消息
   */
  private handleCodePatch(message: CodePatchMessage): void {
    const { msgId, payload, timestamp } = message;
    const { path, diff, language } = payload;

    // 存储代码补丁到状态
    this.state.codePatches.set(path, { path, diff, language, timestamp });

    // 发送 code-patch 事件到 UI
    this.emit({
      type: 'code-patch',
      messageId: msgId,
      path,
      diff,
      language,
      timestamp,
    });
  }

  /**
   * handleStatus - 处理状态消息
   *
   * 作用：处理任务状态变化，如果是终态则结束会话
   * 为什么需要：UI 需要显示当前任务状态，并在任务结束时清理资源
   * 获得结果：发送 status 事件，终态时发送 session-complete
   *
   * @param message - 状态消息
   */
  private handleStatus(message: StatusMessage): void {
    const state = message.payload?.state;

    // 发送 status 事件到 UI
    this.emit({
      type: 'status',
      state: typeof state === 'string' ? state : undefined,
      message: message.payload?.message,
    });

    // 如果是终态（已完成/失败等），结束会话
    if (!state || typeof state !== 'string') return;

    const normalized = state.toLowerCase();
    // 判断是否为终态
    const isTerminal = (
      normalized === 'completed' ||
      normalized === 'success' ||
      normalized === 'succeeded' ||
      normalized === 'failed' ||
      normalized === 'error' ||
      normalized === 'aborted'
    );

    if (isTerminal) {
      // 完成当前消息
      this.flushAndCompleteCurrent();
      // 发送会话完成事件
      this.emit({ type: 'session-complete' });
      // 重置状态
      this.reset();
    }
  }

  /**
   * handleError - 处理错误消息
   *
   * 作用：处理系统级错误，发送错误事件，重置状态
   * 为什么需要：UI 需要显示错误信息，错误发生后需要清理状态
   * 获得结果：发送 error 事件，重置状态
   *
   * @param message - 错误消息
   */
  private handleError(message: ErrorMessage): void {
    // 发送 error 事件到 UI
    this.emit({
      type: 'error',
      message: message.payload?.error || 'Unknown error',
      phase: message.payload?.phase,
    });

    // 重置状态（错误后需要重新开始）
    this.reset();
  }

  // ==================== 刷新机制 ====================

  /**
   * flushAndCompleteCurrent - 完成当前消息
   *
   * 作用：强制刷新缓冲区并发送完成事件
   * 为什么需要：当需要结束当前消息时使用（如新消息到来、会话结束）
   * 获得结果：所有缓冲内容被发送，消息标记为完成
   */
  private flushAndCompleteCurrent(): void {
    if (!this.state.messageId) return;

    // 立即刷新所有缓冲内容
    this.flushNow();

    // 发送文本完成事件
    this.emit({
      type: 'text-complete',
      messageId: this.state.messageId,
      content: this.state.fullContent,
    });

    // 重置状态
    this.state.messageId = null;
    this.state.buffer = '';
    this.state.fullContent = '';
    this.state.hasStarted = false;
    this.clearFlushTimer();
  }

  /**
   * scheduleFlush - 安排定时刷新
   *
   * 作用：设置定时器，延迟刷新缓冲区（批处理）
   * 为什么需要：减少 UI 更新频率，提升性能
   * 实现机制：如果已有定时器，则不再设置（避免重复刷新）
   *
   * @param messageId - 消息 ID
   */
  private scheduleFlush(messageId: string): void {
    // 如果已有定时器，不再设置（防抖）
    if (this.flushTimer) return;

    // 设置定时器，延迟刷新
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPartial(messageId);  // 执行部分刷新
    }, this.flushIntervalMs);
  }

  /**
   * flushPartial - 部分刷新（定时刷新调用）
   *
   * 作用：将缓冲区的内容作为 delta 发送到 UI
   * 为什么需要：分批发送文本，减少单次更新量
   * 获得结果：缓冲区被清空，text-delta 事件被发送
   *
   * @param messageId - 消息 ID
   */
  private flushPartial(messageId: string): void {
    if (!this.state.buffer) return; // 没有内容，跳过
    if (this.state.messageId !== messageId) return; // 消息不匹配，跳过

    // 获取缓冲区内容
    const delta = this.state.buffer;
    this.state.buffer = ''; // 清空缓冲区

    // 发送 text-delta 事件
    this.emit({
      type: 'text-delta',
      messageId,
      contentDelta: delta,
      isDone: false,
    });
  }

  /**
   * flushNow - 立即刷新
   *
   * 作用：立即刷新所有缓冲内容，不等待定时器
   * 为什么需要：某些场景需要立即更新（如消息完成、新消息到来）
   * 获得结果：所有缓冲内容立即发送到 UI
   */
  private flushNow(): void {
    // 清除定时器
    this.clearFlushTimer();

    // 没有内容或消息，跳过
    if (!this.state.messageId || !this.state.buffer) return;

    const messageId = this.state.messageId;
    const delta = this.state.buffer;
    this.state.buffer = '';

    // 发送 text-delta 事件
    this.emit({
      type: 'text-delta',
      messageId,
      contentDelta: delta,
      isDone: false,
    });
  }

  /**
   * clearFlushTimer - 清除刷新定时器
   *
   * 作用：清除待执行的定时器
   * 为什么需要：防止在不需要刷新时触发（如手动刷新、销毁时）
   * 获得结果：定时器被取消，内存被释放
   */
  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
