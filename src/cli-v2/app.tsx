import React, { useCallback,  useState } from 'react';
import { Box, useInput, useStdout ,Text} from 'ink';
import type { ModelId } from '../providers';
import { useAgentRunner } from './agent/use-agent-runner';
import { MessageList } from './ui/message-list';
import { StatusBar } from './ui/status-bar';
import TextInput from 'ink-text-input';
import { ICONS } from './ui/theme';

const DEFAULT_MODEL: ModelId = 'minimax-2.1';

type Overlay = 'none' | 'help' | 'models';

export const App: React.FC = () => {
  const { stdout } = useStdout();
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [inputValue, setInputValue] = useState('');
  const [overlay, setOverlay] = useState<Overlay>('none');

  const { messages, isLoading, submitMessage, addSystemMessage } = useAgentRunner(model);

  const handleSubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    submitMessage(trimmed);
    setInputValue('');
  }, [addSystemMessage,  submitMessage]);

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
    <Box flexDirection="column" width="100%" minHeight={stdout.rows}>
      <Box flexDirection="column" flexGrow={1} >
        <MessageList
          messages={messages}
        />
      </Box>

      <StatusBar isLoading={isLoading} />
      <Box>
        <Text>{ICONS.user}{" "}</Text>
         <TextInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
