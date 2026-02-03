import React from 'react';
import { Box, Text } from 'ink';
import { LineEditor } from './line-editor';
import { COLORS, ICONS } from './theme';

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  overlayActive?: boolean;
  isActive?: boolean;
  onScroll?: (action: 'up' | 'down' | 'top' | 'bottom') => void;
}

export const InputBar: React.FC<InputBarProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  overlayActive = false,
  isActive = true,
  onScroll,
}) => {
  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="single" borderLeft={false} borderRight={false} borderColor="gray" paddingX={1}>
        <Text color={COLORS.user} bold>
          {ICONS.user} 
        </Text>
        <LineEditor
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          blockEnter={overlayActive}
          blockHistory={overlayActive}
          isActive={isActive}
          onScroll={onScroll}
        />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>Enter to send, / for commands, PageUp/PageDown (or Ctrl+U/Ctrl+D) to scroll, Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};
