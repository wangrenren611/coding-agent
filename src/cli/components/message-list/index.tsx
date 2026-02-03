/**
 * Message List Component - Claude Code / Kimi CLI Style
 *
 * 视觉风格：
 * - 用户: ❯ message (青色)
 * - 助手: ● message (绿色)
 * - 工具: ● ToolName(args) → 结果 (黄色图标)
 * - 结果: ⎿ result (灰色缩进)
 */

import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { UIMessage, ToolInvocation, AssistantTextMessage, AssistantToolMessage } from '../../types/message-types';
import MarkdownText from './MarkdownText';

// =============================================================================
// 样式常量 - Claude Code 风格
// =============================================================================

const COLORS = {
  user: 'cyan',
  assistant: 'green',
  tool: 'yellow',
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'blue',
  muted: 'gray',
  result: 'gray',
} as const;

const ICONS = {
  user: '❯',
  assistant: '●',
  tool: '●',
  result: '⎿',
  success: '✓',
  error: '✗',
  pending: '◐',
  running: '◑',
  ellipsis: '…',
  arrow: '→',
} as const;

// =============================================================================
// 辅助函数
// =============================================================================

/**
 * 格式化工具参数为简短描述
 */
function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  const argMap: Record<string, (args: Record<string, unknown>) => string> = {
    read_file: (a) => String(a.filePath || ''),
    Read: (a) => String(a.file_path || ''),
    Glob: (a) => String(a.pattern || ''),
    Grep: (a) => String(a.pattern || ''),
    grep: (a) => String(a.pattern || ''),
    bash: (a) => String(a.command || '').slice(0, 60),
    Bash: (a) => String(a.command || '').slice(0, 60),
    StrReplaceFile: (a) => String(a.path || ''),
    WriteFile: (a) => String(a.path || ''),
    write_file: (a) => String(a.filePath || ''),
    FetchURL: (a) => String(a.url || '').slice(0, 50),
    web_fetch: (a) => String(a.url || '').slice(0, 50),
    SearchWeb: (a) => String(a.query || '').slice(0, 50),
    web_search: (a) => String(a.query || '').slice(0, 50),
    lsp: (a) => `${a.action} ${a.symbol || ''}`.slice(0, 50),
  };

  const formatter = argMap[toolName];
  if (formatter) {
    const result = formatter(args);
    return result ? `(${result})` : '';
  }

  // 通用参数格式化
  const entries = Object.entries(args).filter(([_, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';

  const firstEntry = entries[0];
  const value = String(firstEntry[1]).slice(0, 40);
  return `(${firstEntry[0]}=${value}${entries.length > 1 ? '...' : ''})`;
}

/**
 * 格式化工具结果为单行摘要
 */
function formatToolResult(result: unknown, toolName: string): string {
  if (result === undefined || result === null) {
    return '';
  }

  if (typeof result === 'string') {
    const trimmed = result.trim();
    if (trimmed.length === 0) return 'Done';
    const singleLine = trimmed.split('\n')[0];
    return singleLine.length > 80 ? singleLine.slice(0, 80) + ICONS.ellipsis : singleLine;
  }

  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;

    // 处理错误结果
    if ('success' in obj && obj.success === false) {
      return `Error: ${obj.error || 'Unknown error'}`;
    }

    // 处理成功结果
    if ('data' in obj) {
      return formatToolResult(obj.data, toolName);
    }

    if ('content' in obj) {
      return formatToolResult(obj.content, toolName);
    }

    // 文件操作成功提示
    if (toolName.includes('write') || toolName.includes('Write') || toolName.includes('replace')) {
      return 'File updated';
    }

    if (toolName.includes('read') || toolName.includes('Read')) {
      const lines = Object.entries(obj).find(([k]) => k.includes('line') || k === 'content');
      if (lines) {
        const content = String(lines[1]);
        const firstLine = content.split('\n')[0];
        return firstLine.length > 80 ? firstLine.slice(0, 80) + ICONS.ellipsis : firstLine || 'File read';
      }
      return 'File read';
    }

    // 通用对象
    const entries = Object.entries(obj).slice(0, 2);
    if (entries.length > 0) {
      return entries.map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(', ');
    }
  }

  return String(result).slice(0, 80);
}

/**
 * 获取工具状态颜色
 */
function getToolStatusColor(status: ToolInvocation['status']): string {
  switch (status) {
    case 'pending':
      return COLORS.muted;
    case 'running':
      return COLORS.warning;
    case 'success':
      return COLORS.tool;
    case 'error':
      return COLORS.error;
    default:
      return COLORS.muted;
  }
}

// =============================================================================
// 子组件
// =============================================================================

/**
 * 用户消息组件 - ❯ message
 */
interface UserMessageProps {
  content: string;
}

const UserMessage: React.FC<UserMessageProps> = ({ content }) => {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="row">
        <Text color={COLORS.user} bold>
          {ICONS.user}{' '}
        </Text>
        <Box flexDirection="column" flexGrow={1}>
          {content.split('\n').map((line, i) => (
            <Text key={i} color={COLORS.user} wrap="end">
              {line || ' '}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

/**
 * 助手文本消息组件 - ● message
 */
interface AssistantTextMessageProps {
  message: AssistantTextMessage;
}

const AssistantTextMessageView: React.FC<AssistantTextMessageProps> = ({
  message,
}) => {
  const content = message.content;
  const isStreaming = message.status === 'streaming';

  if (!content && !isStreaming) {
    return null;
  }

  // 单行短消息：紧凑显示
  if (content && !content.includes('\n') && content.length < 100 && !isStreaming) {
    return (
      <Box flexDirection="row" marginY={1}>
        <Text color={COLORS.assistant} bold>{ICONS.assistant} </Text>
        <Text>{content}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="row">
        <Text color={COLORS.assistant} bold>{ICONS.assistant} </Text>
        <Box flexDirection="column" flexGrow={1}>
          {isStreaming ? (
            <Box flexDirection="column">
              <Text>{content}</Text>
              <Text color={COLORS.warning}>{ICONS.running}</Text>
            </Box>
          ) : (
            <MarkdownText content={content} />
          )}
        </Box>
      </Box>
    </Box>
  );
};

/**
 * 单个工具调用项组件 - ● ToolName(args) / ⎿ result
 */
interface ToolCallItemProps {
  toolCall: ToolInvocation;
  isLast: boolean;
}

const ToolCallItem: React.FC<ToolCallItemProps> = ({ toolCall }) => {
  const { name, args, status, result, error, duration } = toolCall;
  const argStr = formatToolArgs(name, args);
  const statusColor = getToolStatusColor(status);

  // 结果摘要
  const resultSummary = error
    ? error
    : (status === 'success' ? formatToolResult(result, name) : '');

  const isDone = status === 'success' || status === 'error';

  return (
    <Box flexDirection="column">
      {/* 工具调用行: ● ToolName(args) */}
      <Box flexDirection="row">
        <Text color={statusColor} bold>{ICONS.tool} </Text>
        <Text bold color={COLORS.tool}>{name}</Text>
        {argStr && (
          <Text dimColor>{argStr}</Text>
        )}
        {duration !== undefined && isDone && (
          <Text dimColor> {duration}ms</Text>
        )}
      </Box>

      {/* 结果行: ⎿ result */}
      {resultSummary && (
        <Box flexDirection="row">
          <Text color={COLORS.result}>{ICONS.result} </Text>
          <Text dimColor wrap="end">
            {resultSummary}
          </Text>
        </Box>
      )}

      {/* 运行中指示 */}
      {status === 'running' && (
        <Box flexDirection="row">
          <Text color={COLORS.result}>{ICONS.result} </Text>
          <Text color={COLORS.warning}>{ICONS.running} Running...</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * 助手工具调用消息组件
 */
interface AssistantToolMessageProps {
  message: AssistantToolMessage;
}

const AssistantToolMessageView: React.FC<AssistantToolMessageProps> = ({ message }) => {
  const { content, toolCalls, status } = message;
  const isStreaming = status === 'streaming';

  return (
    <Box flexDirection="column" marginY={1}>
      {/* 前置文本内容（如果有） */}
      {content && (
        <Box flexDirection="row" marginBottom={1}>
          <Text color={COLORS.assistant} bold>{ICONS.assistant} </Text>
          <Box flexGrow={1}>
            <MarkdownText content={content} />
          </Box>
        </Box>
      )}

      {/* 工具调用列表 */}
      <Box flexDirection="column">
        {toolCalls.map((toolCall) => (
          <ToolCallItem
            key={toolCall.id}
            toolCall={toolCall}
            isLast={false}
          />
        ))}
      </Box>

      {/* 流式指示器 */}
      {isStreaming && toolCalls.some(tc => tc.status === 'running') && (
        <Box flexDirection="row" marginTop={1}>
          <Text color={COLORS.warning}>{ICONS.running} Processing...</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * 系统消息组件
 */
interface SystemMessageProps {
  level: 'info' | 'warn' | 'error';
  content: string;
  details?: string;
}

const SystemMessage: React.FC<SystemMessageProps> = ({ level, content, details }) => {
  const color = (COLORS as Record<string, string>)[level] || COLORS.muted;

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Box flexDirection="row">
        <Text color={color} bold>[{level.toUpperCase()}]</Text>
        <Text> {content}</Text>
      </Box>
      {details && (
        <Text dimColor>  {details}</Text>
      )}
    </Box>
  );
};

/**
 * 加载指示器组件
 */
interface LoadingIndicatorProps {
  step?: number;
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ step }) => {
  return (
    <Box flexDirection="row" marginY={1}>
      <Text color={COLORS.assistant} bold>{ICONS.assistant} </Text>
      <Text>Thinking{step ? ` (step ${step})` : ''}...</Text>
    </Box>
  );
};

/**
 * 单个消息渲染组件
 */
const MessageItem: React.FC<{ message: UIMessage }> = ({ message }) => {
  switch (message.type) {
    case 'user':
      return <UserMessage content={message.content} />;

    case 'assistant-text':
      if (!message.content || message.content.trim() === '') {
        return null;
      }
      return <AssistantTextMessageView message={message} />;

    case 'assistant-tool':
      return <AssistantToolMessageView message={message} />;

    case 'system':
      return (
        <SystemMessage
          level={message.level}
          content={message.content}
          details={message.details}
        />
      );

    default:
      return null;
  }
};

// =============================================================================
// 主组件
// =============================================================================

interface MessageListProps {
  messages: UIMessage[];
  isLoading?: boolean;
  currentStep?: number;
  error?: { message: string; phase: string } | null;
  showHistory?: boolean;
  onToggleHistory?: () => void;
  maxMessages?: number;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading = false,
  currentStep = 0,
  error,
  maxMessages = 100,
}) => {
  const { stdout } = useStdout();

  // 根据终端高度动态计算可见消息数量
  // 预留空间给：输入框(3行) + 活跃状态(2行) + padding(2行) + 边界(2行)
  const terminalHeight = stdout.rows || 24;
  const availableHeight = terminalHeight - 9; // 约计算每条消息平均占用 3-4 行
  const dynamicMaxMessages = maxMessages > 0 ? maxMessages : Math.max(10, Math.floor(availableHeight / 3));

  const items = useMemo(() => {
    if (messages.length > dynamicMaxMessages) {
      return messages.slice(-dynamicMaxMessages);
    }
    return messages;
  }, [messages, dynamicMaxMessages]);

  const isWaitingForAssistant = items.length > 0 && items[items.length - 1].type === 'user';

  // 计算被截断的消息数量
  const truncatedCount = Math.max(0, messages.length - items.length);

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {/* 显示截断提示 */}
      {truncatedCount > 0 && (
        <Box flexDirection="row" marginBottom={1}>
          <Text dimColor>... ({truncatedCount} earlier messages hidden)</Text>
        </Box>
      )}

      {/* 消息列表 */}
      {items.map((message) => (
        <Box key={message.id}>
          <MessageItem message={message} />
        </Box>
      ))}

      {/* 活跃状态 */}
      <Box flexDirection="column" marginTop={1}>
        {(isLoading || isWaitingForAssistant) && (
          <LoadingIndicator step={currentStep > 0 ? currentStep : undefined} />
        )}

        {error && (
          <Box flexDirection="column" marginY={1}>
            <SystemMessage level="error" content={error.message} details={error.phase} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default MessageList;
