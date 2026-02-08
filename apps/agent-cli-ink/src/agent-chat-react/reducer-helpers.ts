import type { AgentStatus } from "../../../../src/agent-v2/agent/types";
import type {
  AgentChatState,
  UIAssistantMessage,
  UIToolCall,
} from "./types";

export function pruneMessagesState(state: AgentChatState, keepLast: number): AgentChatState {
  const safeKeepLast = Number.isFinite(keepLast) ? Math.max(1, Math.floor(keepLast)) : 20;
  const nextMessages = state.messages.slice(-safeKeepLast);
  const nextMessageIndexByMsgId: Record<string, number> = {};
  const nextToolLocatorByCallId: Record<string, { messageId: string; toolIndex: number }> = {};
  let nextLatestAssistantMessageId: string | null = null;

  nextMessages.forEach((message, index) => {
    if (message.kind !== "assistant") return;
    nextMessageIndexByMsgId[message.id] = index;
    nextLatestAssistantMessageId = message.id;
    message.toolCalls.forEach((toolCall, toolIndex) => {
      nextToolLocatorByCallId[toolCall.callId] = { messageId: message.id, toolIndex };
    });
  });

  const errorMessages = nextMessages.filter((message) => message.kind === "error");
  const latestError = errorMessages.length > 0 ? errorMessages[errorMessages.length - 1] : null;

  return {
    ...state,
    messages: nextMessages,
    latestAssistantMessageId: nextLatestAssistantMessageId,
    messageIndexByMsgId: nextMessageIndexByMsgId,
    toolLocatorByCallId: nextToolLocatorByCallId,
    error: latestError,
  };
}

export function ensureAssistantMessage(
  state: AgentChatState,
  msgId: string,
  timestamp: number
): { state: AgentChatState; index: number } {
  const existingIndex = state.messageIndexByMsgId[msgId];
  if (existingIndex !== undefined) {
    const existingMessage = state.messages[existingIndex];
    if (existingMessage?.kind === "assistant") return { state, index: existingIndex };
  }

  const assistant = createAssistantMessage(msgId, timestamp);
  const nextMessages = state.messages.concat(assistant);
  const nextIndex = nextMessages.length - 1;

  return {
    state: {
      ...state,
      messages: nextMessages,
      messageIndexByMsgId: { ...state.messageIndexByMsgId, [msgId]: nextIndex },
      latestAssistantMessageId: msgId,
    },
    index: nextIndex,
  };
}

export function replaceAssistantAt(
  state: AgentChatState,
  index: number,
  msgId: string,
  assistant: UIAssistantMessage
): AgentChatState {
  const nextMessages = state.messages.slice();
  nextMessages[index] = assistant;
  return { ...state, messages: nextMessages, latestAssistantMessageId: msgId };
}

interface ToolCallUpdateOptions {
  msgId?: string;
  timestamp: number;
  callId: string;
  toolName?: string;
  args?: string;
  phase?: UIAssistantMessage["phase"];
  updater: (tool: UIToolCall) => UIToolCall;
}

export function withToolCallUpdate(state: AgentChatState, options: ToolCallUpdateOptions): AgentChatState {
  let targetMessageId = resolveMessageId(state, options.msgId, `tool-${options.callId}`, options.timestamp);
  let targetAssistantIndex: number | undefined;
  let targetToolIndex: number | undefined;
  let workingState = state;

  const existingLocator = state.toolLocatorByCallId[options.callId];
  if (existingLocator) {
    const locatedAssistantIndex = state.messageIndexByMsgId[existingLocator.messageId];
    const locatedMessage = locatedAssistantIndex !== undefined ? state.messages[locatedAssistantIndex] : undefined;
    const locatedToolCall = locatedMessage?.kind === "assistant"
      ? locatedMessage.toolCalls[existingLocator.toolIndex]
      : undefined;

    if (locatedMessage?.kind === "assistant" && locatedToolCall?.callId === options.callId) {
      targetMessageId = existingLocator.messageId;
      targetAssistantIndex = locatedAssistantIndex;
      targetToolIndex = existingLocator.toolIndex;
    }
  }

  if (targetAssistantIndex === undefined) {
    const ensured = ensureAssistantMessage(workingState, targetMessageId, options.timestamp);
    workingState = ensured.state;
    targetAssistantIndex = ensured.index;
  }

  const assistant = workingState.messages[targetAssistantIndex];
  if (assistant.kind !== "assistant") return workingState;

  const nextToolCalls = assistant.toolCalls.slice();
  if (targetToolIndex === undefined || !Number.isInteger(targetToolIndex) || targetToolIndex < 0) {
    targetToolIndex = nextToolCalls.findIndex((item) => item.callId === options.callId);
  }

  if (targetToolIndex < 0) {
    targetToolIndex = nextToolCalls.length;
    nextToolCalls.push({
      callId: options.callId,
      toolName: options.toolName || "",
      args: options.args || "",
      streamLogs: [],
      result: null,
    });
  }

  const currentTool = nextToolCalls[targetToolIndex] ?? {
    callId: options.callId,
    toolName: options.toolName || "",
    args: options.args || "",
    streamLogs: [],
    result: null,
  };
  const mergedTool: UIToolCall = {
    ...currentTool,
    toolName: options.toolName || currentTool.toolName,
    args: options.args || currentTool.args,
  };
  nextToolCalls[targetToolIndex] = options.updater(mergedTool);

  const nextAssistant: UIAssistantMessage = {
    ...assistant,
    phase: options.phase ?? assistant.phase,
    toolCalls: nextToolCalls,
    updatedAt: options.timestamp,
  };

  const replacedState = replaceAssistantAt(workingState, targetAssistantIndex, targetMessageId, nextAssistant);
  return {
    ...replacedState,
    toolLocatorByCallId: {
      ...replacedState.toolLocatorByCallId,
      [options.callId]: { messageId: targetMessageId, toolIndex: targetToolIndex },
    },
  };
}

export function resolveMessageId(
  state: AgentChatState,
  msgId: string | undefined,
  prefix: string,
  timestamp: number
): string {
  if (msgId) return msgId;
  return `${prefix}-${timestamp}-${state.messages.length}`;
}

export function normalizeResultOutput(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result;
  try {
    const serialized = JSON.stringify(result);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall through to String() fallback.
  }

  try {
    return String(result);
  } catch {
    return "[unserializable result]";
  }
}

export function shouldSetStreamingFromStatus(status: AgentStatus, fallback: boolean): boolean {
  if (status === "idle" || status === "completed" || status === "failed" || status === "aborted") return false;
  if (status === "thinking" || status === "running" || status === "retrying") return true;
  return fallback;
}

function createAssistantMessage(msgId: string, timestamp: number): UIAssistantMessage {
  return {
    id: msgId,
    kind: "assistant",
    role: "assistant",
    content: "",
    phase: "streaming",
    toolCalls: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
