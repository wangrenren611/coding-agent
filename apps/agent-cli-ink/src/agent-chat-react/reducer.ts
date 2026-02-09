import { AgentMessageType, type AgentMessage } from "../../../../src/agent-v2/agent/stream-types";
import { AgentStatus } from "../../../../src/agent-v2/agent/types";
import {
  ensureAssistantMessage,
  normalizeResultOutput,
  pruneMessagesState,
  replaceAssistantAt,
  resolveMessageId,
  shouldSetStreamingFromStatus,
  withToolCallUpdate,
} from "./reducer-helpers";
import type {
  AgentChatState,
  UIAssistantMessage,
  UIErrorMessage,
} from "./types";

const MAX_TOOL_STREAM_CHUNKS = 400;
const MAX_TOOL_STREAM_CHARS = 120_000;
const MAX_TOOL_RESULT_CHARS = 80_000;

export type AgentChatAction =
  | { type: "INGEST_STREAM_MESSAGE"; message: AgentMessage }
  | { type: "PRUNE_MESSAGES"; keepLast: number }
  | { type: "RESET" }
  | { type: "CLEAR_ERROR" };

export function createInitialAgentChatState(): AgentChatState {
  return {
    messages: [],
    status: AgentStatus.IDLE,
    isStreaming: false,
    error: null,
    latestAssistantMessageId: null,
    messageIndexByMsgId: {},
    toolLocatorByCallId: {},
  };
}

export const initialAgentChatState = createInitialAgentChatState();

export function agentChatReducer(state: AgentChatState, action: AgentChatAction): AgentChatState {
  switch (action.type) {
    case "INGEST_STREAM_MESSAGE":
      return ingestStreamMessage(state, action.message);
    case "PRUNE_MESSAGES":
      return pruneMessagesState(state, action.keepLast);
    case "RESET":
      return createInitialAgentChatState();
    case "CLEAR_ERROR":
      return { ...state, error: null };
    default:
      return state;
  }
}

function ingestStreamMessage(state: AgentChatState, message: AgentMessage): AgentChatState {
  switch (message.type) {
    case AgentMessageType.TEXT_START:
    case AgentMessageType.TEXT_DELTA:
    case AgentMessageType.TEXT_COMPLETE:
      return ingestTextEvent(state, message);
    case AgentMessageType.TOOL_CALL_CREATED:
      return ingestToolCreated(state, message);
    case AgentMessageType.TOOL_CALL_STREAM:
      return ingestToolStream(state, message);
    case AgentMessageType.TOOL_CALL_RESULT:
      return ingestToolResult(state, message);
    case AgentMessageType.CODE_PATCH:
      return ingestCodePatch(state, message);
    case AgentMessageType.STATUS: {
      const nextStatus = message.payload.state;
      return {
        ...state,
        status: nextStatus,
        isStreaming: shouldSetStreamingFromStatus(nextStatus, state.isStreaming),
      };
    }
    case AgentMessageType.ERROR: {
      const errorMessage: UIErrorMessage = {
        id: `error-${message.timestamp}-${state.messages.length}`,
        kind: "error",
        error: message.payload.error,
        phase: message.payload.phase,
        createdAt: message.timestamp,
      };
      return { ...state, messages: state.messages.concat(errorMessage), error: errorMessage, isStreaming: false };
    }
    default:
      return state;
  }
}

function ingestTextEvent(state: AgentChatState, message: Extract<AgentMessage, { type: AgentMessageType.TEXT_START | AgentMessageType.TEXT_DELTA | AgentMessageType.TEXT_COMPLETE }>): AgentChatState {
  // 统一使用 "text" 作为 prefix，避免同一组消息被拆分成多个
  // 对于 TEXT_DELTA 和 TEXT_COMPLETE，如果没有 msgId，使用最新创建的 text 消息 ID
  let msgId: string;
  if (message.msgId) {
    msgId = message.msgId;
  } else if (message.type === AgentMessageType.TEXT_START) {
    msgId = resolveMessageId(state, undefined, "text", message.timestamp);
  } else {
    // TEXT_DELTA 或 TEXT_COMPLETE 没有 msgId，使用状态中最新创建的 text 消息 ID
    msgId = state.latestAssistantMessageId || `text-${message.timestamp}`;
  }
  
  const ensured = ensureAssistantMessage(state, msgId, message.timestamp);
  const assistant = ensured.state.messages[ensured.index];
  if (assistant.kind !== "assistant") return ensured.state;

  const nextAssistant: UIAssistantMessage = {
    ...assistant,
    content: message.type === AgentMessageType.TEXT_DELTA
      ? assistant.content + (message.payload.content || "")
      : (message.payload.content || assistant.content),
    phase: message.type === AgentMessageType.TEXT_COMPLETE ? "completed" : "streaming",
    updatedAt: message.timestamp,
  };

  return {
    ...replaceAssistantAt(ensured.state, ensured.index, msgId, nextAssistant),
    isStreaming: message.type !== AgentMessageType.TEXT_COMPLETE,
  };
}

