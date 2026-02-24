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

/** 工具流日志最大块数 */
const MAX_TOOL_STREAM_CHUNKS = 400;
/** 工具流日志最大字符数 */
const MAX_TOOL_STREAM_CHARS = 120_000;
/** 工具结果最大字符数 */
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
    case AgentMessageType.REASONING_START:
    case AgentMessageType.REASONING_DELTA:
    case AgentMessageType.REASONING_COMPLETE:
      return ingestReasoningEvent(state, message);
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
    case AgentMessageType.USAGE_UPDATE:
      return ingestUsageUpdate(state, message);
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
    case AgentMessageType.SUBAGENT_EVENT: {
      // 子 Agent 事件冒泡 - 当前 UI 不处理，直接返回原状态
      // 可以在这里添加对子 Agent 事件的 UI 展示逻辑
      return state;
    }
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
      return state;
    }
  }
}

function ingestReasoningEvent(
  state: AgentChatState,
  message: Extract<AgentMessage, { type: AgentMessageType.REASONING_START | AgentMessageType.REASONING_DELTA | AgentMessageType.REASONING_COMPLETE }>
): AgentChatState {
  const msgId = resolveTextMessageId(state, {
    type: message.type === AgentMessageType.REASONING_START
      ? AgentMessageType.TEXT_START
      : message.type === AgentMessageType.REASONING_COMPLETE
        ? AgentMessageType.TEXT_COMPLETE
        : AgentMessageType.TEXT_DELTA,
    msgId: message.msgId,
    payload: { content: message.payload.content },
    sessionId: message.sessionId,
    timestamp: message.timestamp,
  });

  const ensured = ensureAssistantMessage(state, msgId, message.timestamp);
  const assistant = ensured.state.messages[ensured.index];
  if (assistant.kind !== "assistant") return ensured.state;

  const incomingReasoning = message.payload.content || "";
  const nextReasoning = message.type === AgentMessageType.REASONING_DELTA
    ? mergeTextDelta(assistant.reasoning, incomingReasoning)
    : mergeTextComplete(assistant.reasoning, incomingReasoning);

  const nextAssistant: UIAssistantMessage = {
    ...assistant,
    reasoning: nextReasoning,
    updatedAt: message.type === AgentMessageType.REASONING_COMPLETE
      ? message.timestamp
      : assistant.updatedAt,
  };

  return {
    ...replaceAssistantAt(ensured.state, ensured.index, msgId, nextAssistant),
    isStreaming: message.type !== AgentMessageType.REASONING_COMPLETE || state.isStreaming,
  };
}

function ingestTextEvent(state: AgentChatState, message: Extract<AgentMessage, { type: AgentMessageType.TEXT_START | AgentMessageType.TEXT_DELTA | AgentMessageType.TEXT_COMPLETE }>): AgentChatState {
  const msgId = resolveTextMessageId(state, message);
  
  const ensured = ensureAssistantMessage(state, msgId, message.timestamp);
  const assistant = ensured.state.messages[ensured.index];
  if (assistant.kind !== "assistant") return ensured.state;
  const incomingContent = message.payload.content || "";

  // 对于流式输出，只在 TEXT_COMPLETE 时更新 updatedAt
  const shouldUpdateTimestamp = message.type === AgentMessageType.TEXT_COMPLETE;
  
  const nextAssistant: UIAssistantMessage = {
    ...assistant,
    content: message.type === AgentMessageType.TEXT_DELTA
      ? mergeTextDelta(assistant.content, incomingContent)
      : mergeTextComplete(assistant.content, incomingContent),
    phase: message.type === AgentMessageType.TEXT_COMPLETE ? "completed" : "streaming",
    updatedAt: shouldUpdateTimestamp ? message.timestamp : assistant.updatedAt,
  };

  return {
    ...replaceAssistantAt(ensured.state, ensured.index, msgId, nextAssistant),
    isStreaming: message.type !== AgentMessageType.TEXT_COMPLETE,
  };
}

