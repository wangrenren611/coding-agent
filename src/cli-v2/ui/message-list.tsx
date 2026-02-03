import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Message, ToolInvocation } from '../state/types';
import { COLORS, ICONS } from './theme';

interface Line {
  prefix?: string;
  content: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

const truncate = (value: string, maxLen: number): string => (
  value.length > maxLen ? `${value.slice(0, maxLen)}...` : value
);

const safeStringify = (value: unknown, maxDepth = 2): string | undefined => {
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
  const preview = previewValue(value, 50);
  return `${key}=${preview}${entries.length > 1 ? ',...' : ''}`;
};

const formatToolResult = (result: unknown): string => {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') {
    const line = result.trim().split('\n')[0] ?? '';
    return line.length > 80 ? `${line.slice(0, 80)}...` : line;
  }
  if (typeof result === 'object') {
    const entries = Object.entries(result as Record<string, unknown>);
    if (entries.length === 0) return '';
    const [key, value] = entries[0];
    return `${key}: ${previewValue(value, 80)}`;
  }
  return String(result).slice(0, 80);
};

const splitLines = (content: string): string[] => {
  if (!content) return [''];
  return content.split('\n');
};

const renderToolLines = (toolCall: ToolInvocation): Line[] => {
  const args = formatToolArgs(toolCall.args);
  const header = `${toolCall.name}${args ? `(${args})` : ''}`;
  const summary = toolCall.error ? toolCall.error : formatToolResult(toolCall.result);

  const lines: Line[] = [
    { prefix: `${ICONS.tool} `, content: header, color: COLORS.tool, bold: true },
  ];

  if (summary) {
    lines.push({ prefix: `${ICONS.result} `, content: summary, dim: true, color: COLORS.muted });
  } else if (toolCall.status === 'running') {
    lines.push({ prefix: `${ICONS.result} `, content: 'running...', color: COLORS.warning });
  }

  return lines;
};

