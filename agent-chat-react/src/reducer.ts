import { AgentMessageType, type AgentMessage } from "../../src/agent-v2/agent/stream-types";
import { AgentStatus } from "../../src/agent-v2/agent/types";
import type {
  AgentChatState,
  UIAssistantMessage,
  UIErrorMessage,
  UIToolCall,
} from "./types";

export type AgentChatAction =
  | { type: "INGEST_STREAM_MESSAGE"; message: AgentMessage }
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
    case AgentMessageType.TEXT_START: {
      const msgId = resolveMessageId(state, message.msgId, "text-start", message.timestamp);
      const ensured = ensureAssistantMessage(state, msgId, message.timestamp);
      const assistant = ensured.state.messages[ensured.index];
      if (assistant.kind !== "assistant") return ensured.state;

      const nextAssistant: UIAssistantMessage = {
        ...assistant,
        content: message.payload.content || assistant.content,
        phase: "streaming",
        updatedAt: message.timestamp,
      };

      return {
        ...replaceAssistantAt(ensured.state, ensured.index, msgId, nextAssistant),
        isStreaming: true,
      };
    }

    case AgentMessageType.TEXT_DELTA: {
      const msgId = resolveMessageId(state, message.msgId, "text-delta", message.timestamp);
      const ensured = ensureAssistantMessage(state, msgId, message.timestamp);
      const assistant = ensured.state.messages[ensured.index];
      if (assistant.kind !== "assistant") return ensured.state;

      const delta = message.payload.content || "";
      const nextAssistant: UIAssistantMessage = {
        ...assistant,
        content: assistant.content + delta,
        phase: "streaming",
        updatedAt: message.timestamp,
      };

      return {
        ...replaceAssistantAt(ensured.state, ensured.index, msgId, nextAssistant),
        isStreaming: true,
      };
    }

    case AgentMessageType.TEXT_COMPLETE: {
      const msgId = resolveMessageId(state, message.msgId, "text-complete", message.timestamp);
      const ensured = ensureAssistantMessage(state, msgId, message.timestamp);
      const assistant = ensured.state.messages[ensured.index];
      if (assistant.kind !== "assistant") return ensured.state;

      const nextAssistant: UIAssistantMessage = {
        ...assistant,
        phase: "completed",
        updatedAt: message.timestamp,
      };

      return {
        ...replaceAssistantAt(ensured.state, ensured.index, msgId, nextAssistant),
        isStreaming: false,
      };
    }

    case AgentMessageType.TOOL_CALL_CREATED: {
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

    case AgentMessageType.TOOL_CALL_STREAM: {
      const callId = message.payload.callId;
      if (!callId) return state;

      const nextState = withToolCallUpdate(state, {
        msgId: message.msgId,
        timestamp: message.timestamp,
        callId,
        phase: "streaming",
        updater: (tool) => ({
          ...tool,
          streamLogs: tool.streamLogs.concat(message.payload.output || ""),
        }),
      });

      return {
        ...nextState,
        isStreaming: true,
      };
    }

    case AgentMessageType.TOOL_CALL_RESULT: {
      const callId = message.payload.callId;
      if (!callId) return state;

      const nextState = withToolCallUpdate(state, {
        msgId: message.msgId,
        timestamp: message.timestamp,
        callId,
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

      return {
        ...nextState,
        isStreaming: false,
      };
    }

    case AgentMessageType.CODE_PATCH: {
      const patchId = resolveMessageId(state, message.msgId, "code-patch", message.timestamp);
      const nextMessages = state.messages.concat({
        id: patchId,
        kind: "code_patch",
        path: message.payload.path,
        diff: message.payload.diff,
        language: message.payload.language,
        createdAt: message.timestamp,
      });

      return {
        ...state,
        messages: nextMessages,
      };
    }

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

      return {
        ...state,
        messages: state.messages.concat(errorMessage),
        error: errorMessage,
        isStreaming: false,
      };
    }

    default:
      return state;
  }
}

