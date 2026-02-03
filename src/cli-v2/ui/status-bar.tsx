import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, ICONS } from './theme';
import Spinner from 'ink-spinner';
interface StatusBarProps {
  isLoading: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({ isLoading }) => {
  if (!isLoading) return null;

  return (
    <Box paddingX={1} paddingY={1}>
      <Text color={COLORS.warning}>
       <Spinner type="star" /> Thinking...
      </Text>
    </Box>
  );
};
