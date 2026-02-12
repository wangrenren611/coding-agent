/**
 * 消息类型定义 - 与 agent-v2 的 stream-types 对齐
 */

export enum MessageType {
  TEXT_START = 'text-start',
  TEXT_DELTA = 'text-delta',
  TEXT_COMPLETE = 'text-complete',
  TOOL_CALL_CREATED = 'tool_call_created',
  TOOL_CALL_STREAM = 'tool_call_stream',
  TOOL_CALL_RESULT = 'tool_call_result',
  CODE_PATCH = 'code_patch',
  STATUS = 'status',
  ERROR = 'error',
}

export enum AgentStatus {
  IDLE = 'idle',
  THINKING = 'thinking',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ABORTED = 'aborted',
}

interface BaseMessage {
  sessionId: string;
  timestamp: number;
}

export interface TextStartMessage extends BaseMessage {
  type: MessageType.TEXT_START;
  payload: { content: string };
  msgId: string;
}

export interface TextDeltaMessage extends BaseMessage {
  type: MessageType.TEXT_DELTA;
  payload: { content: string };
  msgId: string;
}

export interface TextCompleteMessage extends BaseMessage {
  type: MessageType.TEXT_COMPLETE;
  payload: { content: string };
  msgId: string;
}

export interface ToolCallCreatedMessage extends BaseMessage {
  type: MessageType.TOOL_CALL_CREATED;
  payload: {
    tool_calls: Array<{
      callId: string;
      toolName: string;
      args: string;
    }>;
    content?: string;
  };
  msgId: string;
}

export interface ToolCallStreamMessage extends BaseMessage {
  type: MessageType.TOOL_CALL_STREAM;
  payload: {
    callId: string;
    output: string;
  };
  msgId?: string;
}

export interface ToolCallResultMessage extends BaseMessage {
  type: MessageType.TOOL_CALL_RESULT;
  payload: {
    callId: string;
    status: 'success' | 'error';
    result: unknown;
    exitCode?: number;
  };
  msgId?: string;
}

export interface CodePatchMessage extends BaseMessage {
  type: MessageType.CODE_PATCH;
  payload: {
    path: string;
    diff: string;
    language?: string;
  };
  msgId: string;
}

export interface StatusMessage extends BaseMessage {
  type: MessageType.STATUS;
  payload: {
    state: AgentStatus;
    message?: string;
  };
  msgId?: string;
}

export interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR;
  payload: {
    error: string;
    phase?: string;
  };
}

export type StreamMessage =
  | TextStartMessage
  | TextDeltaMessage
  | TextCompleteMessage
  | ToolCallCreatedMessage
  | ToolCallStreamMessage
  | ToolCallResultMessage
  | CodePatchMessage
  | StatusMessage
  | ErrorMessage;

// UI 层使用的消息类型
export interface TextEntry {
  kind: 'text';
  id: string;
  content: string;
  isStreaming: boolean;
  timestamp: number;
}

export interface ToolEntry {
  kind: 'tool';
  id: string;
  callId: string;
  toolName: string;
  args: string;
  output: string;
  status: 'running' | 'success' | 'error';
  isStreaming: boolean;
  timestamp: number;
}

export interface ErrorEntry {
  kind: 'error';
  id: string;
  message: string;
  phase?: string;
  timestamp: number;
}

export interface UserEntry {
  kind: 'user';
  id: string;
  content: string;
  timestamp: number;
}

export type DisplayEntry = TextEntry | ToolEntry | ErrorEntry | UserEntry;
