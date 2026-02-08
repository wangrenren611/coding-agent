import { describe, expect, it } from "vitest";
import { AgentMessageType } from "../agent-v2/agent/stream-types";
import { AgentStatus } from "../agent-v2/agent/types";
import { agentChatReducer, createInitialAgentChatState } from "./reducer";
import { selectLatestAssistantMessage } from "./selectors";
import type { AgentMessage } from "./types";

function ingest(state: ReturnType<typeof createInitialAgentChatState>, message: AgentMessage) {
  return agentChatReducer(state, { type: "INGEST_STREAM_MESSAGE", message });
}

describe("agent-chat-react reducer", () => {
  it("should upsert text stream by msgId and keep one assistant message", () => {
    let state = createInitialAgentChatState();

    state = ingest(state, {
      type: AgentMessageType.TEXT_START,
      msgId: "m1",
      payload: { content: "" },
      sessionId: "s1",
      timestamp: 1,
    });
    state = ingest(state, {
      type: AgentMessageType.TEXT_DELTA,
      msgId: "m1",
      payload: { content: "Hel" },
      sessionId: "s1",
      timestamp: 2,
    });
    state = ingest(state, {
      type: AgentMessageType.TEXT_DELTA,
      msgId: "m1",
      payload: { content: "lo" },
      sessionId: "s1",
      timestamp: 3,
    });
    state = ingest(state, {
      type: AgentMessageType.TEXT_COMPLETE,
      msgId: "m1",
      payload: { content: "" },
      sessionId: "s1",
      timestamp: 4,
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "m1",
      kind: "assistant",
      content: "Hello",
      phase: "completed",
    });
    expect(state.latestAssistantMessageId).toBe("m1");
    expect(state.isStreaming).toBe(false);
  });

  it("should bind tool stream and tool result to existing callId without msgId", () => {
    let state = createInitialAgentChatState();

    state = ingest(state, {
      type: AgentMessageType.TOOL_CALL_CREATED,
      msgId: "m-tool",
      payload: {
        content: "Checking ",
        tool_calls: [
          { callId: "call_1", toolName: "lookup", args: "{\"q\":\"release\"}" },
        ],
      },
      sessionId: "s1",
      timestamp: 10,
    });

    state = ingest(state, {
      type: AgentMessageType.TOOL_CALL_STREAM,
      payload: { callId: "call_1", output: "line-1" },
      sessionId: "s1",
      timestamp: 11,
    });

    state = ingest(state, {
      type: AgentMessageType.TOOL_CALL_RESULT,
      payload: {
        callId: "call_1",
        status: "success",
        result: { ok: true },
      },
      sessionId: "s1",
      timestamp: 12,
    });

    expect(state.messages).toHaveLength(1);
    const message = state.messages[0];
    expect(message.kind).toBe("assistant");
    if (message.kind !== "assistant") {
      throw new Error("Expected assistant message");
    }

    expect(message.id).toBe("m-tool");
    expect(message.toolCalls).toHaveLength(1);
    expect(message.toolCalls[0]).toMatchObject({
      callId: "call_1",
      toolName: "lookup",
      args: "{\"q\":\"release\"}",
      streamLogs: ["line-1"],
    });
    expect(message.toolCalls[0].result).toMatchObject({
      status: "success",
      output: "{\"ok\":true}",
    });
  });

  it("should append code patch and error messages and support clearError/reset", () => {
    let state = createInitialAgentChatState();

    state = ingest(state, {
      type: AgentMessageType.CODE_PATCH,
      msgId: "patch-1",
      payload: {
        path: "src/main.ts",
        diff: "@@ -1 +1 @@\n-old\n+new",
        language: "ts",
      },
      sessionId: "s1",
      timestamp: 20,
    });

    state = ingest(state, {
      type: AgentMessageType.ERROR,
      payload: {
        error: "boom",
        phase: "tool",
      },
      sessionId: "s1",
      timestamp: 21,
    });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      id: "patch-1",
      kind: "code_patch",
      path: "src/main.ts",
      language: "ts",
    });
    expect(state.messages[1]).toMatchObject({
      kind: "error",
      error: "boom",
      phase: "tool",
    });
    expect(state.error?.error).toBe("boom");

    state = agentChatReducer(state, { type: "CLEAR_ERROR" });
    expect(state.error).toBeNull();

    state = agentChatReducer(state, { type: "RESET" });
    expect(state).toMatchObject({
      messages: [],
      latestAssistantMessageId: null,
      isStreaming: false,
      error: null,
      status: AgentStatus.IDLE,
    });
  });

  it("should return latest assistant message via selector", () => {
    let state = createInitialAgentChatState();

    state = ingest(state, {
      type: AgentMessageType.TEXT_START,
      msgId: "a1",
      payload: { content: "" },
      sessionId: "s1",
      timestamp: 30,
    });
    state = ingest(state, {
      type: AgentMessageType.TEXT_DELTA,
      msgId: "a1",
      payload: { content: "First" },
      sessionId: "s1",
      timestamp: 31,
    });

    state = ingest(state, {
      type: AgentMessageType.TEXT_START,
      msgId: "a2",
      payload: { content: "" },
      sessionId: "s1",
      timestamp: 32,
    });
    state = ingest(state, {
      type: AgentMessageType.TEXT_DELTA,
      msgId: "a2",
      payload: { content: "Second" },
      sessionId: "s1",
      timestamp: 33,
    });

    state = ingest(state, {
      type: AgentMessageType.ERROR,
      payload: { error: "x" },
      sessionId: "s1",
      timestamp: 34,
    });

    const latest = selectLatestAssistantMessage(state);
    expect(latest?.id).toBe("a2");
    expect(latest?.content).toBe("Second");
  });

  it("should update streaming flag from status events", () => {
    let state = createInitialAgentChatState();

    state = ingest(state, {
      type: AgentMessageType.STATUS,
      payload: { state: AgentStatus.RUNNING, message: "running" },
      sessionId: "s1",
      timestamp: 40,
    });
    expect(state.status).toBe(AgentStatus.RUNNING);
    expect(state.isStreaming).toBe(true);

    state = ingest(state, {
      type: AgentMessageType.STATUS,
      payload: { state: AgentStatus.COMPLETED, message: "done" },
      sessionId: "s1",
      timestamp: 41,
    });
    expect(state.status).toBe(AgentStatus.COMPLETED);
    expect(state.isStreaming).toBe(false);
  });

  it("should prune old messages and rebuild tool locators", () => {
    let state = createInitialAgentChatState();

    state = ingest(state, {
      type: AgentMessageType.TEXT_START,
      msgId: "a1",
      payload: { content: "" },
      sessionId: "s1",
      timestamp: 50,
    });
    state = ingest(state, {
      type: AgentMessageType.TEXT_DELTA,
      msgId: "a1",
      payload: { content: "one" },
      sessionId: "s1",
      timestamp: 51,
    });

    state = ingest(state, {
      type: AgentMessageType.TOOL_CALL_CREATED,
      msgId: "a2",
      payload: {
        content: "two",
        tool_calls: [{ callId: "call_x", toolName: "bash", args: "pwd" }],
      },
      sessionId: "s1",
      timestamp: 52,
    });
    state = ingest(state, {
      type: AgentMessageType.ERROR,
      payload: { error: "oops" },
      sessionId: "s1",
      timestamp: 53,
    });

    state = agentChatReducer(state, { type: "PRUNE_MESSAGES", keepLast: 2 });
    expect(state.messages).toHaveLength(2);
    expect(state.latestAssistantMessageId).toBe("a2");
    expect(state.toolLocatorByCallId.call_x).toMatchObject({
      messageId: "a2",
      toolIndex: 0,
    });
  });
});
