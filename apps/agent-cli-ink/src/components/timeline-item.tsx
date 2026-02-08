import React from "react";
import { Box, Text } from "ink";
import { SpinnerDot } from "./spinner";
import type { TimelineEntry } from "../types";
import { Markdown } from "./markdown";

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

function sanitizeForTerminal(value: string): string {
  return value.replace(/\u0000/g, "");
}

function shorten(value: unknown, maxLength = 88): string {
  const text = sanitizeForTerminal(toDisplayString(value));
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function summarizeToolOutput(value: unknown): string {
  const text = sanitizeForTerminal(toDisplayString(value));
  if (!text.trim()) return "";
  return text.split("\n").slice(0, 6).join("\n");
}

function renderDiff(diff: unknown): React.JSX.Element[] {
  const lines = sanitizeForTerminal(toDisplayString(diff)).split("\n").slice(0, 20);
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
      <Box flexDirection="row" marginBottom={1}>
        <Text color="gray">❯</Text>
        <Box marginLeft={1}>
          <Text color="gray">{sanitizeForTerminal(toDisplayString(entry.text)).trim()}</Text>
        </Box>
      </Box>
    );
  }

  if (entry.type === "assistant") {
    return (
      <Box marginBottom={1} flexDirection="row" flexShrink={0}>
        <SpinnerDot state={entry.loading ? "running" : "idle"} />
        <Box>
           <Markdown
             content={sanitizeForTerminal(toDisplayString(entry.text)).trim() || "..."}
             isStreaming={entry.loading}
           />
          {/* <Text color="#000">{sanitizeForTerminal(toDisplayString(entry.text)).trim() || "..."}</Text> */}
        </Box>
      </Box>
    );
  }

  if (entry.type === "tool") {
    const summarized = summarizeToolOutput(entry.output);
    const spinnerState = entry.loading ? "running" : entry.status === "success" ? "success" : "error";

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <SpinnerDot state={spinnerState} />
          <Text bold> {entry.toolName}({shorten(entry.args)})</Text>
        </Box>
        {summarized ? (
          <Box marginLeft={1}>
            <Text color={entry.status === "error" ? "red" : "gray"}>{summarized.trim().slice(0, 88)}</Text>
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
          <Text color="cyan"> Update({sanitizeForTerminal(toDisplayString(entry.path))})</Text>
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
          <Text color="red">{sanitizeForTerminal(toDisplayString(entry.error))}</Text>
        </Box>
        {entry.phase ? (
          <Box marginLeft={2}>
            <Text color="redBright">phase: {sanitizeForTerminal(toDisplayString(entry.phase))}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box>
      <SpinnerDot state="idle" />
      <Text color="gray">{sanitizeForTerminal(toDisplayString(entry.text))}</Text>
    </Box>
  );
}
