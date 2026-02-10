import React, { useEffect, useMemo, useState, memo, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Composer } from "./components/composer";
import { Timeline } from "./components/timeline";
import { useAgentRuntime } from "./runtime/use-agent-runtime";
import { TimelineItem } from "./components/timeline-item";
import type { CliOptions, TimelineEntry } from "./types";
import Loading from "./components/loading";

const ThinkingIndicator = memo(function ThinkingIndicator({ isExecuting }: { isExecuting: boolean }) {
  if (!isExecuting) return null;
  return (
    <Box marginBottom={1} flexDirection="row" gap={1}>
      <Loading  type="star"/>
      <Text color="green">Think...</Text>
    </Box>
  );
});

export function App({ options }: { options: CliOptions }): React.JSX.Element {
  const { exit } = useApp();
  const runtime = useAgentRuntime(options);
  const [isOutputPaused, setIsOutputPaused] = useState(false);
  const [displaySnapshot, setDisplaySnapshot] = useState(runtime.snapshot);
  
  // 使用 ref 来跟踪最新的 runtime.snapshot，避免不必要的 useEffect 触发
  const latestSnapshotRef = useRef(runtime.snapshot);
  const updatePendingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  latestSnapshotRef.current = runtime.snapshot;

  useEffect(() => {
    if (runtime.shouldExit) exit();
  }, [exit, runtime.shouldExit]);

  useEffect(() => {
    if (runtime.outputControl.mode === "pause") setIsOutputPaused(true);
    if (runtime.outputControl.mode === "resume") setIsOutputPaused(false);
  }, [runtime.outputControl.mode, runtime.outputControl.seq]);

  // 优化的 snapshot 更新逻辑：使用 setTimeout 节流
  useEffect(() => {
    if (isOutputPaused) return;

    const scheduleUpdate = () => {
      if (updatePendingRef.current) return;
      
      updatePendingRef.current = true;
      timeoutRef.current = setTimeout(() => {
        setDisplaySnapshot(latestSnapshotRef.current);
        updatePendingRef.current = false;
      }, 0);
    };

    // 辅助函数：比较两个 TimelineEntry 是否相等
    function entryEqual(a: TimelineEntry, b: TimelineEntry): boolean {
      if (a.type !== b.type || a.id !== b.id) return false;
      // 对于流式输出，主要检查 content 字段
      if (a.type === 'assistant' && b.type === 'assistant') {
        return a.text === b.text && a.loading === b.loading;
      }
      if (a.type === 'tool' && b.type === 'tool') {
        return a.loading === b.loading && a.status === b.status && a.output === b.output;
      }
      if (a.type === 'user' || a.type === 'system') {
        return (a as any).text === (b as any).text;
      }
      if (a.type === 'code_patch') {
        return (a as any).diff === (b as any).diff;
      }
      if (a.type === 'error') {
        return (a as any).error === (b as any).error && (a as any).phase === (b as any).phase;
      }
      return false;
    }

    // 只在关键变化时触发更新
    if (
      runtime.snapshot.isStreaming !== displaySnapshot.isStreaming ||
      runtime.snapshot.isExecuting !== displaySnapshot.isExecuting ||
      runtime.snapshot.status !== displaySnapshot.status ||
      runtime.snapshot.timelineEntries.length !== displaySnapshot.timelineEntries.length ||
      (runtime.snapshot.timelineEntries.length > 0 &&
       displaySnapshot.timelineEntries.length > 0 &&
       !entryEqual(
         runtime.snapshot.timelineEntries[runtime.snapshot.timelineEntries.length - 1],
         displaySnapshot.timelineEntries[displaySnapshot.timelineEntries.length - 1]
       ))
    ) {
      scheduleUpdate();
    }

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [runtime.snapshot, displaySnapshot, isOutputPaused]);

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
        Output paused. Use terminal native scroll freely, press Ctrl+Q to resume.
      </Text>
    );
  }, [isOutputPaused]);

  // 只在最后一条消息正在加载时分离出 activeEntry
  // 关键：使用 ID 而不是对象引用来判断是否相同
  const lastEntryId = displaySnapshot.timelineEntries.length > 0 
    ? displaySnapshot.timelineEntries[displaySnapshot.timelineEntries.length - 1].id 
    : null;
    
  const lastEntry = lastEntryId 
    ? displaySnapshot.timelineEntries.find(e => e.id === lastEntryId) || null
    : null;
    
  const isLastEntryLoading = lastEntry 
    ? (lastEntry.type === "assistant" || lastEntry.type === "tool") && lastEntry.loading
    : false;

  // 如果最后一条正在加载，作为 activeEntry；否则全部显示在 Timeline 中
  const historyEntries = isLastEntryLoading && lastEntry
    ? displaySnapshot.timelineEntries.filter(e => e.id !== lastEntryId)
    : displaySnapshot.timelineEntries;

  const activeEntry = isLastEntryLoading && lastEntry ? lastEntry : null;
  const hasActiveAssistant = lastEntry?.type === "assistant";

  return (
    <Box flexDirection="column" marginBottom={2}>
      {/* <StatusBar
        model={options.model}
        snapshot={displaySnapshot}
        outputPaused={isOutputPaused}
      /> */}
      {pausedNotice}
    
      <Timeline entries={historyEntries} />
      {activeEntry && <TimelineItem key={activeEntry.id} entry={activeEntry} />}
      <ThinkingIndicator isExecuting={displaySnapshot.isExecuting && !hasActiveAssistant} />
      <Composer
        disabled={runtime.snapshot.isExecuting}
        onAbort={runtime.abortRunning}
        onSubmit={runtime.submitInput}
      />
    </Box>
  );
}
