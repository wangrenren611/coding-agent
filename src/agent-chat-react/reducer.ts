import { AgentMessageType, type AgentMessage } from "../agent-v2/agent/stream-types";
import { AgentStatus } from "../agent-v2/agent/types";
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
  const prefix = message.type === AgentMessageType.TEXT_START
    ? "text-start"
    : message.type === AgentMessageType.TEXT_DELTA
      ? "text-delta"
      : "text-complete";
  const msgId = resolveMessageId(state, message.msgId, prefix, message.timestamp);
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
    const existingIndex = nextToolCalls.findIndex((item) => item.callId === toolCall.callId);
    if (existingIndex >= 0) {
      const existing = nextToolCalls[existingIndex];
      nextToolCalls[existingIndex] = {
        ...existing,
        toolName: toolCall.toolName || existing.toolName,
        args: toolCall.args || existing.args,
      };
      nextToolLocatorByCallId[toolCall.callId] = { messageId: msgId, toolIndex: existingIndex };
      continue;
    }

    const createdIndex = nextToolCalls.length;
    nextToolCalls.push({
      callId: toolCall.callId,
      toolName: toolCall.toolName || "",
      args: toolCall.args || "",
      streamLogs: [],
      result: null,
    });
    nextToolLocatorByCallId[toolCall.callId] = { messageId: msgId, toolIndex: createdIndex };
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
  if (!message.payload.callId) return state;
  const nextState = withToolCallUpdate(state, {
    msgId: message.msgId,
    timestamp: message.timestamp,
    callId: message.payload.callId,
    phase: "streaming",
    updater: (tool) => ({ ...tool, streamLogs: tool.streamLogs.concat(message.payload.output || "") }),
  });
  return { ...nextState, isStreaming: true };
}

function ingestToolResult(state: AgentChatState, message: Extract<AgentMessage, { type: AgentMessageType.TOOL_CALL_RESULT }>): AgentChatState {
  if (!message.payload.callId) return state;
  const nextState = withToolCallUpdate(state, {
    msgId: message.msgId,
    timestamp: message.timestamp,
    callId: message.payload.callId,
    phase: "completed",
    updater: (tool) => ({
      ...tool,
      result: {
        status: message.payload.status,
        output: normalizeResultOutput(message.payload.result),
        exitCode: message.payload.exitCode,
      },
    }),
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