function ingestToolCreated(state: AgentChatState, message: Extract<AgentMessage, { type: AgentMessageType.TOOL_CALL_CREATED }>): AgentChatState {
  const msgId = resolveMessageId(state, message.msgId, "tool-created", message.timestamp);
  const ensured = ensureAssistantMessage(state, msgId, message.timestamp);
  const assistant = ensured.state.messages[ensured.index];
  if (assistant.kind !== "assistant") return ensured.state;

  const nextToolLocatorByCallId = { ...ensured.state.toolLocatorByCallId };
  const nextToolCalls = assistant.toolCalls.slice();

  for (const toolCall of message.payload.tool_calls) {
    const callId = toDisplayString(toolCall.callId);
    if (!callId) continue;
    const existingIndex = nextToolCalls.findIndex((item) => item.callId === callId);
    const toolName = toDisplayString(toolCall.toolName);
    const args = toDisplayString(toolCall.args);
    if (existingIndex >= 0) {
      const existing = nextToolCalls[existingIndex];
      nextToolCalls[existingIndex] = {
        ...existing,
        toolName: toolName || existing.toolName,
        args: args || existing.args,
      };
      nextToolLocatorByCallId[callId] = { messageId: msgId, toolIndex: existingIndex };
      continue;
    }

    const createdIndex = nextToolCalls.length;
    nextToolCalls.push({
      callId,
      toolName: toolName || "",
      args: args || "",
      streamLogs: [],
      result: null,
    });
    nextToolLocatorByCallId[callId] = { messageId: msgId, toolIndex: createdIndex };
  }

  const nextAssistant: UIAssistantMessage = {
    ...assistant,
    content: message.payload.content ?? assistant.content,
    toolCalls: nextToolCalls,
    phase: "completed",
    updatedAt: message.timestamp,
  };

  return {
    ...replaceAssistantAt(ensured.state, ensured.index, msgId, nextAssistant),
    toolLocatorByCallId: nextToolLocatorByCallId,
  };
}

function ingestToolStream(state: AgentChatState, message: Extract<AgentMessage, { type: AgentMessageType.TOOL_CALL_STREAM }>): AgentChatState {
  const callId = toDisplayString(message.payload.callId);
  if (!callId) return state;
  const nextState = withToolCallUpdate(state, {
    msgId: message.msgId,
    timestamp: message.timestamp,
    callId,
    phase: "streaming",
    updater: (tool) => ({
      ...tool,
      streamLogs: appendToolStreamLog(tool.streamLogs, message.payload.output),
    }),
  });
  return { ...nextState, isStreaming: true };
}

function ingestToolResult(state: AgentChatState, message: Extract<AgentMessage, { type: AgentMessageType.TOOL_CALL_RESULT }>): AgentChatState {
  const callId = toDisplayString(message.payload.callId);
  if (!callId) return state;
  const nextState = withToolCallUpdate(state, {
    msgId: message.msgId,
    timestamp: message.timestamp,
    callId,
    phase: "completed",
    updater: (tool) => {
      const output = normalizeResultOutput(message.payload.result);
      return {
        ...tool,
        result: {
          status: message.payload.status,
          output: truncateText(output, MAX_TOOL_RESULT_CHARS),
          exitCode: message.payload.exitCode,
        },
      };
    },
  });
  return { ...nextState, isStreaming: false };
}

function ingestCodePatch(state: AgentChatState, message: Extract<AgentMessage, { type: AgentMessageType.CODE_PATCH }>): AgentChatState {
  const patchId = resolveMessageId(state, message.msgId, "code-patch", message.timestamp);
  return {
    ...state,
    messages: state.messages.concat({
      id: patchId,
      kind: "code_patch",
      path: message.payload.path,
      diff: message.payload.diff,
      language: message.payload.language,
      createdAt: message.timestamp,
    }),
  };
}

function toDisplayString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendToolStreamLog(current: string[], nextChunk: unknown): string[] {
  const chunk = toDisplayString(nextChunk);
  if (!chunk) return current;

  let logs = current.concat(chunk);
  if (logs.length > MAX_TOOL_STREAM_CHUNKS) {
    logs = logs.slice(logs.length - MAX_TOOL_STREAM_CHUNKS);
  }

  let totalChars = logs.reduce((sum, entry) => sum + entry.length, 0);
  while (logs.length > 1 && totalChars > MAX_TOOL_STREAM_CHARS) {
    const removed = logs.shift();
    if (removed == null) break;
    totalChars -= removed.length;
  }

  return logs;
}

function truncateText(value: string | null, limit: number): string | null {
  if (value == null || value.length <= limit) return value;
  const head = value.slice(0, limit);
  return `${head}\n...[truncated]`;
}
