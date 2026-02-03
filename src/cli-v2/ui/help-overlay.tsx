import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from './theme';

interface HelpOverlayProps {
  onClose: () => void;
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({ onClose }) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
      <Text color={COLORS.info} bold>Help</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>/help        Show this help</Text>
        <Text>/model       Select model</Text>
        <Text>/clear       Clear messages</Text>
        <Text>/exit        Exit</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Shortcuts</Text>
        <Text dimColor>Enter: send message</Text>
        <Text dimColor>Up/Down: history (when commands not open)</Text>
        <Text dimColor>Esc: close overlay</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Esc to close.</Text>
      </Box>
    </Box>
  );
};
