import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Agent } from "../../../../src/agent-v2/agent/agent";
import { operatorPrompt } from "../../../../src/agent-v2/prompts/operator";
import { useAgentChat } from "../agent-chat-react";
import type { UIMessage } from "../agent-chat-react/types";
import { ProviderRegistry } from "../../../../src/providers/registry";
import { buildHelpText, parseSlashCommand } from "../commands/router";
import type { CliOptions, LocalTimelineEntry, RuntimeSnapshot, TimelineEntry } from "../types";
import { createMemoryManager } from "../../../../src/agent-v2/memory";

const MAX_TOOL_OUTPUT_CHARS = 80_000;

function toTimelineEntries(messages: UIMessage[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const message of messages) {
    if (message.kind === "assistant") {
      const assistantContent = toDisplayString(message.content);
      if (assistantContent.trim()) {
        entries.push({
          id: `${message.id}:assistant`,
          type: "assistant",
          text: assistantContent,
          loading: message.phase === "streaming",
          createdAt: message.updatedAt,
        });
      }

      message.toolCalls.forEach((toolCall, index) => {
        const streamOutput = toolCall.streamLogs.map((item) => toDisplayString(item)).join("\n").trim();
        const resultOutput = toDisplayString(toolCall.result?.output);
        const output = truncateText(streamOutput || resultOutput || "", MAX_TOOL_OUTPUT_CHARS);

        entries.push({
          id: `${message.id}:tool:${toolCall.callId}`,
          type: "tool",
          toolName: toDisplayString(toolCall.toolName) || "Tool",
          args: toDisplayString(toolCall.args),
          loading: toolCall.result == null,
          status: toolCall.result?.status ?? "running",
          output,
          createdAt: message.updatedAt + index + 1,
        });
      });

      continue;
    }

    if (message.kind === "code_patch") {
      entries.push({
        id: message.id,
        type: "code_patch",
        path: message.path,
        diff: message.diff,
        createdAt: message.createdAt,
      });
      continue;
    }

    if (message.kind === "error") {
      entries.push({
        id: message.id,
        type: "error",
        error: message.error,
        phase: message.phase,
        createdAt: message.createdAt,
      });
      continue;
    }

    entries.push({
      id: message.id,
      type: "system",
      text: message.text,
      createdAt: message.createdAt,
    });
  }

  return entries;
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

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated]`;
}

export function useAgentRuntime(options: CliOptions): {
  snapshot: RuntimeSnapshot;
  submitInput: (value: string) => Promise<void>;
  abortRunning: () => void;
  requestPauseOutput: () => void;
  requestResumeOutput: () => void;
  outputControl: { seq: number; mode: "pause" | "resume" };
  shouldExit: boolean;
} {
  const {
    messages,
    status,
    isStreaming,
    ingestStreamMessage,
    reset,
    pruneMessages,
  } = useAgentChat();

  const [localEntries, setLocalEntries] = useState<LocalTimelineEntry[]>([]);
  const [displayCutoff, setDisplayCutoff] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [shouldExit, setShouldExit] = useState(false);
  const [outputControl, setOutputControl] = useState<{ seq: number; mode: "pause" | "resume" }>({
    seq: 0,
    mode: "resume",
  });
  const agentRef = useRef<Agent | null>(null);
  const isExecutingRef = useRef(false);

  const requestPauseOutput = useCallback(() => {
    setOutputControl((prev) => {
      if (prev.mode === "pause") return prev;
      return { seq: prev.seq + 1, mode: "pause" };
    });
  }, []);

  const requestResumeOutput = useCallback(() => {
    setOutputControl((prev) => {
      if (prev.mode === "resume") return prev;
      return { seq: prev.seq + 1, mode: "resume" };
    });
  }, []);

  const addLocalEntry = useCallback((type: LocalTimelineEntry["type"], text: string) => {
    setLocalEntries((prev) => prev.concat({
      id: `${type}-${Date.now()}-${prev.length}`,
      type,
      text,
      createdAt: Date.now(),
    }));
  }, []);

  const createAgent = useCallback(async () => {
      const memoryManager = createMemoryManager({
      type: 'file',
      connectionString: './data/agent-memory',
    });
    await memoryManager.initialize();

    const agent = new Agent({
      provider: ProviderRegistry.createFromEnv(options.model as never),
      systemPrompt: operatorPrompt({
        directory: options.cwd,
        language: options.language,
      }),
      stream: true,
      memoryManager,
      streamCallback: ingestStreamMessage,
    });

    agentRef.current = agent;
    setSessionId(agent.getSessionId());
    return agent;
  }, [ingestStreamMessage, options.cwd, options.language, options.model]);

  useEffect(() => {
    createAgent();
    return () => {
      agentRef.current?.abort();
    };
  }, [createAgent]);

  const abortRunning = useCallback(() => {
    if (!agentRef.current) return;
    agentRef.current.abort();
    addLocalEntry("system", "Aborted current task.");
  }, [addLocalEntry]);

  const submitInput = useCallback(async (value: string) => {
    const command = parseSlashCommand(value);

    if (command) {
      if (command.type === "help") addLocalEntry("system", buildHelpText());
      if (command.type === "clear") setDisplayCutoff(Date.now());
      if (command.type === "abort") abortRunning();
      if (command.type === "pause") {
        requestPauseOutput();
        addLocalEntry("system", "Output paused.");
      }
      if (command.type === "resume") {
        requestResumeOutput();
        addLocalEntry("system", "Output resumed.");
      }

      if (command.type === "prune") {
        const keepLast = command.keepLast ?? options.keepLastMessages;
        pruneMessages(keepLast);
        setLocalEntries((prev) => prev.slice(-keepLast));
        addLocalEntry("system", `Pruned list to latest ${keepLast} messages.`);
      }

      if (command.type === "reset") {
        reset();
        setDisplayCutoff(0);
        setLocalEntries([]);
        createAgent();
        addLocalEntry("system", "Created a new session.");
      }

      if (command.type === "exit") {
        setShouldExit(true);
      }

      return;
    }

    if (isExecutingRef.current) {
      addLocalEntry("system", "A task is already running. Press Esc or /abort first.");
      return;
    }

    isExecutingRef.current = true;
    setIsExecuting(true);

    try {
      const agent = agentRef.current ?? (await createAgent());
      addLocalEntry("user", value);
      await agent.execute(value);
      const hasSummary = agent.getMessages().some((message: any) => message.type === "summary");
      if (hasSummary) {
        pruneMessages(options.keepLastMessages);
        setLocalEntries((prev) => prev.slice(-options.keepLastMessages));
        addLocalEntry("system", `Context compacted. Kept latest ${options.keepLastMessages} messages.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLocalEntry("system", `Execute failed: ${message}`);
    } finally {
      const agent = agentRef.current;
      if (agent) {
        setSessionId(agent.getSessionId());
      }
      isExecutingRef.current = false;
      setIsExecuting(false);
    }
  }, [
    abortRunning,
    addLocalEntry,
    createAgent,
    isExecuting,
    options.keepLastMessages,
    pruneMessages,
    requestPauseOutput,
    requestResumeOutput,
    reset,
  ]);

  const timelineEntries = useMemo(() => {
    const agentEntries = toTimelineEntries(messages);
    const localTimelineEntries: TimelineEntry[] = localEntries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      text: entry.text,
      createdAt: entry.createdAt,
    }));

    return localTimelineEntries
      .concat(agentEntries)
      .filter((entry) => entry.createdAt >= displayCutoff)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }, [displayCutoff, localEntries, messages]);

  const snapshot = useMemo<RuntimeSnapshot>(() => ({
    status,
    isStreaming,
    isExecuting,
    sessionId,
    rawMessages: messages,
    timelineEntries,
  }), [status, isStreaming, isExecuting, sessionId, messages, timelineEntries]);

  return {
    snapshot,
    submitInput,
    abortRunning,
    requestPauseOutput,
    requestResumeOutput,
    outputControl,
    shouldExit,
  };
}
