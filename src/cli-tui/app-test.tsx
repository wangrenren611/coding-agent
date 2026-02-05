/**
 * Simplified test version without useKeyboard
 */

import React, { useState, useCallback } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { COLORS } from './ui/theme';

export const AppTest: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<string[]>([]);

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setMessages(prev => [...prev, `You: ${trimmed}`]);
      setInputValue('');
    },
    []
  );

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      paddingX={1}
      paddingY={1}
    >
      <text color={COLORS.primary} bold>Simple Input Test</text>
      <text>{'\n'}</text>

      {messages.map((msg, i) => (
        <text key={i}>{msg}</text>
      ))}
      <text>{'\n'}</text>

      <box
        borderStyle="single"
        borderColor={COLORS.border}
        paddingX={1}
      >
        <text color={COLORS.user} bold>●{' '}</text>
        <input
          value={inputValue}
          onInput={setInputValue}
          onSubmit={handleSubmit}
          placeholder="Type here..."
          focused={true}
        />
      </box>

      <box paddingX={1}>
        <text dimColor>Ctrl+C to exit</text>
      </box>
    </box>
  );
};

export async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  const root = createRoot(renderer);
  root.render(<AppTest />);

  return new Promise<void>(() => {});
}
