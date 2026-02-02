/**
 * Loading Component
 *
 * Animated loading indicator with multiple style options
 */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { COLORS, ICONS, SPINNER_INTERVAL_MS } from '../../utils/constants';

interface LoadingProps {
  text?: string;
  color?: string;
  style?: 'dots' | 'blocks' | 'arrow' | 'pulse';
}

/**
 * Dots style spinner - simple rotating dots
 */
const DotsSpinner: React.FC<{ color: string }> = ({ color }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % ICONS.SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <Text color={color}>{ICONS.SPINNER_FRAMES[frame]}</Text>
  );
};

/**
 * Blocks style spinner - Knight Rider effect
 */
const BlocksSpinner: React.FC<{ color: string }> = ({ color }) => {
  const [frame, setFrame] = useState(0);
  const width = 8;

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % (width * 2 - 1));
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  const renderBlocks = () => {
    const blocks: React.ReactNode[] = [];
    const center = frame < width ? frame : width - 2 - (frame - width);

    for (let i = 0; i < width; i++) {
      const isActive = i === center;
      const distance = Math.abs(i - center);
      const opacity = Math.max(0.2, 1 - distance * 0.3);

      blocks.push(
        <Text
          key={i}
          color={isActive ? color : 'gray'}
          dimColor={!isActive}
        >
          {isActive ? '■' : '·'}
        </Text>
      );
    }

    return blocks;
  };

  return <>{renderBlocks()}</>;
};

/**
 * Arrow style spinner
 */
const ArrowSpinner: React.FC<{ color: string }> = ({ color }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % 4);
    }, SPINNER_INTERVAL_MS * 2);

    return () => clearInterval(interval);
  }, []);

  const arrows = ['←', '↑', '→', '↓'];
  return <Text color={color}>{arrows[frame]}</Text>;
};

/**
 * Pulse style spinner - pulsing dot
 */
const PulseSpinner: React.FC<{ color: string }> = ({ color }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % 8);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Create pulse effect with multiple dots
  const dots: React.ReactNode[] = [];
  for (let i = 0; i < 3; i++) {
    const isActive = frame % 3 === i;
    dots.push(
      <Text key={i} color={isActive ? color : 'gray'} dimColor={!isActive}>
        ●
      </Text>
    );
  }

  return <>{dots}</>;
};

/**
 * Main Loading Component
 */
const Loading: React.FC<LoadingProps> = ({
  text = 'AI is thinking...',
  color = COLORS.SECONDARY,
  style = 'dots'
}) => {
  const renderSpinner = () => {
    switch (style) {
      case 'blocks':
        return <BlocksSpinner color={color} />;
      case 'arrow':
        return <ArrowSpinner color={color} />;
      case 'pulse':
        return <PulseSpinner color={color} />;
      case 'dots':
      default:
        return <DotsSpinner color={color} />;
    }
  };

  return (
    <Box marginTop={1} marginBottom={1}>
      {renderSpinner()}
      <Text> </Text>
      <Text color={COLORS.DIM}>{text}</Text>
    </Box>
  );
};

export default Loading;
