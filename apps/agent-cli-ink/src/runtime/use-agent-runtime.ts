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

// 使用全局缓存确保对象引用稳定
const globalTimelineCache = new Map<string, TimelineEntry>();

function toTimelineEntries(messages: UIMessage[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const message of messages) {
    if (message.kind === "assistant") {
      const assistantContent = toDisplayString(message.content);
      if (assistantContent.trim()) {
        const entryId = `${message.id}:assistant`;
        // 检查缓存中是否已存在相同内容的条目
        const cached = globalTimelineCache.get(entryId);
        const shouldReuseEntry = cached && 
          cached.type === "assistant" &&
          cached.text === assistantContent &&
          cached.loading === (message.phase === "streaming");

        if (shouldReuseEntry) {
          entries.push(cached);
        } else {
          entries.push({
            id: entryId,
            type: "assistant",
            text: assistantContent,
            loading: message.phase === "streaming",
            createdAt: message.createdAt,
          });
          // 更新缓存
          globalTimelineCache.set(entryId, entries[entries.length - 1]);
        }
      }

      message.toolCalls.forEach((toolCall, index) => {
        const streamOutput = toolCall.streamLogs.map((item) => toDisplayString(item)).join("\n").trim();
        const resultOutput = toDisplayString(toolCall.result?.output);
        const output = truncateText(streamOutput || resultOutput || "", MAX_TOOL_OUTPUT_CHARS);

        const entryId = `${message.id}:tool:${toolCall.callId}`;
        const toolEntry: TimelineEntry = {
          id: entryId,
          type: "tool",
          toolName: toDisplayString(toolCall.toolName) || "Tool",
          args: toDisplayString(toolCall.args),
          loading: toolCall.result == null,
          status: toolCall.result?.status ?? "running",
          output,
          createdAt: message.createdAt + index + 1,
        };

        // 检查缓存
        const cached = globalTimelineCache.get(entryId);
        const shouldReuseEntry = cached && 
          cached.type === "tool" &&
          cached.toolName === toolEntry.toolName &&
          cached.args === toolEntry.args &&
          cached.loading === toolEntry.loading &&
          cached.status === toolEntry.status &&
          cached.output === toolEntry.output;

        if (shouldReuseEntry) {
          entries.push(cached);
        } else {
          entries.push(toolEntry);
          globalTimelineCache.set(entryId, toolEntry);
        }
      });

      continue;
    }

    if (message.kind === "code_patch") {
      const entryId = message.id;
      const cached = globalTimelineCache.get(entryId);
      const entry: TimelineEntry = {
        id: entryId,
        type: "code_patch",
        path: message.path,
        diff: message.diff,
        createdAt: message.createdAt,
      };

      // 简单检查：仅当 diff 变化时才更新
      if (cached && cached.type === "code_patch" && cached.diff === entry.diff) {
        entries.push(cached);
      } else {
        entries.push(entry);
        globalTimelineCache.set(entryId, entry);
      }
      continue;
    }

    if (message.kind === "error") {
      const entryId = message.id;
      const cached = globalTimelineCache.get(entryId);
      const entry: TimelineEntry = {
        id: entryId,
        type: "error",
        error: message.error,
        phase: message.phase,
        createdAt: message.createdAt,
      };

      if (cached && cached.type === "error" && cached.error === entry.error && cached.phase === entry.phase) {
        entries.push(cached);
      } else {
        entries.push(entry);
        globalTimelineCache.set(entryId, entry);
      }
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
  const isCreatingAgentRef = useRef(false);

  // 清理缓存的函数（当有新会话时）
  const clearTimelineCache = useCallback(() => {
    globalTimelineCache.clear();
  }, []);

  const ingestStreamMessageRef = useRef(ingestStreamMessage);
  ingestStreamMessageRef.current = ingestStreamMessage;

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
    while (isCreatingAgentRef.current) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (agentRef.current) {
      return agentRef.current;
    }

    isCreatingAgentRef.current = true;

    try {
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
        streamCallback: (message: any) => {
          if (agentRef.current === agent) {
            ingestStreamMessageRef.current(message);
          }
        },
      });

      agentRef.current = agent;
      setSessionId(agent.getSessionId());
      return agent;
    } finally {
      isCreatingAgentRef.current = false;
    }
  }, [options.cwd, options.language, options.model]);

  useEffect(() => {
    let isMounted = true;

    createAgent().then((agent) => {
      if (!isMounted) {
        agent.abort();
        agentRef.current = null;
      }
    });

    return () => {
      isMounted = false;
      if (agentRef.current) {
        agentRef.current.abort();
        agentRef.current = null;
      }
    };
  }, []);

  const abortRunning = useCallback(() => {
    if (!agentRef.current) return;
    agentRef.current.abort();
    addLocalEntry("system", "Aborted current task.");
  }, [addLocalEntry]);

  const submitInput = useCallback(async (value: string) => {
    const command = parseSlashCommand(value);

    if (command) {
      if (command.type === "help") addLocalEntry("system", buildHelpText());
      if (command.type === "clear") {
        setDisplayCutoff(Date.now());
        clearTimelineCache();
      }
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
        clearTimelineCache();
        // 重置时需要重新创建 agent
        if (agentRef.current) {
          agentRef.current.abort();
          agentRef.current = null;
        }
        await createAgent();
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
      const agent = await createAgent();
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
    options.keepLastMessages,
    pruneMessages,
    requestPauseOutput,
    requestResumeOutput,
    reset,
  ]);

  const timelineEntries = useMemo(() => {
    const agentEntries = toTimelineEntries(messages);
    
    // 将 localEntries 也转换为 TimelineEntry
    const localTimelineEntries: TimelineEntry[] = localEntries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      text: entry.text,
      createdAt: entry.createdAt,
    }));

    // 合并并去重（agentEntries 已经在 toTimelineEntries 中处理了去重）
    const mergedEntries = new Map<string, TimelineEntry>();
    for (const entry of agentEntries) {
      mergedEntries.set(entry.id, entry);
    }
    for (const entry of localTimelineEntries) {
      mergedEntries.set(entry.id, entry);
    }

    const deduplicatedEntries = Array.from(mergedEntries.values());

    return deduplicatedEntries
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
