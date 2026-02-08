import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface ComposerProps {
  disabled?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
  onAbort: () => void;
}

export function Composer({ disabled, onSubmit, onAbort }: ComposerProps): React.JSX.Element {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  useInput((input, key) => {
    if (key.escape) {
      if (disabled) onAbort();
      return;
    }

    if (disabled) return;

    if (key.return) {
      const next = value.trim();
      if (!next) return;
      setHistory((prev) => [next, ...prev.slice(0, 49)]);
      setHistoryIndex(-1);
      setValue("");
      void onSubmit(next);
      return;
    }

    if (key.upArrow) {
      if (history.length === 0) return;
      const nextIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(nextIndex);
      setValue(history[nextIndex] ?? "");
      return;
    }

    if (key.downArrow) {
      if (history.length === 0) return;
      const nextIndex = Math.max(historyIndex - 1, -1);
      setHistoryIndex(nextIndex);
      setValue(nextIndex === -1 ? "" : (history[nextIndex] ?? ""));
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    if (key.ctrl || key.meta || key.tab) return;
    if (input) setValue((prev) => prev + input);
  }, { isActive: true });

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">❯ </Text>
      <Text color={disabled ? "gray" : "white"}>
        {value || (disabled ? "Running... (Esc to abort)" : "Type message or /help")}
      </Text>
    </Box>
  );
}
