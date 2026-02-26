/** @jsxImportSource @opentui/react */
/**
 * Message 组件 - 消息显示 (React 版本)
 */
import React, { useState, useMemo } from 'react';
import { useTheme } from '../context/theme';
import { type ChatMessage, type MessagePart } from '../context/agent';
import { AgentStatus } from '../../agent-v2';
import stripAnsi from 'strip-ansi';

interface MessageProps {
    message: ChatMessage;
}

export function Message({ message }: MessageProps) {
    const { theme } = useTheme();

    const isUser = message.role === 'user';
    const borderColor = isUser ? theme.accent : theme.primary;

    // 构建状态和 usage 文本
    const statusText = useMemo(() => {
        if (isUser || message.status === AgentStatus.IDLE) return null;

        let text: string = message.status;
        if (message.usage) {
            text += ` | ${message.usage.prompt_tokens} prompt + ${message.usage.completion_tokens} completion = ${message.usage.total_tokens} tokens`;
        }
        return text;
    }, [isUser, message.status, message.usage]);

    const roleLabel = isUser ? 'You' : 'Assistant';
    const roleColor = isUser ? theme.accent : theme.primary;
    const hasVisibleParts = message.parts.length > 0;
    const showThinkingPlaceholder =
        !isUser &&
        !hasVisibleParts &&
        (message.status === AgentStatus.THINKING ||
            message.status === AgentStatus.RUNNING ||
            message.status === AgentStatus.RETRYING);

    return (
        <box
            width="100%"
            border={['top', 'right', 'bottom', 'left']}
            borderColor={borderColor}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            marginTop={0}
            marginBottom={1}
            backgroundColor={isUser ? theme.backgroundElement : theme.backgroundPanel}
            flexDirection="column"
            flexShrink={0}
        >
            {/* 角色标识 */}
            <text fg={roleColor}>
                <strong>{roleLabel}</strong>
            </text>

            {/* 消息内容 */}
            <box flexDirection="column" marginTop={1} width="100%">
                {hasVisibleParts ? (
                    message.parts.map((part, index) => <MessagePartComponent key={part.id || index} part={part} />)
                ) : showThinkingPlaceholder ? (
                    <text fg={theme.textMuted}>thinking...</text>
                ) : null}
            </box>

            {/* 状态和元信息 */}
            {statusText && !showThinkingPlaceholder && (
                <box marginTop={1}>
                    <text fg={theme.textMuted}>{statusText}</text>
                </box>
            )}
        </box>
    );
}

function MessagePartComponent({ part }: { part: MessagePart }) {
    switch (part.type) {
        case 'text':
            return <TextPart content={part.content} />;
        case 'reasoning':
            return <ReasoningPart content={part.content} />;
        case 'tool-call':
            return <ToolCallPart part={part} />;
        case 'tool-result':
            return <ToolResultPart part={part} />;
        case 'code-patch':
            return <CodePatchPart part={part} />;
        case 'subagent':
            return <SubagentPart part={part} />;
        default:
            return null;
    }
}

function TextPart({ content }: { content: string }) {
    const { theme } = useTheme();

    return (
        <text fg={theme.text} width="100%" wrapMode="word">
            {content}
        </text>
    );
}

function ReasoningPart({ content }: { content: string }) {
    const { theme } = useTheme();

    if (!content.trim()) return null;

    return (
        <box
            border={['left']}
            borderColor={theme.border}
            paddingLeft={1}
            marginTop={1}
            flexDirection="column"
            backgroundColor={theme.backgroundElement}
        >
            <text fg={theme.textMuted} width="100%" wrapMode="word">
                {'Thinking: ' + content}
            </text>
        </box>
    );
}

function ToolCallPart({ part }: { part: MessagePart }) {
    const { theme } = useTheme();

    // 获取状态图标字符
    const statusIcon = () => {
        switch (part.status) {
            case 'pending':
                return '○';
            case 'success':
                return '●';
            case 'error':
                return '✗';
            default:
                return '○';
        }
    };

    // 获取状态图标颜色
    const statusColor = () => {
        switch (part.status) {
            case 'pending':
                return theme.warning;
            case 'success':
                return theme.success;
            case 'error':
                return theme.error;
            default:
                return theme.textMuted;
        }
    };

    const toolText = `${statusIcon()} ${part.toolName}${part.toolArgs ? ` ${truncateText(part.toolArgs, 100)}` : ''}`;
    const hasSubagent = !!part.subagent;
    const subagentStatusText =
        part.subagentStatus === 'completed' ? 'completed' : part.subagentStatus === 'error' ? 'failed' : 'running';

    return (
        <box marginTop={1} flexDirection="column" width="100%">
            <text fg={statusColor()}>{toolText}</text>
            {hasSubagent && (
                <box
                    marginTop={1}
                    border={['left']}
                    borderColor={theme.primary}
                    paddingLeft={1}
                    flexDirection="column"
                    backgroundColor={theme.backgroundElement}
                >
                    <text fg={theme.primary}>
                        ↳ subagent {part.subagent!.subagentType} ({subagentStatusText})
                    </text>
                    <text fg={theme.textMuted}>
                        task: {part.subagent!.taskId.slice(0, 12)}... | session:{' '}
                        {part.subagent!.childSessionId.slice(-8)}
                    </text>
                    {(part.subagentParts || []).map((subPart, index) => (
                        <MessagePartComponent key={`${part.id}-sub-${subPart.id}-${index}`} part={subPart} />
                    ))}
                </box>
            )}
        </box>
    );
}

