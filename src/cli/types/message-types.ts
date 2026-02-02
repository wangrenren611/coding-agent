/**
 * CLI 消息类型定义
 *
 * 本文件定义了 CLI 界面专用的消息类型系统，与核心 Agent 的消息类型分离
 * 设计原则：
 * 1. UI 消息模型独立于核心消息模型
 * 2. 工具调用是内聚的单元（包含参数、状态、结果）
 * 3. 流式消息有明确的生命周期状态
 */

// =============================================================================
// 基础类型
// =============================================================================

/** 消息唯一标识 */
export type MessageId = string;

/** 时间戳 */
export type Timestamp = number;

/** 工具调用状态 */
export type ToolStatus = 'pending' | 'running' | 'success' | 'error';

/** 消息状态 */
export type MessageStatus = 'streaming' | 'complete' | 'error';

// =============================================================================
// 工具调用类型
// =============================================================================

/**
 * 工具调用单元
 *
 * 包含工具调用的完整生命周期信息，从调用开始到结果返回
 */
export interface ToolInvocation {
  /** 工具调用唯一标识 */
  id: string;

  /** 工具名称 */
  name: string;

  /** 调用参数 */
  args: Record<string, unknown>;

  /** 当前状态 */
  status: ToolStatus;

  /** 执行结果（仅在 success 状态下有效） */
  result?: unknown;

  /** 错误信息（仅在 error 状态下有效） */
  error?: string;

  /** 执行耗时（毫秒） */
  duration?: number;

  /** 开始时间戳 */
  startedAt: Timestamp;

  /** 完成时间戳 */
  completedAt?: Timestamp;
}

/**
 * 工具调用创建参数
 */
export interface CreateToolInvocationParams {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// =============================================================================
// 消息单元类型
// =============================================================================

/**
 * 基础消息接口
 */
interface BaseMessage {
  /** 消息唯一标识 */
  id: MessageId;

  /** 创建时间戳 */
  timestamp: Timestamp;
}

/**
 * 用户消息
 */
export interface UserMessage extends BaseMessage {
  type: 'user';

  /** 消息内容 */
  content: string;
}

/**
 * 助手文本消息
 *
 * 用于纯文本回复，支持流式输出
 */
export interface AssistantTextMessage extends BaseMessage {
  type: 'assistant-text';

  /** 消息内容 */
  content: string;

  /** 消息状态 */
  status: MessageStatus;

  /** 推理内容（如果有） */
  reasoningContent?: string;
}

/**
 * 助手工具调用消息
 *
 * 包含文本内容和/或工具调用列表
 */
export interface AssistantToolMessage extends BaseMessage {
  type: 'assistant-tool';

  /** 前置文本内容（可选，解释性文字） */
  content?: string;

  /** 工具调用列表 */
  toolCalls: ToolInvocation[];

  /** 消息状态 */
  status: MessageStatus;
}

/**
 * 系统消息
 *
 * 用于显示系统级别信息，如错误、警告等
 */
export interface SystemMessage extends BaseMessage {
  type: 'system';

  /** 消息级别 */
  level: 'info' | 'warn' | 'error';

  /** 消息内容 */
  content: string;

  /** 详细错误信息 */
  details?: string;
}

/**
 * UI 消息联合类型
 */
export type UIMessage = UserMessage | AssistantTextMessage | AssistantToolMessage | SystemMessage;

// =============================================================================
// 事件类型（Agent -> UI）
// =============================================================================

/**
 * 助手消息开始事件
 *
 * 当 Agent 开始生成新的助手消息时触发
 */
export interface AssistantMessageStartEvent {
  type: 'assistant-message-start';
  messageId: MessageId;
  timestamp: Timestamp;
  /** 是否包含工具调用 */
  hasToolCalls?: boolean;
}

/**
 * 助手消息增量更新事件
 *
 * 流式输出时触发，包含内容的增量更新
 */
export interface AssistantMessageDeltaEvent {
  type: 'assistant-message-delta';
  messageId: MessageId;
  /** 文本内容增量 */
  contentDelta?: string;
  /** 推理内容增量 */
  reasoningDelta?: string;
  /** 是否是最后一块 */
  isDone: boolean;
}

/**
 * 助手消息完成事件
 *
 * 当助手消息生成完成时触发
 */
export interface AssistantMessageCompleteEvent {
  type: 'assistant-message-complete';
  messageId: MessageId;
  /** 最终内容 */
  content: string;
  /** 工具调用列表（如果有） */
  toolCalls?: ToolInvocation[];
}

/**
 * 工具调用开始事件
 *
 * 当 Agent 开始执行工具时触发
 */
export interface ToolInvocationStartEvent {
  type: 'tool-invocation-start';
  messageId: MessageId;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: Timestamp;
}

/**
 * 工具调用完成事件
 *
 * 当工具执行完成时触发
 */
export interface ToolInvocationCompleteEvent {
  type: 'tool-invocation-complete';
  messageId: MessageId;
  toolCallId: string;
  result: unknown;
  duration: number;
  timestamp: Timestamp;
}

/**
 * 工具调用错误事件
 *
 * 当工具执行失败时触发
 */
export interface ToolInvocationErrorEvent {
  type: 'tool-invocation-error';
  messageId: MessageId;
  toolCallId: string;
  error: string;
  duration: number;
  timestamp: Timestamp;
}

/**
 * 错误事件
 */
export interface ErrorEvent {
  type: 'error';
  error: Error;
  phase: string;
  recoverable: boolean;
}

/**
 * 会话完成事件
 */
export interface SessionCompleteEvent {
  type: 'session-complete';
  finalContent: string;
}

/**
 * 思考状态事件
 */
export interface ThinkingEvent {
  type: 'thinking-start' | 'thinking-end';
  step: number;
  hasToolCalls?: boolean;
}

/**
 * UI 事件联合类型
 */
export type UIEvent =
  | AssistantMessageStartEvent
  | AssistantMessageDeltaEvent
  | AssistantMessageCompleteEvent
  | ToolInvocationStartEvent
  | ToolInvocationCompleteEvent
  | ToolInvocationErrorEvent
  | ErrorEvent
  | SessionCompleteEvent
  | ThinkingEvent;

// =============================================================================
// 辅助类型
// =============================================================================

/**
 * 消息渲染分组
 *
 * 用于 UI 渲染时将相关消息分组显示
 */
export interface MessageRenderGroup {
  /** 组唯一标识 */
  id: string;

  /** 组类型 */
  groupType: 'user-turn' | 'assistant-turn';

  /** 组内消息列表 */
  messages: UIMessage[];

  /** 是否正在流式输出 */
  isStreaming?: boolean;
}

/**
 * 工具调用统计
 */
export interface ToolCallStats {
  total: number;
  success: number;
  error: number;
  pending: number;
  totalDuration: number;
}

/**
 * 会话统计
 */
export interface SessionStats {
  messageCount: number;
  toolCallStats: ToolCallStats;
  tokenUsage: { used: number; total: number };
}
