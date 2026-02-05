/**
 * cli-tui Message List Component
 * OpenTUI-based scrollable message display
 */

import React, { useMemo } from 'react';
import type { Message, ToolInvocation } from '../types';
import { COLORS, ICONS, DISPLAY } from './theme';

interface Line {
  prefix?: string;
  content?: string;
  color?: string;
  prefixColor?: string;
  dim?: boolean;
  bold?: boolean;
  spinner?: boolean;
}

const truncate = (value: string, maxLen: number): string =>
  value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;

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

const formatToolResult = (result: string | undefined): string => {
  if (!result) return '';
  const trimmed = result.trim();
  const line = trimmed.split('\n')[0] ?? '';
  return line.length > DISPLAY.maxResultLen ? `${line.slice(0, DISPLAY.maxResultLen)}...` : line;
};

const splitLines = (content: string): string[] => {
  if (!content) return [''];
  return content.split('\n');
};

const trimTrailingEmptyLines = (lines: string[]): string[] => {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') {
    end--;
  }
  return lines.slice(0, end === 0 ? 1 : end);
};

const renderToolLines = (toolCall: ToolInvocation): Line[] => {
  const args = formatToolArgs(toolCall.args);
  const header = `${toolCall.name}${args ? `(${args})` : ''}`;
  const summary = toolCall.error || formatToolResult(toolCall.result);

  const lines: Line[] = [
    { prefix: `${ICONS.tool} `, content: header, prefixColor: COLORS.tool, color: COLORS.text, bold: true },
  ];

  if (summary) {
    const isError = !!toolCall.error;
    lines.push({
      prefix: `${ICONS.result} `,
      content: summary,
      dim: false,
      color: isError ? COLORS.system : COLORS.text,
    });
  } else if (toolCall.status === 'running') {
    lines.push({ prefix: `${ICONS.result} `, content: 'running...', color: COLORS.text });
  }

  if (toolCall.streamOutput && toolCall.status === 'running') {
    const outputLines = splitLines(toolCall.streamOutput);
    const previewLines = outputLines.slice(-DISPLAY.maxStreamLines);
    previewLines.forEach((line, idx) => {
      const isLast = idx === previewLines.length - 1;
      lines.push({
        prefix: `${ICONS.result} `,
        content: line || ' ',
        dim: !isLast,
        color: COLORS.text,
      });
    });
  }

  return lines;
};

const renderMessageLines = (message: Message): Line[] => {
  switch (message.role) {
    case 'user': {
      const lines = trimTrailingEmptyLines(splitLines(message.content));
      return lines.map((line, index) => ({
        prefix: index === 0 ? `${ICONS.user} ` : '  ',
        content: line,
        prefixColor: COLORS.user,
        color: COLORS.text,
        bold: index === 0,
      }));
    }
    case 'assistant': {
      const lines = trimTrailingEmptyLines(splitLines(message.content));
      const rendered: Line[] = lines.map((line, index) => ({
        prefix: index === 0 ? `${ICONS.assistant} ` : '  ',
        content: line,
        prefixColor: COLORS.muted,
        color: COLORS.text,
        bold: index === 0,
      }));

      if (message.isStreaming) {
        rendered.push({ spinner: true });
      }

      if (message.toolCalls && message.toolCalls.length > 0) {
        message.toolCalls.forEach(toolCall => {
          renderToolLines(toolCall).forEach(line => {
            rendered.push({
              prefix: `${line.prefix ?? ''}`,
              content: line.content,
              prefixColor: line.prefixColor,
              color: line.color || COLORS.text,
              dim: line.dim,
              bold: line.bold,
            });
          });
        });
      }

      return rendered;
    }
    case 'system': {
      const color =
        message.level === 'error'
          ? COLORS.system
          : message.level === 'warn'
            ? COLORS.warning
            : COLORS.info;

      const lines = splitLines(message.content);
      const prefix = `[${message.level?.toUpperCase() ?? 'INFO'}] `;
      const pad = ' '.repeat(prefix.length);
      const rendered: Line[] = lines.map((line, index) => ({
        prefix: index === 0 ? prefix : pad,
        content: line,
        prefixColor: color,
        color: COLORS.text,
      }));
      return rendered;
    }
    default:
      return [];
  }
};

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, isLoading = false }) => {
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
      <box paddingX={1} paddingY={1}>
        <text color={COLORS.textSecondary}>Start chatting. Type /help for commands.</text>
        <text> </text>
      </box>
    );
  }

  return (
    <scrollbox
      width="100%"
      height="100%"
      focused={false}
      scrollY={true}
      stickyScroll={true}
      stickyStart="bottom"
      verticalScrollbarOptions={{
        showArrows: true,
        trackOptions: {
          borderStyle: 'classic',
        },
      }}
    >
      <box flexDirection="column">
        {lines.map((line, idx) => (
          <box key={idx} flexDirection="row">
            {line.spinner ? (
              <text color={COLORS.warning}>{ICONS.thinking}</text>
            ) : (
              <>
                {line.prefix && (
                  <text color={line.prefixColor ?? COLORS.muted} bold={line.bold}>
                    {line.prefix}
                  </text>
                )}
                {line.content !== undefined && (
                  <text color={line.color ?? COLORS.text} dimColor={line.dim} bold={line.bold && !line.prefix}>
                    {line.content || ' '}
                  </text>
                )}
              </>
            )}
          </box>
        ))}
      </box>
    </scrollbox>
  );
};
