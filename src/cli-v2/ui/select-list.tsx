import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from './theme';

export interface SelectItem {
  id: string;
  label: string;
  description?: string;
}

interface SelectListProps {
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  onCancel: () => void;
  isActive: boolean;
  height?: number;
  header?: string;
}

export const SelectList: React.FC<SelectListProps> = ({
  items,
  onSelect,
  onCancel,
  isActive,
  height = 6,
  header,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
    setScrollTop(0);
  }, [items]);

  const visibleHeight = Math.min(height, items.length || height);

  const visibleItems = useMemo(() => {
    return items.slice(scrollTop, scrollTop + visibleHeight);
  }, [items, scrollTop, visibleHeight]);

  const scrollToIndex = useCallback((index: number) => {
    const nextIndex = Math.max(0, Math.min(index, items.length - 1));
    if (nextIndex < scrollTop) {
      setScrollTop(nextIndex);
    } else if (nextIndex >= scrollTop + visibleHeight) {
      setScrollTop(nextIndex - visibleHeight + 1);
    }
    setSelectedIndex(nextIndex);
  }, [items.length, scrollTop, visibleHeight]);

  useInput((input, key) => {
    if (!isActive) return;

    if (key.upArrow) {
      scrollToIndex(selectedIndex - 1);
      return;
    }

    if (key.downArrow) {
      scrollToIndex(selectedIndex + 1);
      return;
    }

    if (key.return) {
      const item = items[selectedIndex];
      if (item) {
        onSelect(item);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (input === 'k' && key.ctrl) {
      scrollToIndex(selectedIndex - 1);
    }

    if (input === 'j' && key.ctrl) {
      scrollToIndex(selectedIndex + 1);
    }
  }, { isActive });

  if (items.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No items</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
      {header ? (
        <Box marginBottom={1}>
          <Text color={COLORS.info} bold>{header}</Text>
        </Box>
      ) : null}
      {visibleItems.map((item, index) => {
        const absoluteIndex = scrollTop + index;
        const isSelected = absoluteIndex === selectedIndex;

        return (
          <Box key={item.id} flexDirection="column">
            <Text color={isSelected ? COLORS.user : undefined} bold={isSelected}>
              {isSelected ? '>' : ' '} {item.label}
            </Text>
            {item.description ? (
              <Text dimColor>{item.description}</Text>
            ) : null}
          </Box>
        );
      })}
      {items.length > visibleHeight ? (
        <Box justifyContent="space-between" marginTop={1}>
          <Text dimColor>{scrollTop > 0 ? '^' : ' '}</Text>
          <Text dimColor>{selectedIndex + 1}/{items.length}</Text>
          <Text dimColor>{scrollTop + visibleHeight < items.length ? 'v' : ' '}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
