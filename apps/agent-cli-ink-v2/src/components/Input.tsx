import React from 'react';
import { Box, Text } from 'ink';

interface InputProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
}

export function Input({ value, placeholder = 'Type a message...', disabled }: InputProps) {
  return (
    <Box>
      <Text color="cyan">❯ </Text>
      {disabled ? (
        <Text dimColor>Running...</Text>
      ) : value ? (
        <Text>{value}</Text>
      ) : (
        <Text dimColor>{placeholder}</Text>
      )}
      {!disabled && <Text color="gray">█</Text>}
    </Box>
  );
}
