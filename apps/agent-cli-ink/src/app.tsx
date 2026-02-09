import React, { useEffect, useMemo, useState, memo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Composer } from "./components/composer";
import { Timeline } from "./components/timeline";
import { useAgentRuntime } from "./runtime/use-agent-runtime";
import { TimelineItem } from "./components/timeline-item";
import type { CliOptions, TimelineEntry } from "./types";
import Loading from "./components/loading";

// 只渲染历史消息的 Timeline
const HistoryTimeline = memo(function HistoryTimeline({ entries }: { entries: TimelineEntry[] }) {
  return <Timeline entries={entries} />;
}, (prevProps, nextProps) => {
  // 只有当历史消息数量变化时才重新渲染
  return prevProps.entries.length === nextProps.entries.length;
});

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

  useEffect(() => {
    if (runtime.shouldExit) exit();
  }, [exit, runtime.shouldExit]);

  useEffect(() => {
    if (runtime.outputControl.mode === "pause") setIsOutputPaused(true);
    if (runtime.outputControl.mode === "resume") setIsOutputPaused(false);
  }, [runtime.outputControl.mode, runtime.outputControl.seq]);

  useEffect(() => {
    if (!isOutputPaused) {
      setDisplaySnapshot(runtime.snapshot);
    }
  }, [isOutputPaused, runtime.snapshot]);

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

  // 分离历史消息和当前正在流式输出的消息
  const { historyEntries, activeEntry, hasActiveAssistant } = useMemo(() => {
    if (displaySnapshot.timelineEntries.length === 0) {
      return { historyEntries: [], activeEntry: null, hasActiveAssistant: false };
    }

    const lastEntry = displaySnapshot.timelineEntries[displaySnapshot.timelineEntries.length - 1];
    const isLoading = (lastEntry.type === "assistant" || lastEntry.type === "tool") && lastEntry.loading;

    if (isLoading) {
      return {
        historyEntries: displaySnapshot.timelineEntries.slice(0, -1),
        activeEntry: lastEntry,
        hasActiveAssistant: lastEntry.type === "assistant",
      };
    }

    return {
      historyEntries: displaySnapshot.timelineEntries,
      activeEntry: null,
      hasActiveAssistant: false,
    };
  }, [displaySnapshot.timelineEntries]);

  return (
    <Box flexDirection="column" marginBottom={2}>
      {/* <StatusBar
        model={options.model}
        snapshot={displaySnapshot}
        outputPaused={isOutputPaused}
      /> */}
      {pausedNotice}
    
      <HistoryTimeline entries={historyEntries} />
      {activeEntry && <TimelineItem entry={activeEntry} />}
      <ThinkingIndicator isExecuting={displaySnapshot.isExecuting && !hasActiveAssistant} />
      <Composer
        disabled={runtime.snapshot.isExecuting}
        onAbort={runtime.abortRunning}
        onSubmit={runtime.submitInput}
      />
    </Box>
  );
}
