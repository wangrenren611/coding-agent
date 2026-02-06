/**
 * cli-tui Main App Component
 * OpenTUI-based terminal UI application
 */

import React, { useState, useCallback } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { ProviderRegistry, type ModelId } from '../providers';
import { ChatProvider } from './state/chat-store';
import { useAgentRunner } from './agent/use-agent-runner';
import { MessageList } from './ui/message-list';
import { StatusBar } from './ui/status-bar';
import { InputBar } from './ui/input-bar';
import { COLORS } from './ui/theme';

const DEFAULT_MODEL: ModelId = 'minimax-2.1';

export const App: React.FC = () => {
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [inputValue, setInputValue] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const {
    messages,
    isLoading,
    submitMessage,
    addSystemMessage,
    clearMessages,
    stopCurrentRun,
    executionState,
    statusMessage,
  } = useAgentRunner(model);

  const modelList = ProviderRegistry.getModelIds();

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
    [submitMessage, setInputValue]
  );

  const handleCommand = useCallback((command: string) => {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).filter(Boolean);

    switch (cmd) {
      case '/help':
      case '/h':
        setShowHelp(prev => !prev);
        break;
      case '/clear':
      case '/cls':
        clearMessages();
        setShowHelp(false);
        addSystemMessage('info', 'Cleared message history');
        break;
      case '/stop':
        stopCurrentRun();
        addSystemMessage('info', 'Stopped current run');
        break;
      case '/status':
        addSystemMessage(
          'info',
          `Model=${model} | State=${executionState} | Messages=${messages.length}`
        );
        break;
      case '/models': {
        const available = modelList.join(', ');
        addSystemMessage('info', `Available models: ${available}`);
        break;
      }
      case '/model': {
        const nextModel = args[0];
        if (!nextModel || nextModel === 'list') {
          addSystemMessage('info', `Current model: ${model}. Use /model <id> to switch.`);
          break;
        }

        if (!modelList.includes(nextModel as ModelId)) {
          addSystemMessage('warn', `Unknown model: ${nextModel}. Use /models to view options.`);
          break;
        }

        setModel(nextModel as ModelId);
        addSystemMessage('info', `Switched model to ${nextModel}`);
        break;
      }
      case '/exit':
      case '/quit':
      case '/q':
        process.exit(0);
        break;
      default:
        addSystemMessage('warn', `Unknown command: ${cmd}. Use /help for command list.`);
    }
  }, [
    addSystemMessage,
    clearMessages,
    executionState,
    messages.length,
    model,
    modelList,
    stopCurrentRun,
  ]);

  // Main UI
  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      paddingX={1}
      paddingY={1}
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
        statusMessage={statusMessage ?? `Model: ${model} | Messages: ${messages.length}`}
        executionState={executionState}
      />

      {/* Help overlay - shown above input */}
      {showHelp && (
        <box
          position="absolute"
          top={1}
          left={1}
          borderStyle="double"
          borderColor={COLORS.primary}
          paddingX={2}
          paddingY={1}
          backgroundColor={COLORS.surface}
        >
          <text fg={COLORS.text} bold>AI Coding Agent - Help</text>
          <text>{'\n\n'}</text>
          <text fg={COLORS.text}>Commands:</text>
          <text fg={COLORS.textMuted}>{'\n  /help      Toggle this help'}</text>
          <text fg={COLORS.textMuted}>{'\n  /clear     Clear screen'}</text>
          <text fg={COLORS.textMuted}>{'\n  /model     Show or switch model'}</text>
          <text fg={COLORS.textMuted}>{'\n  /models    List models'}</text>
          <text fg={COLORS.textMuted}>{'\n  /status    Show current status'}</text>
          <text fg={COLORS.textMuted}>{'\n  /stop      Stop current run'}</text>
          <text fg={COLORS.textMuted}>{'\n  /exit      Exit application'}</text>
          <text>{'\n\n'}</text>
          <text fg={COLORS.text}>Keyboard Shortcuts:</text>
          <text fg={COLORS.textMuted}>{'\n  Enter      Send message'}</text>
          <text fg={COLORS.textMuted}>{'\n  Ctrl+C     Exit'}</text>
          <text>{'\n\n'}</text>
          <text fg={COLORS.textMuted}>Press /help again to close</text>
        </box>
      )}

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
