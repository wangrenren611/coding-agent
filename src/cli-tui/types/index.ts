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

export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  content: string;
  isStreaming: boolean;
  status?: 'pending' | 'streaming' | 'completed' | 'error';
  toolCalls?: ToolInvocation[];
}

export interface SystemMessage extends BaseMessage {
  role: 'system';
  level: 'info' | 'warn' | 'error';
  content: string;
}

export type Message = UserMessage | AssistantMessage | SystemMessage;

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
