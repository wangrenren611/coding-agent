import React, { useEffect, useRef, useState, memo } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";

export interface ComposerProps {
  disabled?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
  onAbort: () => void;
}

interface InputKey {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  tab?: boolean;
  return?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  backspace?: boolean;
  delete?: boolean;
  escape?: boolean;
}

const SHIFT_ENTER_RAW_SEQUENCES = new Set([
  // CSI 13 ; 2 u - Standard Shift+Enter (modifyOtherKeys mode 2)
  "\u001B[13;2u",
  // CSI 13 ; 2 ~ - Alternative Shift+Enter format
  "\u001B[13;2~",
  // CSI 27 ; 2 ; 13 ~ - Some terminals send CSI 27 first
  "\u001B[27;2;13~",
  // CSI 27 ; 2 ; 13 u
  "\u001B[27;2;13u",
  // Alt+Enter variants (may be sent in some configurations)
  "\u001B[13;9u",
  "\u001B[27;9;13~",
  // Additional common Shift+Enter sequences from various terminals
  "\u001B[13;2m",
  "\u001B[27;2;13m",
  "\u001B[13;2;2u",
]);

function splitChars(value: string): string[] {
  return Array.from(value);
}

function normalizeNamedKey(input: string): string {
  return input.trim().toUpperCase();
}

function isNamedBackspace(input: string): boolean {
  const value = normalizeNamedKey(input);
  return value === "BACKSPACE" || value === "BACKSPACED" || value === "DELETE" || value === "DELETED";
}

function isNamedLeft(input: string): boolean {
  return normalizeNamedKey(input) === "LEFT";
}

function isNamedRight(input: string): boolean {
  return normalizeNamedKey(input) === "RIGHT";
}

function isNamedHome(input: string): boolean {
  return normalizeNamedKey(input) === "HOME";
}

function isNamedEnd(input: string): boolean {
  return normalizeNamedKey(input) === "END";
}

function isNamedSpecialKey(input: string): boolean {
  const value = normalizeNamedKey(input);
  return [
    "BACKSPACE",
    "BACKSPACED",
    "DELETE",
    "DELETED",
    "LEFT",
    "RIGHT",
    "UP",
    "DOWN",
    "HOME",
    "END",
    "ENTER",
    "ESCAPE",
    "TAB",
  ].includes(value);
}

function isBackspaceInput(input: string): boolean {
  return input === "\b" || input === "\u007F" || input === "\u001B[3~";
}

function isLeftInput(input: string): boolean {
  return input === "\u001B[D";
}

function isRightInput(input: string): boolean {
  return input === "\u001B[C";
}

function isHomeInput(input: string): boolean {
  return input === "\u0001" || input === "\u001B[H" || input === "\u001B[1~";
}

function isEndInput(input: string): boolean {
  return input === "\u0005" || input === "\u001B[F" || input === "\u001B[4~";
}

function stripControlChars(input: string): string {
  return input.replace(/[\u0000-\u001F\u007F]/g, "");
}

function shouldInsertNewlineOnReturn(input: string, key: InputKey, rawInput: string | null): boolean {
  const named = normalizeNamedKey(input);
  if (named === "SHIFT+ENTER" || named === "SHIFT_ENTER" || named === "S-ENTER") return true;
  if (SHIFT_ENTER_RAW_SEQUENCES.has(input)) return true;
  if (rawInput && SHIFT_ENTER_RAW_SEQUENCES.has(rawInput)) return true;
  if (rawInput) {
    for (const sequence of SHIFT_ENTER_RAW_SEQUENCES) {
      if (rawInput.endsWith(sequence) || rawInput.includes(sequence)) return true;
    }
  }
  if (key.ctrl && (input === "j" || input === "\u000A")) return true;
  if (key.return && key.meta) return true;
  if (!key.return) return false;
  return key.shift === true;
}

