import type { AgentMessage } from "../../src/agent-v2/agent/stream-types";
import type { AgentStatus } from "../../src/agent-v2/agent/types";

export type { AgentMessage, AgentStatus };

export type ToolExecutionStatus = "success" | "error";

export interface UIToolCallResult {
  status: ToolExecutionStatus;
  output: string | null;
  exitCode?: number;
}

export interface UIToolCall {
  callId: string;
  toolName: string;
  args: string;
  streamLogs: string[];
  result: UIToolCallResult | null;
}

export interface UIAssistantMessage {
  id: string;
  kind: "assistant";
  role: "assistant";
  content: string;
  phase: "streaming" | "completed";
  toolCalls: UIToolCall[];
  createdAt: number;
  updatedAt: number;
}

export interface UICodePatchMessage {
  id: string;
  kind: "code_patch";
  path: string;
  diff: string;
  language?: string;
  createdAt: number;
}

export interface UIErrorMessage {
  id: string;
  kind: "error";
  error: string;
  phase?: string;
  createdAt: number;
}

export interface UISystemMessage {
  id: string;
  kind: "system";
  text: string;
  createdAt: number;
}

export type UIMessage =
  | UIAssistantMessage
  | UICodePatchMessage
  | UIErrorMessage
  | UISystemMessage;

export interface ToolLocator {
  messageId: string;
  toolIndex: number;
}

export interface AgentChatState {
  messages: UIMessage[];
  status: AgentStatus;
  isStreaming: boolean;
  error: UIErrorMessage | null;
  latestAssistantMessageId: string | null;
  messageIndexByMsgId: Record<string, number>;
  toolLocatorByCallId: Record<string, ToolLocator>;
}

export interface AgentChatContextValue {
  messages: UIMessage[];
  latestAssistantMessage: UIAssistantMessage | null;
  status: AgentStatus;
  isStreaming: boolean;
  error: UIErrorMessage | null;
  ingestStreamMessage: (message: AgentMessage) => void;
  reset: () => void;
  clearError: () => void;
}
