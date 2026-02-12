import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Box, Text, useApp, useInput, Static } from "ink";
import { Composer } from "./components/composer";
import { useAgentRuntime } from "./runtime/use-agent-runtime";
import { TimelineItem } from "./components/timeline-item";
import type { CliOptions, TimelineEntry } from "./types";
import Loading from "./components/loading";

// 渲染入口到纯文本
function renderEntryPlainText(entry: TimelineEntry): string {
  if (entry.type === "user") {
    return `❯ ${entry.text}`;
  }
  if (entry.type === "assistant") {
    const prefix = entry.loading ? "⏺ " : "○ ";
    return `${prefix}${entry.text}`;
  }
  if (entry.type === "system") {
    return `○ ${entry.text}`;
  }
  if (entry.type === "error") {
    return `✗ Error: ${entry.error}${entry.phase ? ` (${entry.phase})` : ""}`;
  }
  if (entry.type === "tool") {
    return `[${entry.toolName}] ${entry.args.slice(0, 30)}`;
  }
  if (entry.type === "code_patch") {
    return `Update: ${entry.path}`;
  }
  return "";
}

export function App({ options }: { options: CliOptions }): React.JSX.Element {
  const { exit } = useApp();
  const runtime = useAgentRuntime(options);
  const [isOutputPaused, setIsOutputPaused] = useState(false);

  // 固定的历史消息
  const [staticItems, setStaticItems] = useState<TimelineEntry[]>([]);
  
  // 追踪已输出到原生终端的活动消息行数
  const activeLinesCountRef = useRef(0);
  const lastActiveIdRef = useRef<string | null>(null);
  const lastActiveTextRef = useRef<string>("");

  const snapshot = runtime.snapshot;
  const entries = snapshot.timelineEntries;

  // 获取最后一条消息
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

  // 判断最后一条消息是否正在流式输出
  const isLastEntryStreaming = lastEntry &&
    (lastEntry.type === "assistant" || lastEntry.type === "tool") &&
    lastEntry.loading;

  // 处理消息输出
  useEffect(() => {
    // 1. 处理已完成的消息 -> 添加到 static
    const completedEntries = entries.filter(entry => {
      if (entry.type === "assistant" || entry.type === "tool") {
        return !entry.loading;
      }
      return true;
    });

    // 如果有新的完成消息，更新 static 并清除原生终端输出
    if (completedEntries.length !== staticItems.length) {
      // 清除原生终端的活动消息
      if (activeLinesCountRef.current > 0) {
        process.stdout.write(`\x1b[${activeLinesCountRef.current}F\x1b[0J`);
        activeLinesCountRef.current = 0;
        lastActiveIdRef.current = null;
        lastActiveTextRef.current = "";
      }
      setStaticItems([...completedEntries]);
    }

    // 2. 处理正在流式输出的消息 -> 原生终端输出（原地更新）
    if (isLastEntryStreaming && lastEntry) {
      const text = renderEntryPlainText(lastEntry);
      const lines = text.split("\n");
      const newLineCount = lines.length;

      // 如果是同一条消息的更新
      if (lastEntry.id === lastActiveIdRef.current) {
        // 清除之前的输出
        if (activeLinesCountRef.current > 0) {
          process.stdout.write(`\x1b[${activeLinesCountRef.current}F\x1b[0J`);
        }
      } else {
        // 新消息，清除之前的输出
        if (activeLinesCountRef.current > 0) {
          process.stdout.write(`\x1b[${activeLinesCountRef.current}F\x1b[0J`);
        }
        lastActiveIdRef.current = lastEntry.id;
      }

      // 输出新的内容
      process.stdout.write(`${text}\n`);
      
      lastActiveTextRef.current = text;
      activeLinesCountRef.current = newLineCount;
    } else if (activeLinesCountRef.current > 0) {
      // 流式输出结束，清除原生终端输出
      process.stdout.write(`\x1b[${activeLinesCountRef.current}F\x1b[0J`);
      activeLinesCountRef.current = 0;
      lastActiveIdRef.current = null;
      lastActiveTextRef.current = "";
    }
  }, [entries, isLastEntryStreaming, lastEntry, staticItems.length]);

  // 重置
  useEffect(() => {
    if (entries.length === 0) {
      setStaticItems([]);
      activeLinesCountRef.current = 0;
      lastActiveIdRef.current = null;
      lastActiveTextRef.current = "";
    }
  }, [entries.length]);

  useEffect(() => {
    if (runtime.shouldExit) exit();
  }, [exit, runtime.shouldExit]);

  useEffect(() => {
    if (runtime.outputControl.mode === "pause") setIsOutputPaused(true);
    if (runtime.outputControl.mode === "resume") setIsOutputPaused(false);
  }, [runtime.outputControl.mode, runtime.outputControl.seq]);

  useInput((_input: string, key: { ctrl?: boolean; s?: boolean; q?: boolean }) => {
    if (key.ctrl && key.s) {
      setIsOutputPaused(true);
      runtime.requestPauseOutput();
      return;
    }
    if (key.ctrl && key.q) {
      setIsOutputPaused(false);
      runtime.requestResumeOutput();
    }
  });

  const pausedNotice = useMemo(() => {
    if (!isOutputPaused) return null;
    return (
      <Text color="yellow">
        Output paused. Press Ctrl+Q to resume.
      </Text>
    );
  }, [isOutputPaused]);

  // 是否有活动的 assistant 消息
  const hasActiveAssistant = lastEntry?.type === "assistant" && lastEntry.loading;

  return (
    <Box flexDirection="column" marginBottom={2}>
      {pausedNotice}

      {/* 静态区域：已完成的消息 */}
      {staticItems.length > 0 && (
        <Static items={staticItems}>
          {(entry) => <TimelineItem key={entry.id} entry={entry} />}
        </Static>
      )}

      {/* 活动消息通过原生终端输出，这里不再渲染 */}

      {/* 思考指示器 */}
      {snapshot.isExecuting && !hasActiveAssistant && (
        <Box marginBottom={1} flexDirection="row" gap={1}>
          <Loading type="star" />
          <Text color="green">Thinking...</Text>
        </Box>
      )}

      {/* 输入框 */}
      <Composer
        disabled={snapshot.isExecuting}
        onAbort={runtime.abortRunning}
        onSubmit={runtime.submitInput}
      />
    </Box>
  );
}
