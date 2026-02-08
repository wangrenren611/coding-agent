import React, { memo } from "react";
import { Box, Text } from "ink";
import type { RuntimeSnapshot } from "../types";

function shortSessionId(value: string): string {
  if (!value) return "pending";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export const StatusBar = memo(function StatusBar({
  model,
  snapshot,
  outputPaused,
}: {
  model: string;
  snapshot: RuntimeSnapshot;
  outputPaused: boolean;
}): React.JSX.Element {
  return (
    <Box marginBottom={1}>
      <Text color="gray">
        model={model} | status={snapshot.status} | streaming={snapshot.isStreaming ? "yes" : "no"} | running=
        {snapshot.isExecuting ? "yes" : "no"} | paused={outputPaused ? "yes" : "no"} | session=
        {shortSessionId(snapshot.sessionId)} | messages=
        {snapshot.rawMessages.length}
      </Text>
    </Box>
  );
}, (prevProps, nextProps) => {
  // 只在关键属性变化时才重新渲染
  return (
    prevProps.model === nextProps.model &&
    prevProps.snapshot.status === nextProps.snapshot.status &&
    prevProps.snapshot.isStreaming === nextProps.snapshot.isStreaming &&
    prevProps.snapshot.isExecuting === nextProps.snapshot.isExecuting &&
    prevProps.outputPaused === nextProps.outputPaused &&
    prevProps.snapshot.sessionId === nextProps.snapshot.sessionId &&
    prevProps.snapshot.rawMessages.length === nextProps.snapshot.rawMessages.length
  );
});
