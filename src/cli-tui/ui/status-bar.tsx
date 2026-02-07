/**
 * cli-tui Status Bar Component
 * Shows compact runtime status
 */

import React, { useMemo } from 'react';
import { COLORS, ICONS, SPINNER_FRAMES } from './theme';

interface StatusBarProps {
  isLoading?: boolean;
  statusMessage?: string;
  executionState?: 'idle' | 'running' | 'thinking' | 'error' | 'completed';
  model?: string;
  messageCount?: number;
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
  model,
  messageCount = 0,
}) => {
  const statusContent = useMemo(() => {
    if (executionState === 'error') {
      return {
        color: COLORS.error,
        text: `${ICONS.error} error`,
      };
    }
    if (executionState === 'thinking') {
      return {
        color: COLORS.warning,
        text: `${ICONS.thinking} thinking`,
      };
    }
    if (isLoading || executionState === 'running') {
      return {
        color: COLORS.toolRunning,
        text: `${getNextSpinnerFrame()} running`,
      };
    }
    if (executionState === 'completed') {
      return {
        color: COLORS.success,
        text: `${ICONS.success} done`,
      };
    }

    return {
      color: COLORS.textMuted,
      text: 'ready',
    };
  }, [isLoading, executionState]);

  return (
    <box
      width="100%"
      flexDirection="row"
      paddingTop={0}
      paddingBottom={0}
    >
      <text fg={statusContent.color}>{statusContent.text}</text>
      <text fg={COLORS.textMuted}> | </text>
      <text fg={COLORS.textMuted}>messages {messageCount}</text>
      {model ? (
        <>
          <text fg={COLORS.textMuted}> | </text>
          <text fg={COLORS.textMuted}>model {model}</text>
        </>
      ) : null}
      {statusMessage ? (
        <>
          <text fg={COLORS.textMuted}> | </text>
          <text fg={COLORS.info}>{statusMessage}</text>
        </>
      ) : null}
    </box>
  );
};
