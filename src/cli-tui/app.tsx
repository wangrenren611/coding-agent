/**
 * cli-tui Main App Component
 * OpenTUI-based terminal UI application
 */

import React, { useState, useCallback } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import type { ModelId } from '../providers';
import { ChatProvider } from './state/chat-store';
import { useAgentRunner } from './agent/use-agent-runner';
import { MessageList } from './ui/message-list';
import { StatusBar } from './ui/status-bar';
import { InputBar } from './ui/input-bar';
import { COLORS } from './ui/theme';

const DEFAULT_MODEL: ModelId = 'minimax-2.1';

export const App: React.FC = () => {
  const [model] = useState<ModelId>(DEFAULT_MODEL);
  const [inputValue, setInputValue] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const { messages, isLoading, submitMessage, addSystemMessage, executionState } = useAgentRunner(model);

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      // Handle commands
      if (trimmed.startsWith('/')) {
        handleCommand(trimmed);
        setInputValue('');
        return;
      }

      submitMessage(trimmed);
      setInputValue('');
    },
    [submitMessage]
  );

  const handleCommand = useCallback((command: string) => {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/help':
      case '/h':
        setShowHelp(prev => !prev); // Toggle help
        break;
      case '/clear':
      case '/cls':
        addSystemMessage('info', 'Screen cleared');
        break;
      case '/exit':
      case '/quit':
      case '/q':
        process.exit(0);
        break;
      default:
        addSystemMessage('warn', `Unknown command: ${cmd}`);
    }
  }, [addSystemMessage]);

  // Main UI
  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
    >
      {/* Message list - takes remaining space */}
      <box flexGrow={1} flexShrink={1} overflow="hidden">
        <MessageList
          messages={messages}
          isLoading={isLoading}
        />
      </box>

      {/* Status bar - fixed height */}
      <StatusBar
        isLoading={isLoading}
        statusMessage={messages.length > 0 ? `${messages.length} messages` : undefined}
        executionState={executionState}
      />

  

      {/* Input bar - fixed size, never shrinks */}
      <box flexShrink={0}>
        <InputBar
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          placeholder="Type your message... (/help for commands)"
          isActive={true}
        />
      </box>
    </box>
  );
};

// ==================== Entry Point ====================

export async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  const root = createRoot(renderer);

  root.render(
    <ChatProvider>
      <App />
    </ChatProvider>
  );

  // Keep the process running
  return new Promise<void>(() => {});
}