const renderMessageLines = (message: Message): Line[] => {
  switch (message.type) {
    case 'user': {
      const lines = splitLines(message.content);
      return lines.map((line, index) => ({
        prefix: index === 0 ? `${ICONS.user} ` : '  ',
        content: line,
        color: COLORS.user,
        bold: index === 0,
      }));
    }
    case 'assistant': {
      const lines = splitLines(message.content);
      const rendered: Line[] = lines.map((line, index) => ({
        prefix: index === 0 ? `${ICONS.assistant} ` : '  ',
        content: line,
        color: COLORS.assistant,
        bold: index === 0,
      }));

      if (message.status === 'streaming') {
        rendered.push({ prefix: `${ICONS.running} `, content: 'streaming...', color: COLORS.warning });
      }

      if (message.toolCalls && message.toolCalls.length > 0) {
        rendered.push({ prefix: '  ', content: 'Tools:', dim: true, color: COLORS.muted });
        message.toolCalls.forEach(toolCall => {
          renderToolLines(toolCall).forEach(line => {
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
  height?: number;
  scrollEnabled?: boolean;
  scrollCommand?: { id: number; action: 'up' | 'down' | 'top' | 'bottom' } | null;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  height,
  scrollEnabled = true,
  scrollCommand,
}) => {
  const { stdout } = useStdout();
  const fallbackHeight = Math.max(6, (stdout.rows || 24) - 6);
  const viewHeight = height ?? fallbackHeight;
  const maxWidth = Math.max(20, (stdout.columns || 80) - 2);

  const lines = useMemo(() => {
    const result: Line[] = [];
    messages.forEach(message => {
      result.push(...renderMessageLines(message));
      result.push({ content: '' });
    });
    return result;
  }, [messages]);

  const { wrappedLines, hasScrollbar, contentWidth } = useMemo(() => {
    const baseWrapped = wrapLines(lines, maxWidth);
    const needsScrollbar = baseWrapped.length > viewHeight;
    const nextWidth = needsScrollbar ? Math.max(10, maxWidth - 1) : maxWidth;
    return {
      wrappedLines: needsScrollbar ? wrapLines(lines, nextWidth) : baseWrapped,
      hasScrollbar: needsScrollbar,
      contentWidth: nextWidth,
    };
  }, [lines, maxWidth, viewHeight]);

  const [scrollOffset, setScrollOffset] = useState(0);
  const pinnedRef = useRef(true);

  const maxOffset = Math.max(0, wrappedLines.length - viewHeight);

  useEffect(() => {
    if (pinnedRef.current) {
      setScrollOffset(0);
      return;
    }
    setScrollOffset(offset => {
      const next = Math.min(offset, maxOffset);
      pinnedRef.current = next === 0;
      return next;
    });
  }, [wrappedLines.length, maxOffset]);

  useEffect(() => {
    setScrollOffset(offset => {
      const next = Math.min(offset, maxOffset);
      pinnedRef.current = next === 0;
      return next;
    });
  }, [viewHeight, maxOffset]);

  useInput((input, key) => {
    if (!scrollEnabled) return;

    if (key.pageUp || (key.ctrl && input === 'u')) {
      setScrollOffset(offset => {
        const next = Math.min(offset + viewHeight, maxOffset);
        pinnedRef.current = next === 0;
        return next;
      });
    }

    if (key.pageDown || (key.ctrl && input === 'd')) {
      setScrollOffset(offset => {
        const next = Math.max(0, offset - viewHeight);
        pinnedRef.current = next === 0;
        return next;
      });
    }

    if (key.home) {
      setScrollOffset(maxOffset);
      pinnedRef.current = false;
    }

    if (key.end) {
      setScrollOffset(0);
      pinnedRef.current = true;
    }
  }, { isActive: scrollEnabled });

  useEffect(() => {
    if (!scrollCommand) return;
    const action = scrollCommand.action;
    if (action === 'up') {
      setScrollOffset(offset => {
        const next = Math.min(offset + viewHeight, maxOffset);
        pinnedRef.current = next === 0;
        return next;
      });
      return;
    }

    if (action === 'down') {
      setScrollOffset(offset => {
        const next = Math.max(0, offset - viewHeight);
        pinnedRef.current = next === 0;
        return next;
      });
      return;
    }

    if (action === 'top') {
      setScrollOffset(maxOffset);
      pinnedRef.current = false;
      return;
    }

    if (action === 'bottom') {
      setScrollOffset(0);
      pinnedRef.current = true;
    }
  }, [scrollCommand?.id, scrollCommand?.action, maxOffset, viewHeight]);

  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text dimColor>Start chatting. Type /help for commands.</Text>
      </Box>
    );
  }

  const effectiveHeight = Math.max(1, viewHeight);
  const sliceStart = Math.max(0, wrappedLines.length - effectiveHeight - scrollOffset);
  const sliceEnd = Math.max(0, wrappedLines.length - scrollOffset);
  const visibleLines = wrappedLines.slice(sliceStart, sliceEnd);
  const scrollbar = hasScrollbar ? buildScrollbar(viewHeight, wrappedLines.length, scrollOffset) : null;

  return (
    <Box flexDirection="column" paddingX={1}>
      {visibleLines.map((line, index) => (
        <Box key={`${sliceStart}-${index}-${line.content}`} flexDirection="row">
          <Box width={contentWidth}>
            <Text
              color={line.color}
              dimColor={line.dim}
              bold={line.bold}
              wrap="truncate"
            >
              {(line.prefix ?? '') + (line.content || ' ')}
            </Text>
          </Box>
          {hasScrollbar ? (
            <Text dimColor>{scrollbar?.[index] ?? ' '}</Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
};

const wrapLines = (lines: Line[], width: number): Line[] => {
  const wrapped: Line[] = [];

  lines.forEach(line => {
    const prefix = line.prefix ?? '';
    const prefixWidth = stringWidth(prefix);
    const maxContentWidth = Math.max(1, width - prefixWidth);
    const chunks = wrapContent(line.content, maxContentWidth);

    chunks.forEach((chunk, index) => {
      wrapped.push({
        prefix: index === 0 ? prefix : ' '.repeat(prefixWidth),
        content: chunk,
        color: line.color,
        dim: line.dim,
        bold: line.bold && index === 0,
      });
    });
  });

  return wrapped;
};

const buildScrollbar = (viewHeight: number, totalLines: number, scrollOffset: number): string[] => {
  if (totalLines <= viewHeight) {
    return Array.from({ length: viewHeight }, () => ' ');
  }

  const maxOffset = Math.max(0, totalLines - viewHeight);
  const thumbSize = Math.max(1, Math.round((viewHeight * viewHeight) / totalLines));
  const trackSize = Math.max(1, viewHeight - thumbSize);
  const thumbTop = maxOffset === 0
    ? 0
    : Math.round(((maxOffset - scrollOffset) * trackSize) / maxOffset);

  return Array.from({ length: viewHeight }, (_, index) => (
    index >= thumbTop && index < thumbTop + thumbSize ? '█' : '│'
  ));
};

const wrapContent = (text: string, width: number): string[] => {
  if (width <= 0) return [''];
  if (!text) return [''];

  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const char of text) {
    const charWidth = stringWidth(char);
    if (currentWidth + charWidth > width && current.length > 0) {
      lines.push(current);
      current = char;
      currentWidth = charWidth;
      continue;
    }
    current += char;
    currentWidth += charWidth;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
};

const stringWidth = (text: string): number => {
  let width = 0;
  for (const char of text) {
    width += isFullWidth(char) ? 2 : 1;
  }
  return width;
};

const isFullWidth = (char: string): boolean => {
  const code = char.codePointAt(0);
  if (!code) return false;
  return (
    code >= 0x1100 &&
    (
      code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd)
    )
  );
};
