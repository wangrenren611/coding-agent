import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Composer } from "./components/composer";
import { StatusBar } from "./components/status-bar";
import { Timeline } from "./components/timeline";
import { useAgentRuntime } from "./runtime/use-agent-runtime";
import type { CliOptions } from "./types";

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

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">agent-cli-ink</Text>
      <StatusBar model={options.model} snapshot={displaySnapshot} outputPaused={isOutputPaused} />
      {pausedNotice}
      <Timeline entries={displaySnapshot.timelineEntries} />
      <Composer
        disabled={runtime.snapshot.isExecuting}
        onAbort={runtime.abortRunning}
        onSubmit={runtime.submitInput}
      />
    </Box>
  );
}
