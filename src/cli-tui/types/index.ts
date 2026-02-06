/**
 * cli-tui Type Definitions
 * OpenTUI-based CLI types
 */

// ==================== Message Types ====================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface BaseMessage {
  id: string;
  role: MessageRole;
  timestamp: number;
}

export interface ChatMessage extends BaseMessage {
  content: string;
  isStreaming?: boolean;
  status?: 'pending' | 'streaming' | 'completed' | 'error';
  level?: 'info' | 'warn' | 'error';
}

export interface Message extends ChatMessage {
  toolCalls?: ToolInvocation[];
}

// ==================== Tool Invocation Types ====================

export type ToolInvocationStatus = 'pending' | 'running' | 'success' | 'error';

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

// ==================== UI Event Types ====================

export interface TextStartEvent {
  type: 'text-start';
  messageId: string;
  timestamp: number;
}

export interface TextDeltaEvent {
  type: 'text-delta';
  messageId: string;
  contentDelta: string;
  isDone: boolean;
}

export interface TextCompleteEvent {
  type: 'text-complete';
  messageId: string;
  content: string;
}

export interface ToolStartEvent {
  type: 'tool-start';
  messageId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
  content?: string;
}

export interface ToolStreamEvent {
  type: 'tool-stream';
  messageId: string;
  toolCallId: string;
  output: string;
  timestamp: number;
}

export interface ToolCompleteEvent {
  type: 'tool-complete';
  messageId: string;
  toolCallId: string;
  result: string;
  duration: number;
  timestamp: number;
}

export interface ToolErrorEvent {
  type: 'tool-error';
  messageId: string;
  toolCallId: string;
  error: string;
  duration: number;
  timestamp: number;
}

export interface CodePatchEvent {
  type: 'code-patch';
  messageId: string;
  path: string;
  diff: string;
  language?: string;
  timestamp: number;
}

export interface StatusEvent {
  type: 'status';
  state?: string;
  message?: string;
}

export interface SessionCompleteEvent {
  type: 'session-complete';
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  phase?: string;
}

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

// ==================== State Types ====================

export type AgentExecutionState = 'idle' | 'running' | 'thinking' | 'error' | 'completed';

export interface ChatState {
  messages: Message[];
  executionState: AgentExecutionState;
  statusMessage?: string;
  streamingMessageId: string | null;
}

// ==================== Action Types ====================

export interface AddUserMessageAction {
  type: 'add-user-message';
  payload: { content: string };
}

export interface AddSystemMessageAction {
  type: 'add-system-message';
  payload: { level: 'info' | 'warn' | 'error'; content: string };
}

export interface ApplyEventAction {
  type: 'apply-event';
  payload: { event: UIEvent };
}

export interface ClearMessagesAction {
  type: 'clear-messages';
}

export interface SetLoadingAction {
  type: 'set-loading';
  payload: { isLoading: boolean };
}

export interface SetExecutionStateAction {
  type: 'set-execution-state';
  payload: { state: AgentExecutionState; message?: string };
}

export interface SetStatusMessageAction {
  type: 'set-status-message';
  payload: { message?: string };
}

export type ChatAction =
  | AddUserMessageAction
  | AddSystemMessageAction
  | ApplyEventAction
  | ClearMessagesAction
  | SetLoadingAction
  | SetExecutionStateAction
  | SetStatusMessageAction;

// ==================== Overlay Types ====================

export type OverlayType = 'none' | 'help' | 'models' | 'command-palette';

// ==================== Input History ====================

export interface InputHistory {
  items: string[];
  index: number;
  draft: string;
}

// ==================== Focus Management ====================

export type FocusTarget = 'input' | 'messageList' | 'overlay';
