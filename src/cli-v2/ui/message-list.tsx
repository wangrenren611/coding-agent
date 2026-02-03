import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { Message, ToolInvocation, CodePatch } from '../state/types';
import { COLORS, ICONS, DISPLAY } from './theme';
import Spinner from 'ink-spinner';

interface Line {
  prefix?: string;
  content?: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  spinner?: boolean;  // Special flag for spinner line
}

const truncate = (value: string, maxLen: number): string => (
  value.length > maxLen ? `${value.slice(0, maxLen)}...` : value
);

const safeStringify = (value: unknown, maxDepth = DISPLAY.maxSafeDepth): string | undefined => {
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return '[Circular]';
    if (depth >= maxDepth) return Array.isArray(input) ? `[Array(${input.length})]` : '[Object]';
    seen.add(input);

    if (Array.isArray(input)) {
      return input.map(item => walk(item, depth + 1));
    }

    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      output[key] = walk(val, depth + 1);
    }
    return output;
  };

  try {
    return JSON.stringify(walk(value, 0));
  } catch {
    return undefined;
  }
};

const previewValue = (value: unknown, maxLen: number): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return truncate(value, maxLen);
  if (typeof value === 'object') {
    const json = safeStringify(value);
    if (json !== undefined) return truncate(json, maxLen);
  }
  return truncate(String(value), maxLen);
};

const formatToolArgs = (args: Record<string, unknown>): string => {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return '';
  const [key, value] = entries[0];
  const preview = previewValue(value, DISPLAY.maxPreviewLen);
  return `${key}=${preview}${entries.length > 1 ? ',...' : ''}`;
};

const formatToolResult = (result: unknown): string => {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') {
    const line = result.trim().split('\n')[0] ?? '';
    return line.length > DISPLAY.maxResultLen ? `${line.slice(0, DISPLAY.maxResultLen)}...` : line;
  }
  if (typeof result === 'object') {
    const entries = Object.entries(result as Record<string, unknown>);
    if (entries.length === 0) return '';
    const [key, value] = entries[0];
    return `${key}: ${previewValue(value, DISPLAY.maxResultLen)}`;
  }
  return String(result).slice(0, DISPLAY.maxResultLen);
};

const splitLines = (content: string): string[] => {
  if (!content) return [''];
  return content.split('\n');
};

// Trim redundant blank lines at the tail to avoid large vertical gaps
const trimTrailingEmptyLines = (lines: string[]): string[] => {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') {
    end--;
  }
  return lines.slice(0, end === 0 ? 1 : end);
};

/**
 * Render tool invocation with optional stream output
 */
const renderToolLines = (toolCall: ToolInvocation): Line[] => {
  const args = formatToolArgs(toolCall.args);
  const header = `${toolCall.name}${args ? `(${args})` : ''}`;
  const summary = toolCall.error ? toolCall.error : formatToolResult(toolCall.result);

  const lines: Line[] = [
    { prefix: `${ICONS.tool} `, content: header, color: COLORS.tool, bold: true },
  ];

  if (summary) {
    lines.push({ prefix: `${ICONS.result} `, content: summary, dim: false, color: COLORS.muted });
  } else if (toolCall.status === 'running') {
    lines.push({ prefix: `${ICONS.result} `, content: 'running...', color: COLORS.warning });
  }

  // Show stream output if available (for running tools)
  if (toolCall.streamOutput && toolCall.status === 'running') {
    const outputLines = splitLines(toolCall.streamOutput);
    // Show last few lines of stream output
    const previewLines = outputLines.slice(-DISPLAY.maxStreamLines);
    previewLines.forEach((line, idx) => {
      const isLast = idx === previewLines.length - 1;
      lines.push({
        prefix: `${ICONS.result} `,
        content: line || ' ',
        dim: !isLast,
        color: COLORS.muted,
      });
    });
  }

  return lines;
};

/**
 * Parse and render code patch as colored diff
 */