export const Composer = memo(function Composer({ disabled, onSubmit, onAbort }: ComposerProps): React.JSX.Element {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [draft, setDraft] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const placeholder = disabled ? "Running... (Esc to abort)" : "Type message or /help";
  const lastRawInputRef = useRef<string | null>(null);
  const lastRawInputAtRef = useRef(0);

  const submitCurrentValue = (): void => {
    if (!value.trim()) return;
    const next = value;
    setHistory((prev) => [next, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setDraft("");
    setValue("");
    setCursorOffset(0);
    void onSubmit(next);
  };

  const insertNewlineAtCursor = (): void => {
    const nextValue = value.slice(0, cursorOffset) + "\n" + value.slice(cursorOffset);
    setValue(nextValue);
    setCursorOffset(cursorOffset + 1);
  };

  useEffect(() => {
    if (cursorOffset > value.length) {
      setCursorOffset(value.length);
    }
  }, [cursorOffset, value]);

  useEffect(() => {
    const stdin = process.stdin;
    if (
      !stdin
      || stdin.destroyed
      || typeof stdin.addListener !== "function"
      || typeof stdin.removeListener !== "function"
    ) {
      return;
    }

    const onData = (chunk: Buffer | string): void => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString("latin1");
      lastRawInputRef.current = raw;
      lastRawInputAtRef.current = Date.now();
    };

    stdin.addListener("data", onData);
    return () => {
      stdin.removeListener("data", onData);
    };
  }, []);

  const getRecentRawInput = (): string | null => {
    const age = Date.now() - lastRawInputAtRef.current;
    if (age > 250) return null;
    return lastRawInputRef.current;
  };

  useInput((input: string, key: InputKey) => {
    if (key.escape) {
      if (disabled) onAbort();
      return;
    }

    if (disabled) return;

    if (key.upArrow) {
      if (history.length === 0) return;
      if (historyIndex === -1) setDraft(value);
      const nextIndex = Math.min(historyIndex + 1, history.length - 1);
      const nextValue = history[nextIndex] ?? "";
      setHistoryIndex(nextIndex);
      setValue(nextValue);
      setCursorOffset(nextValue.length);
      return;
    }

    if (key.downArrow) {
      if (history.length === 0 || historyIndex === -1) return;
      const nextIndex = Math.max(historyIndex - 1, -1);
      const nextValue = nextIndex === -1 ? draft : (history[nextIndex] ?? "");
      setHistoryIndex(nextIndex);
      setValue(nextValue);
      setCursorOffset(nextValue.length);
      return;
    }

    if ((key.ctrl && input === "c") || key.tab || (key.shift && key.tab)) return;

    const recentRawInput = getRecentRawInput();

    if ((input === "\n" || input === "\r") && !key.return) {
      if (shouldInsertNewlineOnReturn(input, key, recentRawInput)) {
        insertNewlineAtCursor();
      } else {
        submitCurrentValue();
      }
      return;
    }

    if (shouldInsertNewlineOnReturn(input, key, recentRawInput)) {
      insertNewlineAtCursor();
      return;
    }

    if (key.return) {
      submitCurrentValue();
      return;
    }

    if (historyIndex !== -1) {
      setHistoryIndex(-1);
      setDraft("");
    }

    let nextCursorOffset = cursorOffset;
    let nextValue = value;

    if (key.leftArrow || isLeftInput(input) || isNamedLeft(input)) {
      nextCursorOffset -= 1;
    } else if (key.rightArrow || isRightInput(input) || isNamedRight(input)) {
      nextCursorOffset += 1;
    } else if (key.home || isHomeInput(input) || isNamedHome(input)) {
      nextCursorOffset = 0;
    } else if (key.end || isEndInput(input) || isNamedEnd(input)) {
      nextCursorOffset = value.length;
    } else if (key.backspace || key.delete || isBackspaceInput(input) || isNamedBackspace(input)) {
      if (cursorOffset > 0) {
        nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
        nextCursorOffset -= 1;
      }
    } else {
      if (isNamedSpecialKey(input)) return;
      const printable = stripControlChars(input);
      if (!printable) return;
      nextValue = value.slice(0, cursorOffset) + printable + value.slice(cursorOffset);
      nextCursorOffset += printable.length;
    }

    if (nextCursorOffset < 0) nextCursorOffset = 0;
    if (nextCursorOffset > nextValue.length) nextCursorOffset = nextValue.length;

    setCursorOffset(nextCursorOffset);
    if (nextValue !== value) setValue(nextValue);
  }, { isActive: true });

  const chars = splitChars(value);
  let renderedValue = value;
  let renderedPlaceholder = placeholder.length > 0
    ? chalk.grey(placeholder)
    : "";

  if (!disabled) {
    renderedPlaceholder = placeholder.length > 0
      ? chalk.inverse(placeholder[0] ?? " ") + chalk.grey(placeholder.slice(1))
      : chalk.inverse(" ");

    renderedValue = value.length > 0 ? "" : chalk.inverse(" ");
    let index = 0;
    for (const char of chars) {
      renderedValue += index === cursorOffset ? chalk.inverse(char) : char;
      index += 1;
    }

    if (value.length > 0 && cursorOffset === value.length) {
      renderedValue += chalk.inverse(" ");
    }
  }

  return (
    <Box position="relative"    width="100%"  borderColor="#000" borderLeft={false} borderRight={false}  borderStyle="single" >
      <Text color="#000">❯ </Text>
      <Text>{value.length > 0 ? renderedValue : renderedPlaceholder}</Text>
    </Box>
  );
}, (prevProps, nextProps) => {
  // 只在关键属性变化时才重新渲染
  return (
    prevProps.disabled === nextProps.disabled &&
    prevProps.onSubmit === nextProps.onSubmit &&
    prevProps.onAbort === nextProps.onAbort
  );
});
