import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, useInput, useStdout,Text } from 'ink';
import type { ModelId } from '../providers';
import { useAgentRunner } from './agent/use-agent-runner';
import { MessageList } from './ui/message-list';
import { InputBar } from './ui/input-bar';
import { StatusBar } from './ui/status-bar';
import { CommandPalette, type Command } from './ui/command-palette';
import { HelpOverlay } from './ui/help-overlay';
import { ModelOverlay } from './ui/model-overlay';

const DEFAULT_MODEL: ModelId = 'minimax-2.1';

type Overlay = 'none' | 'help' | 'models';

export const App: React.FC = () => {
  const { stdout } = useStdout();
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [inputValue, setInputValue] = useState('');
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [scrollCommand, setScrollCommand] = useState<{ id: number; action: 'up' | 'down' | 'top' | 'bottom' } | null>(null);

  const { messages, isLoading, submitMessage, clearMessages, addSystemMessage } = useAgentRunner(model);

  const commandPaletteActive = overlay === 'none' && inputValue.trim().startsWith('/');
  const overlayActive = overlay !== 'none' || commandPaletteActive;
  const inputActive = overlay !== 'help' && overlay !== 'models';

  const baseReserved = 4 + (isLoading ? 1 : 0);
  const overlayReserved = overlay === 'help'
    ? 10
    : overlay === 'models'
      ? 13
      : commandPaletteActive
        ? 11
        : 0;
  const viewportHeight = Math.max(6, (stdout.rows || 24) - baseReserved - overlayReserved);



  const runCommand = useCallback((command: Command) => {
    setInputValue('');
    setOverlay('none');
    command.run();
  }, []);

  const requestScroll = useCallback((action: 'up' | 'down' | 'top' | 'bottom') => {
    setScrollCommand(prev => ({ id: (prev?.id ?? 0) + 1, action }));
  }, []);

  const commands = useMemo<Command[]>(() => [
    {
      id: 'help',
      label: '/help',
      description: 'Show help',
      run: () => setOverlay('help'),
    },
    {
      id: 'model',
      label: '/model',
      description: 'Select model',
      run: () => setOverlay('models'),
    },
    {
      id: 'clear',
      label: '/clear',
      description: 'Clear messages',
      run: () => {
        clearMessages();
        addSystemMessage('info', 'Messages cleared');
      },
    },
    {
      id: 'exit',
      label: '/exit',
      description: 'Exit CLI',
      run: () => process.exit(0),
    },
  ], [addSystemMessage, clearMessages]);

  const handleSubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      const command = commands.find(cmd => cmd.label === trimmed);
      if (command) {
        runCommand(command);
      } else {
        addSystemMessage('warn', `Unknown command: ${trimmed}`);
      }
      setInputValue('');
      return;
    }

    submitMessage(trimmed);
    setInputValue('');
  }, [addSystemMessage, commands, runCommand, submitMessage]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }

    if (key.escape) {
      if (overlay !== 'none') {
        setOverlay('none');
      }
    }
  });

  return (
    <Box flexDirection="column" width="100%" minHeight={viewportHeight}>
      <Box flexDirection="column" flexGrow={1} >
        <MessageList
          messages={messages}
        />
      </Box>

      <StatusBar isLoading={isLoading} />

      {commandPaletteActive ? (
        <Box paddingX={1} paddingY={1}>
          <CommandPalette
            query={inputValue}
            commands={commands.map(command => ({
              ...command,
              run: () => runCommand(command),
            }))}
            isActive={commandPaletteActive}
            onClose={() => setInputValue('')}
          />
        </Box>
      ) : null}

      {overlay === 'models' ? (
        <Box paddingX={1} paddingY={1}>
          <ModelOverlay
            currentModel={model}
            isActive={overlay === 'models'}
            onSelect={(selected) => {
              setModel(selected);
              addSystemMessage('info', `Model set to ${selected}`);
              setOverlay('none');
            }}
            onClose={() => setOverlay('none')}
          />
        </Box>
      ) : null}

      {overlay === 'help' ? (
        <Box paddingX={1} paddingY={1}>
          <HelpOverlay onClose={() => setOverlay('none')} />
        </Box>
      ) : null}

      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        overlayActive={overlayActive}
        isActive={inputActive}
        onScroll={requestScroll}
        placeholder={commandPaletteActive ? 'Filter commands...' : 'Message...'}
      />
    </Box>
  );
};
