/**
 * cli-tui Input Bar Component
 * OpenTUI-based text input with history and keyboard shortcuts
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { COLORS, ICONS, KEY_BINDINGS } from './theme';

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  isActive?: boolean;
  maxHistory?: number;
}

export const InputBar: React.FC<InputBarProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type your message...',
  isActive = true,
  maxHistory = 200,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');

  useEffect(() => {
    if (value !== localValue) {
      setLocalValue(value);
    }
  }, [value, localValue]);

  const commitValue = useCallback(
    (nextValue: string) => {
      setLocalValue(nextValue);
      onChange(nextValue);
    },
    [onChange]
  );

  const resetHistoryNav = useCallback(() => {
    setHistoryIndex(-1);
    draftRef.current = '';
  }, []);

  const pushHistory = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      const history = historyRef.current;
      if (history[0] === trimmed) return;
      historyRef.current = [trimmed, ...history].slice(0, maxHistory);
    },
    [maxHistory]
  );

  const handleSubmit = useCallback(
    (submittedValue: string) => {
      const trimmed = submittedValue.trim();
      if (!trimmed) return;

      onSubmit(trimmed);
      pushHistory(trimmed);
      commitValue('');
      resetHistoryNav();
    },
    [onSubmit, pushHistory, commitValue, resetHistoryNav]
  );

  const handleInput = useCallback(
    (newValue: string) => {
      setLocalValue(newValue);
      onChange(newValue); // Notify parent component
      resetHistoryNav();
    },
    [resetHistoryNav, onChange]
  );

  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      <box
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderColor={COLORS.border}
        paddingX={1}
      >
        <text color={COLORS.user} bold>
          {ICONS.user}{' '}
        </text>
        <input
          value={localValue}
          onInput={handleInput}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          focused={isActive}
        />
      </box>
      <box paddingX={1}>
        <text dimColor>
          Enter to send | {KEY_BINDINGS.exit} to exit | {KEY_BINDINGS.openHelp} for help
        </text>
      </box>
    </box>
  );
};
