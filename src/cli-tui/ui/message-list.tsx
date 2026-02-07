/**
 * cli-tui Message List Component
 * Aligned, clean text-first conversation rendering.
 */

import React from 'react';
import type { Message, ToolInvocation } from '../types';
import { COLORS, DISPLAY, ICONS } from './theme';

const HIDE_THINK = process.env.CLI_TUI_HIDE_THINK === '1';

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

const formatToolResult = (result?: string): string => {
  if (!result) return '';
  const firstLine = (result.trim().split('\n')[0] ?? '').trim();
  return truncate(firstLine, DISPLAY.maxResultLen);
};

const stripThinkBlocks = (content: string): string => {
  if (!HIDE_THINK) return content;
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const normalizeMessageContent = (message: Message): string => {
  const content = message.content || '';
  const cleaned = message.role === 'assistant' ? stripThinkBlocks(content) : content.trim();
  return cleaned || (message.role === 'assistant' && message.isStreaming ? '...' : '');
};

const normalizeLines = (content: string): string[] => {
  if (!content) return [];
  const lines = content.split('\n');
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;

  const trimmed = lines.slice(start, end);
  if (trimmed.length <= DISPLAY.maxMessageLines) return trimmed;

  const kept = trimmed.slice(0, DISPLAY.maxMessageLines);
  const omitted = trimmed.length - DISPLAY.maxMessageLines;
  kept.push(`[... ${omitted} lines omitted ...]`);
  return kept;
};

const firstNonEmptyArg = (args: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const buildToolLeadText = (tool: ToolInvocation): string => {
  const description = firstNonEmptyArg(tool.args, ['description', 'task', 'prompt']);
  if (description) return truncate(description, 80);

  const command = firstNonEmptyArg(tool.args, ['command', 'cmd']);
  if (command) return `执行命令: ${truncate(command, 72)}`;

  const path = firstNonEmptyArg(tool.args, ['path', 'file', 'target']);
  if (path) return `处理文件: ${truncate(path, 72)}`;

  const query = firstNonEmptyArg(tool.args, ['query', 'pattern', 'search']);
  if (query) return `搜索: ${truncate(query, 72)}`;

  return `正在执行 ${tool.name}...`;
};

const fallbackAssistantLeadText = (message: Message): string => {
  if (message.role !== 'assistant' || !message.toolCalls?.length) return '';
  return buildToolLeadText(message.toolCalls[0]);
};

const toolStatusColor = (tool: ToolInvocation): string => {
  if (tool.status === 'error') return COLORS.toolError;
  if (tool.status === 'success') return COLORS.toolSuccess;
  return COLORS.toolRunning;
};

const toolStatusText = (tool: ToolInvocation): string => {
  if (tool.status === 'error') return 'failed';
  if (tool.status === 'success') return 'done';
  return 'running...';
};

const renderTool = (tool: ToolInvocation, key: string) => {
  const args = formatToolArgs(tool.args);
  const header = `${tool.name}${args ? `(${args})` : ''}`;
  const summary = tool.error || formatToolResult(tool.result);
  const status = toolStatusText(tool);
  const outputPreview = (tool.streamOutput ?? '')
    .split('\n')
    .filter(Boolean)
    .slice(-DISPLAY.maxStreamLines)
    .join('\n');

  return (
    <box key={key} flexDirection="column" paddingLeft={2}>
      <box flexDirection="row">
        <text fg={toolStatusColor(tool)}>{ICONS.tool}</text>
        <text fg={COLORS.text}> {header}</text>
        <text fg={COLORS.textMuted}> {status}</text>
      </box>
      {summary ? (
        <box paddingLeft={2}>
          <text fg={tool.error ? COLORS.error : COLORS.textMuted}>{ICONS.result} {summary}</text>
        </box>
      ) : null}
      {tool.status === 'running' && outputPreview ? (
        <box paddingLeft={2}>
          <text fg={COLORS.muted}>{`| ${outputPreview}`}</text>
        </box>
      ) : null}
    </box>
  );
};

const roleColor = (message: Message): string => {
  if (message.role === 'user') return COLORS.user;
  if (message.role === 'assistant') return COLORS.assistant;
  if (message.level === 'error') return COLORS.error;
  if (message.level === 'warn') return COLORS.warning;
  return COLORS.info;
};

const roleIcon = (message: Message): string => {
  if (message.role === 'user') return ICONS.user;
  if (message.role === 'assistant') return ICONS.assistant;
  return ICONS.info;
};

const renderMessage = (message: Message) => {
  const content = normalizeMessageContent(message);
  const displayContent = content || fallbackAssistantLeadText(message);
  const color = roleColor(message);
  const lines = normalizeLines(displayContent);
  const firstLine = lines[0] ?? '';
  const restLines = lines.slice(1);

  return (
    <box key={message.id} flexDirection="column">
      <box flexDirection="row">
        <text fg={color}>{roleIcon(message)}</text>
        <text fg={message.role === 'system' ? color : COLORS.text}> {firstLine || ' '}</text>
        {message.role === 'assistant' && message.isStreaming ? (
          <text fg={COLORS.warning}> {ICONS.thinking}</text>
        ) : null}
      </box>

      {restLines.length > 0
        ? restLines.map((line, idx) => (
            <box key={`${message.id}-line-${idx}`} paddingLeft={2}>
              <text fg={message.role === 'system' ? color : COLORS.text}>{line || ' '}</text>
            </box>
          ))
        : null}

      {message.role === 'assistant' && message.toolCalls?.length
        ? message.toolCalls.map((tool, idx) => renderTool(tool, `${message.id}-tool-${tool.id}-${idx}`))
        : null}

      {Array.from({ length: DISPLAY.messageGapLines }).map((_, idx) => (
        <text key={`${message.id}-gap-${idx}`}> </text>
      ))}
    </box>
  );
};

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  showScrollbar?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, showScrollbar = false }) => {
  if (messages.length === 0) {
    return (
      <box flexDirection="column" paddingTop={1}>
        <text fg={COLORS.text}>你好，我是 Q。</text>
        <text fg={COLORS.textMuted}>我可以帮你写代码、改代码、运行命令和排查问题。</text>
        <text> </text>
        <text fg={COLORS.textMuted}>可用命令: /help /clear /model /models /status /stop /exit</text>
      </box>
    );
  }

  return (
    <scrollbox
      width="100%"
      height="100%"
      focused={false}
      scrollY={true}
      stickyScroll={false}
      horizontalScrollbarOptions={{
        visible: false,
        minWidth: 0,
        maxWidth: 0,
        width: 0,
        showArrows: false,
      }}
      verticalScrollbarOptions={{
        visible: showScrollbar,
        minWidth: showScrollbar ? 1 : 0,
        maxWidth: showScrollbar ? 1 : 0,
        width: showScrollbar ? 1 : 0,
        showArrows: false,
      }}
    >
      <box flexDirection="column">
        {messages.map(renderMessage)}
      </box>
    </scrollbox>
  );
};
