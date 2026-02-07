/**
 * cli-tui Main App Component
 * OpenTUI-based terminal UI application
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
  const [showSessionScrollbar, setShowSessionScrollbar] = useState(false);
  const cwd = process.cwd().replace(process.env.HOME || '', '~');

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

  const messageRenderSignature = useMemo(
    () =>
      messages
        .map(message => {
          const toolSig = (message.toolCalls || [])
            .map(tool => `${tool.id}:${tool.status}:${(tool.streamOutput || '').length}`)
            .join(',');
          return `${message.id}:${message.content.length}:${message.isStreaming ? 1 : 0}:${toolSig}`;
        })
        .join('|'),
    [messages]
  );

  useEffect(() => {
    if (!(process.stdout.isTTY ?? false)) return;
    if (process.env.CLI_TUI_CLEAR_SCROLLBACK_ON_UPDATE === '0') return;
    // Keep terminal scrollback shallow as messages grow.
    process.stdout.write('\x1b[3J');
  }, [messageRenderSignature]);

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
          `Model=${model} | State=${executionState} | Messages=${messages.length} | Scrollbar=${showSessionScrollbar ? 'on' : 'off'}`
        );
        break;
      case '/scrollbar': {
        const option = (args[0] || 'toggle').toLowerCase();
        if (option === 'toggle') {
          setShowSessionScrollbar(prev => {
            const next = !prev;
            addSystemMessage('info', `Session scrollbar ${next ? 'enabled' : 'disabled'}`);
            return next;
          });
          break;
        }
        if (option === 'on' || option === '1' || option === 'true') {
          setShowSessionScrollbar(true);
          addSystemMessage('info', 'Session scrollbar enabled');
          break;
        }
        if (option === 'off' || option === '0' || option === 'false') {
          setShowSessionScrollbar(false);
          addSystemMessage('info', 'Session scrollbar disabled');
          break;
        }
        if (option === 'status') {
          addSystemMessage('info', `Session scrollbar is ${showSessionScrollbar ? 'enabled' : 'disabled'}`);
          break;
        }
        addSystemMessage('warn', 'Usage: /scrollbar [toggle|on|off|status]');
        break;
      }
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
    showSessionScrollbar,
    stopCurrentRun,
  ]);

  // Main UI
  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={COLORS.background}
    >
      {/* Top bar */}
      <box
        flexDirection="row"
        flexShrink={0}
        paddingTop={0}
        paddingBottom={0}
      >
        <text fg={COLORS.assistant} bold>
          Q CLI
        </text>
        <text fg={COLORS.textMuted}> | {cwd}</text>
      </box>

      {/* Message list */}
      <box flexGrow={1} flexShrink={1} overflow="hidden" paddingTop={1}>
        <MessageList
          messages={messages}
          isLoading={isLoading}
          showScrollbar={showSessionScrollbar}
        />
      </box>

      {/* Status bar */}
      <StatusBar
        isLoading={isLoading}
        statusMessage={statusMessage}
        executionState={executionState}
        model={model}
        messageCount={messages.length}
      />

      {/* Help overlay */}
      {showHelp && (
        <box
          position="absolute"
          top={2}
          left={2}
          right={2}
          borderStyle="single"
          borderColor={COLORS.primary}
          paddingX={2}
          paddingY={1}
          backgroundColor={COLORS.panel}
        >
          <text fg={COLORS.text} bold>
            Commands
          </text>
          <text fg={COLORS.textMuted}>{'\n/help  /clear  /model <id>  /models  /status  /scrollbar  /stop  /exit'}</text>
          <text>{'\n\n'}</text>
          <text fg={COLORS.text} bold>
            Shortcuts
          </text>
          <text fg={COLORS.textMuted}>{'\nEnter send | Ctrl+C exit | Ctrl+H toggle help'}</text>
          <text>{'\n\n'}</text>
          <text fg={COLORS.info}>Press /help again to close.</text>
        </box>
      )}

      {/* Input bar */}
      <box flexShrink={0}>
        <InputBar
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          placeholder="Type your message..."
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
  targetFps: 30,
  consoleOptions: undefined,  
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
