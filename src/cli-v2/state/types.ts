/**
 * cli-v2 State Management Types
 *
 * 定义了 CLI UI 中使用的所有类型，包括消息、工具调用和状态
 */

// ==================== 消息类型 ====================

/**
 * 聊天消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * 基础消息接口
 */
export interface BaseMessage {
  id: string;
  role: MessageRole;
  timestamp: number;
}

/**
 * 用户消息
 */
export interface UserMessageContent {
  content: string;
}

/**
 * 助手消息（文本回复）
 */
export interface AssistantMessageContent {
  content: string;
  isStreaming: boolean;
  status?: 'pending' | 'streaming' | 'completed' | 'error';
}

/**
 * 系统消息（用于通知、警告、错误等）
 */
export interface SystemMessageContent {
  level: 'info' | 'warn' | 'error';
  content: string;
}

/**
 * 根据角色区分的消息内容
 */
export type MessageContent = UserMessageContent | AssistantMessageContent | SystemMessageContent;

/**
 * 聊天消息
 */
export interface ChatMessage extends BaseMessage {
  content: string;
  isStreaming?: boolean;
  status?: 'pending' | 'streaming' | 'completed' | 'error';
  level?: 'info' | 'warn' | 'error';
}

/**
 * 工具调用状态
 */
export type ToolInvocationStatus = 'pending' | 'running' | 'success' | 'error';

/**
 * 工具调用详情
 */
export interface ToolInvocation {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolInvocationStatus;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  result?: string;
  error?: string;
  streamOutput?: string;
}

/**
 * 完整的聊天消息（可能包含工具调用）
 */
export interface Message extends ChatMessage {
  toolCalls?: ToolInvocation[];
}

// ==================== UI 事件类型 ====================

/**
 * 文本开始事件
 */
export interface TextStartEvent {
  type: 'text-start';
  messageId: string;
  timestamp: number;
}

/**
 * 文本增量事件
 */
export interface TextDeltaEvent {
  type: 'text-delta';
  messageId: string;
  contentDelta: string;
  isDone: boolean;
}

/**
 * 文本完成事件
 */
export interface TextCompleteEvent {
  type: 'text-complete';
  messageId: string;
  content: string;
}

/**
 * 工具开始事件
 */
export interface ToolStartEvent {
  type: 'tool-start';
  messageId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
  content?: string;
}

/**
 * 工具流式输出事件
 */
export interface ToolStreamEvent {
  type: 'tool-stream';
  messageId: string;
  toolCallId: string;
  output: string;
  timestamp: number;
}

/**
 * 工具完成事件
 */
export interface ToolCompleteEvent {
  type: 'tool-complete';
  messageId: string;
  toolCallId: string;
  result: string;
  duration: number;
  timestamp: number;
}

/**
 * 工具错误事件
 */
export interface ToolErrorEvent {
  type: 'tool-error';
  messageId: string;
  toolCallId: string;
  error: string;
  duration: number;
  timestamp: number;
}

/**
 * 代码补丁事件
 */
export interface CodePatchEvent {
  type: 'code-patch';
  messageId: string;
  path: string;
  diff: string;
  language?: string;
  timestamp: number;
}

/**
 * 状态事件
 */
export interface StatusEvent {
  type: 'status';
  state?: string;
  message?: string;
}

/**
 * 会话完成事件
 */
export interface SessionCompleteEvent {
  type: 'session-complete';
}

/**
 * 错误事件
 */
export interface ErrorEvent {
  type: 'error';
  message: string;
  phase?: string;
}

/**
 * UI 事件联合类型
 */
export type UIEvent =
  | TextStartEvent
  | TextDeltaEvent
  | TextCompleteEvent
  | ToolStartEvent
  | ToolStreamEvent
  | ToolCompleteEvent
  | ToolErrorEvent
  | CodePatchEvent
  | StatusEvent
  | SessionCompleteEvent
  | ErrorEvent;

// ==================== State 类型 ====================

/**
 * Agent 执行状态
 */
export type AgentExecutionState = 'idle' | 'running' | 'thinking' | 'error' | 'completed';

/**
 * 主 State 接口
 */
export interface ChatState {
  /** 所有消息 */
  messages: Message[];
  /** 当前执行状态 */
  executionState: AgentExecutionState;
  /** 状态消息（如 "Agent is thinking..."） */
  statusMessage?: string;
  /** 当前正在流式传输的消息 ID */
  streamingMessageId: string | null;
}

// ==================== Action 类型 ====================

/**
 * 添加用户消息
 */
export interface AddUserMessageAction {
  type: 'add-user-message';
  payload: { content: string };
}

/**
 * 添加系统消息
 */
export interface AddSystemMessageAction {
  type: 'add-system-message';
  payload: { level: 'info' | 'warn' | 'error'; content: string };
}

/**
 * 应用 UI 事件
 */
export interface ApplyEventAction {
  type: 'apply-event';
  payload: { event: UIEvent };
}

/**
 * 清除消息
 */
export interface ClearMessagesAction {
  type: 'clear-messages';
}

/**
 * 设置加载状态
 */
export interface SetLoadingAction {
  type: 'set-loading';
  payload: { isLoading: boolean };
}

/**
 * 设置执行状态
 */
export interface SetExecutionStateAction {
  type: 'set-execution-state';
  payload: { state: AgentExecutionState; message?: string };
}

/**
 * 设置状态消息
 */
export interface SetStatusMessageAction {
  type: 'set-status-message';
  payload: { message?: string };
}

/**
 * Reducer Action 联合类型
 */
export type ChatAction =
  | AddUserMessageAction
  | AddSystemMessageAction
  | ApplyEventAction
  | ClearMessagesAction
  | SetLoadingAction
  | SetExecutionStateAction
  | SetStatusMessageAction;

// ==================== 辅助类型 ====================

/**
 * 消息创建参数
 */
export interface CreateMessageParams {
  id?: string;
  timestamp?: number;
}

/**
 * 工具调用创建参数
 */
export interface CreateToolInvocationParams {
  id: string;
  name: string;
  args: Record<string, unknown>;
  timestamp: number;
}