function SubagentPart({ part }: { part: MessagePart }) {
    const { theme } = useTheme();
    if (!part.subagent) return null;

    const statusText =
        part.subagentStatus === 'completed' ? 'completed' : part.subagentStatus === 'error' ? 'failed' : 'running';

    return (
        <box
            marginTop={1}
            border={['left']}
            borderColor={theme.primary}
            paddingLeft={1}
            flexDirection="column"
            backgroundColor={theme.backgroundElement}
        >
            <text fg={theme.primary}>
                ↳ subagent {part.subagent.subagentType} ({statusText})
            </text>
            <text fg={theme.textMuted}>
                task: {part.subagent.taskId.slice(0, 12)}... | session: {part.subagent.childSessionId.slice(-8)}
            </text>
            {(part.subagentParts || []).map((subPart, index) => (
                <MessagePartComponent key={`${part.id}-fallback-${subPart.id}-${index}`} part={subPart} />
            ))}
        </box>
    );
}

function ToolResultPart({ part }: { part: MessagePart }) {
    const { theme } = useTheme();
    const [expanded, setExpanded] = useState(false);

    const resultText = useMemo(() => formatToolResult(stripAnsi(part.toolResult || '')), [part.toolResult]);
    const normalizedText = useMemo(() => clampLongLines(resultText, 140), [resultText]);
    const isLong = normalizedText.split('\n').length > 12;

    const displayText = useMemo(() => {
        const lines = normalizedText.split('\n');
        if (expanded || !isLong) {
            return normalizedText;
        }
        return [...lines.slice(0, 12), '...'].join('\n');
    }, [normalizedText, expanded, isLong]);

    const borderColor = part.status === 'error' ? theme.error : theme.border;
    const textColor = part.status === 'error' ? theme.error : theme.textMuted;

    return (
        <box
            marginTop={1}
            border={['left']}
            borderColor={borderColor}
            paddingLeft={1}
            flexDirection="column"
            backgroundColor={theme.backgroundElement}
        >
            <text fg={textColor} width="100%" wrapMode="word">
                {displayText}
            </text>
            {isLong && (
                <text fg={theme.accent} onMouseUp={() => setExpanded(!expanded)}>
                    {expanded ? 'Show less' : 'Show more'}
                </text>
            )}
        </box>
    );
}

function CodePatchPart({ part }: { part: MessagePart }) {
    const { theme } = useTheme();
    const header = part.patchLanguage
        ? `Patch ${part.patchPath || ''} (${part.patchLanguage})`
        : `Patch ${part.patchPath || ''}`;
    const patchText = stripAnsi(part.content || '');
    const lines = patchText.split('\n');
    const preview = lines.length > 18 ? [...lines.slice(0, 18), '...'].join('\n') : patchText;

    return (
        <box
            marginTop={1}
            border={['left']}
            borderColor={theme.accent}
            paddingLeft={1}
            flexDirection="column"
            backgroundColor={theme.backgroundElement}
        >
            <text fg={theme.accent}>{header}</text>
            <text fg={theme.textMuted} width="100%" wrapMode="word">
                {preview}
            </text>
        </box>
    );
}

function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
}

function formatToolResult(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        return raw;
    }

    try {
        const parsed = JSON.parse(trimmed) as {
            result?: { output?: unknown; metadata?: { command?: unknown }; success?: unknown };
            metadata?: { command?: unknown };
            output?: unknown;
        };

        const output =
            typeof parsed.result?.output === 'string'
                ? parsed.result.output
                : typeof parsed.output === 'string'
                  ? parsed.output
                  : null;

        const command =
            typeof parsed.result?.metadata?.command === 'string'
                ? parsed.result.metadata.command
                : typeof parsed.metadata?.command === 'string'
                  ? parsed.metadata.command
                  : null;

        if (!output && !command) {
            return raw;
        }

        if (command && output) {
            return `$ ${command}\n${output}`;
        }

        return output || raw;
    } catch {
        return raw;
    }
}

function clampLongLines(text: string, maxLineLength: number): string {
    return text
        .split('\n')
        .map((line) => {
            if (line.length <= maxLineLength) return line;
            return `${line.slice(0, maxLineLength)}...`;
        })
        .join('\n');
}