function ingestUsageUpdate(
  state: AgentChatState,
  message: Extract<AgentMessage, { type: AgentMessageType.USAGE_UPDATE }>
): AgentChatState {
  const targetMsgId = message.msgId || state.latestAssistantMessageId || resolveMessageId(state, undefined, "usage", message.timestamp);
  const ensured = ensureAssistantMessage(state, targetMsgId, message.timestamp);
  const assistant = ensured.state.messages[ensured.index];
  if (assistant.kind !== "assistant") return ensured.state;

  const nextAssistant: UIAssistantMessage = {
    ...assistant,
    usage: message.payload.usage,
    cumulativeUsage: message.payload.cumulative,
    updatedAt: message.timestamp,
  };

  return replaceAssistantAt(ensured.state, ensured.index, targetMsgId, nextAssistant);
}

/**
 * 解析文本消息 ID
 * 处理流式消息的 ID 复用逻辑，确保同一消息的多个 chunk 使用相同的 ID
 */
function resolveTextMessageId(
  state: AgentChatState,
  message: Extract<AgentMessage, { type: AgentMessageType.TEXT_START | AgentMessageType.TEXT_DELTA | AgentMessageType.TEXT_COMPLETE }>
): string {
  const latestId = state.latestAssistantMessageId;
  const latestIndex = latestId ? state.messageIndexByMsgId[latestId] : undefined;
  const latestMessage = latestIndex !== undefined ? state.messages[latestIndex] : undefined;

  // 如果有明确的 msgId
  if (message.msgId) {
    // 检查是否已存在此 msgId
    const existingIndex = state.messageIndexByMsgId[message.msgId];
    if (existingIndex !== undefined) return message.msgId;

    // 新的 msgId：应该创建新消息，不复用旧消息
    return message.msgId;
  }

  // 没有 msgId 的情况
  // 如果有上一条 assistant 消息
  if (latestId && latestMessage?.kind === "assistant") {
    // 如果还在流式输出，继续使用
    if (latestMessage.phase === "streaming") {
      return latestId;
    }
    // 如果已完成但内容为空，复用
    if (!latestMessage.content.trim()) {
      return latestId;
    }
  }

  // 创建新消息
  if (message.type === AgentMessageType.TEXT_START) {
    return resolveMessageId(state, undefined, "text", message.timestamp);
  }

  return latestId || resolveMessageId(state, undefined, "text", message.timestamp);
}

/**
 * 合并文本增量
 * 处理不同 LLM 提供商的流式输出差异
 * 
 * 策略：
 * 1. 如果 incoming 以 current 开头（累积快照），使用 incoming
 * 2. 否则简单追加（增量模式）
 */
function mergeTextDelta(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;

  // 检测累积快照模式：如果 incoming 以 current 开头，说明是累积内容
  if (incoming.startsWith(current)) return incoming;
  
  // 检测回退：如果 current 以 incoming 开头，可能是重新发送
  if (current.startsWith(incoming)) return current;

  // 增量模式：简单追加
  return current + incoming;
}

/**
 * 合并文本完成事件
 */
function mergeTextComplete(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;

  const merged = mergeTextDelta(current, incoming);

  // Completion event should prefer the richest content.
  if (incoming.length >= merged.length) return incoming;

  return merged;
}

/**
 * 查找两个字符串的后缀/前缀重叠长度
 */
function findSuffixPrefixOverlap(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  for (let size = max; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return size;
  }
  return 0;
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
    const toolName = toDisplayString(toolCall.toolName);
    const args = toDisplayString(toolCall.args);
    const existingIndex = nextToolCalls.findIndex((item) => item.callId === callId);
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

/**
 * 将任意值转换为显示字符串
 */
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

/**
 * 追加工具流日志，带截断限制
 */
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

/**
 * 截断文本
 */
function truncateText(value: string | null, limit: number): string | null {
  if (value == null || value.length <= limit) return value;
  const head = value.slice(0, limit);
  return `${head}\n...[truncated]`;
}