function ensureAssistantMessage(
  state: AgentChatState,
  msgId: string,
  timestamp: number
): { state: AgentChatState; index: number } {
  const existingIndex = state.messageIndexByMsgId[msgId];
  if (existingIndex !== undefined) {
    const existingMessage = state.messages[existingIndex];
    if (existingMessage?.kind === "assistant") {
      return { state, index: existingIndex };
    }
  }

  const assistant = createAssistantMessage(msgId, timestamp);
  const nextMessages = state.messages.concat(assistant);
  const nextIndex = nextMessages.length - 1;

  return {
    state: {
      ...state,
      messages: nextMessages,
      messageIndexByMsgId: {
        ...state.messageIndexByMsgId,
        [msgId]: nextIndex,
      },
      latestAssistantMessageId: msgId,
    },
    index: nextIndex,
  };
}

function replaceAssistantAt(
  state: AgentChatState,
  index: number,
  msgId: string,
  assistant: UIAssistantMessage
): AgentChatState {
  const nextMessages = state.messages.slice();
  nextMessages[index] = assistant;
  return {
    ...state,
    messages: nextMessages,
    latestAssistantMessageId: msgId,
  };
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

interface ToolCallUpdateOptions {
  msgId?: string;
  timestamp: number;
  callId: string;
  toolName?: string;
  args?: string;
  phase?: UIAssistantMessage["phase"];
  updater: (tool: UIToolCall) => UIToolCall;
}

function withToolCallUpdate(state: AgentChatState, options: ToolCallUpdateOptions): AgentChatState {
  let targetMessageId = resolveMessageId(
    state,
    options.msgId,
    `tool-${options.callId}`,
    options.timestamp
  );
  let targetAssistantIndex: number | undefined;
  let targetToolIndex: number | undefined;
  let workingState = state;

  const existingLocator = state.toolLocatorByCallId[options.callId];
  if (existingLocator) {
    const locatedAssistantIndex = state.messageIndexByMsgId[existingLocator.messageId];
    if (locatedAssistantIndex !== undefined) {
      const locatedMessage = state.messages[locatedAssistantIndex];
      const locatedToolCall = locatedMessage?.kind === "assistant"
        ? locatedMessage.toolCalls[existingLocator.toolIndex]
        : undefined;

      if (locatedMessage?.kind === "assistant" && locatedToolCall?.callId === options.callId) {
        targetMessageId = existingLocator.messageId;
        targetAssistantIndex = locatedAssistantIndex;
        targetToolIndex = existingLocator.toolIndex;
      }
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

  if (targetToolIndex === undefined) {
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

  const currentTool = nextToolCalls[targetToolIndex];
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

  const replacedState = replaceAssistantAt(
    workingState,
    targetAssistantIndex,
    targetMessageId,
    nextAssistant
  );

  return {
    ...replacedState,
    toolLocatorByCallId: {
      ...replacedState.toolLocatorByCallId,
      [options.callId]: {
        messageId: targetMessageId,
        toolIndex: targetToolIndex,
      },
    },
  };
}

function resolveMessageId(
  state: AgentChatState,
  msgId: string | undefined,
  prefix: string,
  timestamp: number
): string {
  if (msgId) return msgId;
  return `${prefix}-${timestamp}-${state.messages.length}`;
}

function normalizeResultOutput(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function shouldSetStreamingFromStatus(status: AgentStatus, fallback: boolean): boolean {
  if (
    status === AgentStatus.IDLE
    || status === AgentStatus.COMPLETED
    || status === AgentStatus.FAILED
    || status === AgentStatus.ABORTED
  ) {
    return false;
  }

  if (
    status === AgentStatus.THINKING
    || status === AgentStatus.RUNNING
    || status === AgentStatus.RETRYING
  ) {
    return true;
  }

  return fallback;
}
