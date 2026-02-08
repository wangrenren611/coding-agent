import React from "react";
import { Box, Text } from "ink";
import type { RuntimeSnapshot } from "../types";

function shortSessionId(value: string): string {
  if (!value) return "pending";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function StatusBar({
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
}
