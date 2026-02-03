import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, ICONS } from './theme';

interface StatusBarProps {
  isLoading: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({ isLoading }) => {
  if (!isLoading) return null;

  return (
    <Box paddingX={1} paddingY={0}>
      <Text color={COLORS.warning}>
        {ICONS.running} Thinking...
      </Text>
    </Box>
  );
};