const renderCodePatchLines = (patch: CodePatch): Line[] => {
  const lines: Line[] = [
    { prefix: `${ICONS.diff} `, content: `Patch: ${patch.path}`, color: COLORS.diff, bold: true },
  ];

  // Parse unified diff format
  const diffLines = splitLines(patch.diff);
  for (const line of diffLines) {
    if (line.startsWith('@@')) {
      // Hunk header
      lines.push({
        prefix: '  ',
        content: line,
        color: COLORS.info,
        dim: true,
      });
    } else if (line.startsWith('+')) {
      // Added line
      lines.push({
        prefix: '  ',
        content: line,
        color: COLORS.diffAdd,
      });
    } else if (line.startsWith('-')) {
      // Removed line
      lines.push({
        prefix: '  ',
        content: line,
        color: COLORS.diffRemove,
      });
    } else if (line.startsWith(' ')) {
      // Context line
      lines.push({
        prefix: '  ',
        content: line,
        dim: true,
      });
    }
  }

  return lines;
};

const renderMessageLines = (message: Message): Line[] => {
  switch (message.type) {
    case 'user': {
      const lines = trimTrailingEmptyLines(splitLines(message.content));
      return lines.map((line, index) => ({
        prefix: index === 0 ? `${ICONS.user} ` : '  ',
        content: line,
        color: COLORS.user,
        bold: index === 0,
      }));
    }
    case 'assistant': {
      const lines = trimTrailingEmptyLines(splitLines(message.content));
      const rendered: Line[] = lines.map((line, index) => ({
        prefix: index === 0 ? `${ICONS.assistant} ` : '  ',
        content: line,
        color:  COLORS.assistant,
        bold: index === 0,
      }));

      if (message.status === 'streaming') {
        rendered.push({ spinner: true });
      }

      // Render tool calls
      if (message.toolCalls && message.toolCalls.length > 0) {
        // rendered.push({  dim: true, color: COLORS.muted });
        message.toolCalls.forEach(toolCall => {
          renderToolLines(toolCall).forEach(line => {
            rendered.push({
              prefix: `${line.prefix ?? ''}`,
              content: line.content,
              color: line.color,
              dim: line.dim,
              bold: line.bold,
            });
          });
        });
      }

      // Render code patches
      if (message.codePatches && message.codePatches.length > 0) {
        rendered.push({ prefix: '  ', content: 'Changes:', dim: true, color: COLORS.muted });
        message.codePatches.forEach(patch => {
          renderCodePatchLines(patch).forEach(line => {
            rendered.push({
              prefix: `  ${line.prefix ?? ''}`,
              content: line.content,
              color: line.color,
              dim: line.dim,
              bold: line.bold,
            });
          });
        });
      }

      return rendered;
    }
    case 'system': {
      const color = message.level === 'error'
        ? COLORS.system
        : message.level === 'warn'
          ? COLORS.warning
          : COLORS.info;

      const lines = splitLines(message.content);
      const prefix = `[${message.level.toUpperCase()}] `;
      const pad = ' '.repeat(prefix.length);
      const rendered: Line[] = lines.map((line, index) => ({
        prefix: index === 0 ? prefix : pad,
        content: line,
        color,
      }));
      if (message.details) {
        rendered.push({ prefix: '  ', content: message.details, dim: true, color: COLORS.muted });
      }
      return rendered;
    }
    default:
      return [];
  }
};

interface MessageListProps {
  messages: Message[];
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  const lines = useMemo(() => {
    const result: Line[] = [];
    messages.forEach(message => {
      result.push(...renderMessageLines(message));
      result.push({ content: '' });
    });
    return result;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {/* <Text dimColor>Start chatting. Type /help for commands.</Text> */}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, idx) => (
        <Box key={idx} flexDirection="row">
          {line.spinner ? (
            <Text color={COLORS.warning}>
              <Spinner type="dots" />
            </Text>
          ) : (
            <Text color={line.color} dimColor={line.dim} bold={line.bold}>
              {line.prefix || ''}{line.content || ' '}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};
