import React from "react";
import { Box, Text } from "ink";
import { SpinnerDot } from "./spinner";
import type { TimelineEntry } from "../types";

function shorten(value: string, maxLength = 88): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function summarizeToolOutput(value: string): string {
  if (!value.trim()) return "";
  return value.split("\n").slice(0, 6).join("\n");
}

function renderDiff(diff: string): React.JSX.Element[] {
  const lines = diff.split("\n").slice(0, 20);
  return lines.map((line, index) => {
    if (line.startsWith("+")) return <Text key={index} color="green">{line}</Text>;
    if (line.startsWith("-")) return <Text key={index} color="red">{line}</Text>;
    if (line.startsWith("@@")) return <Text key={index} color="yellow">{line}</Text>;
    return <Text key={index} color="gray">{line}</Text>;
  });
}

export function TimelineItem({ entry }: { entry: TimelineEntry }): React.JSX.Element {
  if (entry.type === "user") {
    return (
      <Box>
        <Text color="gray">❯ {entry.text}</Text>
      </Box>
    );
  }

  if (entry.type === "assistant") {
    return (
      <Box>
        <SpinnerDot state={entry.loading ? "running" : "idle"} />
        <Text color="gray"> {entry.text || "..."}</Text>
      </Box>
    );
  }

  if (entry.type === "tool") {
    const summarized = summarizeToolOutput(entry.output);
    const spinnerState = entry.loading ? "running" : entry.status === "success" ? "success" : "error";

    return (
      <Box flexDirection="column">
        <Box>
          <SpinnerDot state={spinnerState} />
          <Text bold> {entry.toolName}({shorten(entry.args)})</Text>
        </Box>
        {summarized ? (
          <Box marginLeft={2}>
            <Text color={entry.status === "error" ? "red" : "gray"}>{summarized}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  if (entry.type === "code_patch") {
    return (
      <Box flexDirection="column">
        <Box>
          <SpinnerDot state="idle" />
          <Text color="cyan"> Update({entry.path})</Text>
        </Box>
        <Box marginLeft={2} flexDirection="column">
          {renderDiff(entry.diff)}
        </Box>
      </Box>
    );
  }

  if (entry.type === "error") {
    return (
      <Box flexDirection="column">
        <Box>
          <SpinnerDot state="error" />
          <Text color="red"> {entry.error}</Text>
        </Box>
        {entry.phase ? (
          <Box marginLeft={2}>
            <Text color="redBright">phase: {entry.phase}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box>
      <SpinnerDot state="idle" />
      <Text color="gray"> {entry.text}</Text>
    </Box>
  );
}
