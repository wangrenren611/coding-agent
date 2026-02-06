/**
 * cli-tui Status Bar Component
 * Shows loading state and status messages
 */

import React, { useMemo } from 'react';
import { COLORS, ICONS, SPINNER_FRAMES } from './theme';

interface StatusBarProps {
  isLoading?: boolean;
  statusMessage?: string;
  executionState?: 'idle' | 'running' | 'thinking' | 'error' | 'completed';
}

let spinnerIndex = 0;
const getNextSpinnerFrame = (): string => {
  const frame = SPINNER_FRAMES[spinnerIndex];
  spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
  return frame;
};

export const StatusBar: React.FC<StatusBarProps> = ({
  isLoading = false,
  statusMessage,
  executionState = 'idle',
}) => {
  const statusContent = useMemo(() => {
    if (statusMessage) {
      return <text fg={COLORS.info}>{statusMessage}</text>;
    }

    if (executionState === 'thinking') {
      return <text fg={COLORS.warning}>{ICONS.thinking} Thinking...</text>;
    }

    if (executionState === 'error') {
      return <text fg={COLORS.error}>{ICONS.error} Error occurred</text>;
    }

    if (isLoading) {
      return <text fg={COLORS.warning}>{getNextSpinnerFrame()} Processing...</text>;
    }

    return <text fg={COLORS.textMuted}>Ready</text>;
  }, [isLoading, statusMessage, executionState]);

  return (
    <box
      width="100%"
      borderStyle="single"
      borderColor={COLORS.border}
      height={3}
    >
      {statusContent}
    </box>
  );
};
