/** @jsxImportSource @opentui/react */
/**
 * Prompt 组件 - 用户输入 (React 版本)
 */
import React, { useState, useRef, useEffect, useImperativeHandle, useCallback, forwardRef, useMemo } from 'react';
import { useKeyboard } from '@opentui/react';
import type { TextareaRenderable } from '@opentui/core';
import { useTheme } from '../context/theme';
import { useAgent } from '../context/agent';
import { AgentStatus } from '../../agent-v2';

export interface PromptRef {
    focused: boolean;
    value: string;
    focus: () => void;
    blur: () => void;
    clear: () => void;
    submit: () => void;
}

export interface PromptProps {
    visible?: boolean;
    disabled?: boolean;
    onSubmit?: () => void;
    placeholder?: string;
}

const PROMPT_TEXTAREA_KEYBINDINGS = [
    { name: 'return', action: 'submit' as const },
    { name: 'linefeed', action: 'submit' as const },
    { name: 'return', shift: true, action: 'newline' as const },
    { name: 'linefeed', shift: true, action: 'newline' as const },
];

export const Prompt = forwardRef<PromptRef, PromptProps>((props: PromptProps, ref) => {
    const { theme } = useTheme();
    const agent = useAgent();
    const [input, setInput] = useState('');
    const [textareaKey, setTextareaKey] = useState(0);
    const [focused, setFocused] = useState(true);
    const textareaRef = useRef<TextareaRenderable | null>(null);
    const submittingRef = useRef(false);

    const isRunning = () =>
        agent.state.status === AgentStatus.RUNNING ||
        agent.state.status === AgentStatus.THINKING ||
        agent.state.status === AgentStatus.RETRYING;

    const getInputValue = (): string => {
        if (textareaRef.current?.plainText !== undefined) {
            return textareaRef.current.plainText;
        }
        return input;
    };

    const focusInput = useCallback(() => {
        textareaRef.current?.focus?.();
        setFocused(true);
    }, []);

    const resetInput = useCallback(() => {
        textareaRef.current?.clear?.();
        setInput('');
        // Force remount textarea to guarantee internal buffer is empty.
        setTextareaKey((k) => k + 1);
    }, []);

    const handleSubmit = async () => {
        if (submittingRef.current) return;
        const value = getInputValue()
            .replace(/\r?\n$/, '')
            .trim();
        if (!value) return;

        submittingRef.current = true;
        // Clear immediately after submit so UI reflects "message sent" right away.
        resetInput();
        focusInput();
        try {
            props.onSubmit?.();
            await agent.sendMessage(value);
        } finally {
            submittingRef.current = false;
        }
    };

    useKeyboard((e) => {
        if (props.disabled) return;

        if ((e.name === 'return' || e.name === 'linefeed') && !e.shift) {
            void handleSubmit();
            return;
        }

        if (e.name === 'c' && e.ctrl) {
            if (isRunning()) {
                agent.abort();
            }
            return;
        }

        if (e.name === 'escape') {
            if (isRunning()) {
                agent.abort();
            } else {
                resetInput();
            }
            return;
        }
    });

    useImperativeHandle(
        ref,
        () => ({
            get focused() {
                return focused;
            },
            get value() {
                return getInputValue();
            },
            focus() {
                textareaRef.current?.focus?.();
                setFocused(true);
            },
            blur() {
                textareaRef.current?.blur?.();
                setFocused(false);
            },
            clear() {
                resetInput();
            },
            submit() {
                handleSubmit();
            },
        }),
        [focused, getInputValue, focusInput, resetInput]
    );

    useEffect(() => {
        if (props.visible !== false) {
            focusInput();
        }
    }, [props.visible, focusInput]);

    useEffect(() => {
        if (!isRunning()) {
            focusInput();
        }
    }, [agent.state.status, focusInput]);

    const borderColor = focused ? theme.borderActive : theme.border;
    const statusText = useMemo(() => {
        if (!isRunning()) return 'Ready';
        if (agent.state.status === AgentStatus.RETRYING && agent.state.retryInfo) {
            const { attempt, max, delayMs, reason } = agent.state.retryInfo;
            const delaySec = Math.ceil(delayMs / 1000);
            const reasonShort = reason ? ` (${reason.slice(0, 30)}${reason.length > 30 ? '...' : ''})` : '';
            return `● retrying ${attempt}/${max} in ${delaySec}s${reasonShort}`;
        }
        return `● ${agent.state.status}`;
    }, [agent.state.status, agent.state.retryInfo]);

    const handleContentChange = () => {
        if (textareaRef.current?.plainText !== undefined) {
            setInput(textareaRef.current.plainText);
        }
    };

    return (
        <box
            width="100%"
            border={['top', 'right', 'bottom', 'left']}
            borderColor={borderColor}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={0}
            paddingBottom={0}
            backgroundColor={theme.backgroundElement}
            flexDirection="column"
            minHeight={3}
            flexShrink={0}
        >
            <textarea
                key={textareaKey}
                ref={textareaRef}
                width="100%"
                initialValue={input}
                keyBindings={PROMPT_TEXTAREA_KEYBINDINGS}
                onContentChange={handleContentChange}
                onSubmit={handleSubmit}
                placeholder={props.placeholder ?? 'Type message... (@path for image/video/file, Enter send)'}
                placeholderColor={theme.textMuted}
                textColor={theme.text}
                focusedTextColor={theme.text}
                minHeight={1}
                maxHeight={4}
                focused={focused}
            />

            <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>{isRunning() ? 'Esc interrupt' : 'Esc clear'}</text>
                <text fg={isRunning() ? theme.warning : theme.textMuted}>{statusText}</text>
                <text fg={theme.textMuted}>Enter send</text>
            </box>
        </box>
    );
});

Prompt.displayName = 'Prompt';
