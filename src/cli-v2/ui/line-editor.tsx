import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';

interface LineEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  isActive?: boolean;
  blockEnter?: boolean;
  blockHistory?: boolean;
  maxHistory?: number;
  onScroll?: (action: 'up' | 'down' | 'top' | 'bottom') => void;
}

const extractMouseScroll = (input: string): { cleaned: string; scrolls: Array<'up' | 'down'> } => {
  if (!input) return { cleaned: input, scrolls: [] };

  const scrolls: Array<'up' | 'down'> = [];
  let cleaned = input;

  cleaned = cleaned.replace(/\[<(\d+);(\d+);(\d+)[mM]/g, (match, codeStr) => {
    const code = Number(codeStr);
    if (code === 64) scrolls.push('up');
    if (code === 65) scrolls.push('down');
    return '';
  });

  let idx = 0;
  while ((idx = cleaned.indexOf('[M', idx)) !== -1) {
    if (idx + 5 <= cleaned.length) {
      const code = cleaned.charCodeAt(idx + 2) - 32;
      if (code === 64) scrolls.push('up');
      if (code === 65) scrolls.push('down');
      cleaned = cleaned.slice(0, idx) + cleaned.slice(idx + 5);
      continue;
    }
    idx += 2;
  }

  return { cleaned, scrolls };
};

export const LineEditor: React.FC<LineEditorProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type your message...',
  isActive = true,
  blockEnter = false,
  blockHistory = false,
  maxHistory = 200,
  onScroll,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');
  const internalUpdateRef = useRef(false);

  useEffect(() => {
    if (!internalUpdateRef.current && value !== localValue) {
      setLocalValue(value);
      setCursorOffset(value.length);
    }
    internalUpdateRef.current = false;
  }, [value, localValue]);

  const commitValue = useCallback((nextValue: string) => {
    internalUpdateRef.current = true;
    setLocalValue(nextValue);
    onChange(nextValue);
  }, [onChange]);

  const resetHistoryNav = useCallback(() => {
    setHistoryIndex(-1);
    draftRef.current = '';
  }, []);

  const pushHistory = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const history = historyRef.current;
    if (history[0] === trimmed) return;
    historyRef.current = [trimmed, ...history].slice(0, maxHistory);
  }, [maxHistory]);

  useInput((input, key) => {
    if (!isActive) return;

    const { cleaned, scrolls } = onScroll ? extractMouseScroll(input) : { cleaned: input, scrolls: [] };
    const inputValue = cleaned;

    if (scrolls.length > 0 && onScroll) {
      scrolls.forEach(action => onScroll(action));
      if (!inputValue) {
        return;
      }
    }

    if (key.ctrl && inputValue === 'c') {
      return;
    }

    if (onScroll) {
      if (key.pageUp || (key.ctrl && inputValue === 'u') || (key.ctrl && key.upArrow)) {
        onScroll('up');
        return;
      }

      if (key.pageDown || (key.ctrl && inputValue === 'd') || (key.ctrl && key.downArrow)) {
        onScroll('down');
        return;
      }

      if (key.home) {
        onScroll('top');
        return;
      }

      if (key.end) {
        onScroll('bottom');
        return;
      }
    }

    if (blockHistory && (key.upArrow || key.downArrow)) {
      return;
    }

    if (blockEnter && key.return) {
      return;
    }

    if (key.return) {
      onSubmit(localValue);
      pushHistory(localValue);
      commitValue('');
      resetHistoryNav();
      setCursorOffset(0);
      return;
    }

    if (key.upArrow && !key.ctrl && !key.meta) {
      const history = historyRef.current;
      if (history.length === 0) return;
      if (historyIndex === -1) {
        draftRef.current = localValue;
      }
      const nextIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(nextIndex);
      const nextValue = history[nextIndex];
      commitValue(nextValue);
      setCursorOffset(nextValue.length);
      return;
    }

    if (key.downArrow && !key.ctrl && !key.meta) {
      const history = historyRef.current;
      if (history.length === 0 || historyIndex === -1) return;
      if (historyIndex === 0) {
        setHistoryIndex(-1);
        const nextValue = draftRef.current;
        commitValue(nextValue);
        setCursorOffset(nextValue.length);
        return;
      }
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      const nextValue = history[nextIndex];
      commitValue(nextValue);
      setCursorOffset(nextValue.length);
      return;
    }

    if (key.leftArrow) {
      setCursorOffset(offset => Math.max(0, offset - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorOffset(offset => Math.min(localValue.length, offset + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorOffset === 0) return;
      const nextValue =
        localValue.slice(0, cursorOffset - 1) +
        localValue.slice(cursorOffset);
      commitValue(nextValue);
      setCursorOffset(offset => Math.max(0, offset - 1));
      resetHistoryNav();
      return;
    }

    if (key.ctrl && inputValue === 'a') {
      setCursorOffset(0);
      return;
    }

    if (key.ctrl && inputValue === 'e') {
      setCursorOffset(localValue.length);
      return;
    }

    if (inputValue) {
      const nextValue =
        localValue.slice(0, cursorOffset) +
        inputValue +
        localValue.slice(cursorOffset);
      commitValue(nextValue);
      setCursorOffset(offset => Math.min(nextValue.length, offset + inputValue.length));
      resetHistoryNav();
    }
  }, { isActive });

  const showCursor = isActive;
  const displayPlaceholder = placeholder && localValue.length === 0;

  let rendered = localValue;
  let renderedPlaceholder = placeholder ? chalk.gray(placeholder) : '';

  if (showCursor) {
    renderedPlaceholder = placeholder
      ? chalk.inverse(placeholder[0] ?? ' ') + chalk.gray(placeholder.slice(1))
      : chalk.inverse(' ');

    if (localValue.length === 0) {
      rendered = chalk.inverse(' ');
    } else {
      let output = '';
      for (let i = 0; i < localValue.length; i += 1) {
        const char = localValue[i];
        output += i === cursorOffset ? chalk.inverse(char) : char;
      }
      if (cursorOffset === localValue.length) {
        output += chalk.inverse(' ');
      }
      rendered = output;
    }
  }

  return (
    <Text>
      {displayPlaceholder ? renderedPlaceholder : rendered}
    </Text>
  );
};
