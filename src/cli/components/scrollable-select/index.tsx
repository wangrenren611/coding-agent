/**
 * Scrollable Select Component
 *
 * 使用键盘管理器的可滚动选择组件
 * 支持在固定高度内滚动选择大量选项
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import {
  useKeyboard,
  useGlobalKeyboard,
  HandlerPriority,
  type AppMode
} from '../../context';

/**
 * 选择项接口
 */
export interface SelectItem {
  label: string;
  value: any;
  key?: string;
}

/**
 * 组件属性
 */
interface ScrollableSelectProps {
  /** 可选项列表 */
  items: SelectItem[];
  /** 选中项的回调 */
  onSelect: (item: SelectItem) => void;
  /** 取消的回调 */
  onCancel?: () => void;
  /** 可见选项数量 */
  visibleCount?: number;
  /** 容器固定高度 */
  height?: number;
  /** 最大高度 */
  maxHeight?: number;
  /** 是否启用（用于键盘管理器） */
  enabled?: boolean;
  /** 组件 ID（用于键盘管理器） */
  id?: string;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  visibleCount: 5,
  maxHeight: 10,
  priority: HandlerPriority.MODAL,
} as const;

/**
 * ScrollableSelect 组件
 */
export const ScrollableSelect: React.FC<ScrollableSelectProps> = ({
  items,
  onSelect,
  onCancel,
  visibleCount = DEFAULT_CONFIG.visibleCount,
  height,
  maxHeight = DEFAULT_CONFIG.maxHeight,
  enabled = true,
  id = 'scrollable-select',
}) => {
  const { mode } = useKeyboard();

  // 内部状态
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  // 计算显示高度
  const displayHeight = useMemo(() => {
    if (height) return height;
    return Math.min(visibleCount, maxHeight, items.length);
  }, [height, visibleCount, maxHeight, items.length]);

  // 计算可见范围
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, scrollTop);
    const endIndex = Math.min(items.length, startIndex + displayHeight);
    return { startIndex, endIndex };
  }, [scrollTop, displayHeight, items.length]);

  // 可见项目
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.startIndex, visibleRange.endIndex);
  }, [items, visibleRange]);

  // 滚动到指定索引
  const scrollToIndex = useCallback((index: number) => {
    const targetIndex = Math.max(0, Math.min(index, items.length - 1));

    // 如果目标在可见范围内，只更新选中项
    if (targetIndex >= visibleRange.startIndex && targetIndex < visibleRange.endIndex) {
      setSelectedIndex(targetIndex);
      return;
    }

    // 计算新的 scrollTop
    let newScrollTop = targetIndex;
    if (targetIndex >= scrollTop + displayHeight) {
      newScrollTop = targetIndex - displayHeight + 1;
    }
    if (targetIndex < scrollTop) {
      newScrollTop = targetIndex;
    }

    setScrollTop(newScrollTop);
    setSelectedIndex(targetIndex);
  }, [items.length, scrollTop, displayHeight, visibleRange]);

  // 处理选择
  const handleSelect = useCallback(() => {
    if (items[selectedIndex]) {
      onSelect(items[selectedIndex]);
    }
  }, [items, selectedIndex, onSelect]);

  // 处理取消
  const handleCancel = useCallback(() => {
    if (onCancel) {
      onCancel();
    }
  }, [onCancel]);

  // 键盘事件处理
  const handleKeyDown = useCallback(({ key }: { key: any }) => {
    // 向上箭头
    if (key.upArrow) {
      scrollToIndex(selectedIndex - 1);
      return true;
    }

    // 向下箭头
    if (key.downArrow) {
      scrollToIndex(selectedIndex + 1);
      return true;
    }

    // Page Up
    if (key.pageUp) {
      scrollToIndex(selectedIndex - displayHeight);
      return true;
    }

    // Page Down
    if (key.pageDown) {
      scrollToIndex(selectedIndex + displayHeight);
      return true;
    }

    // Home
    if (key.home) {
      scrollToIndex(0);
      return true;
    }

    // End
    if (key.end) {
      scrollToIndex(items.length - 1);
      return true;
    }

    // Enter - 确认选择
    if (key.return) {
      handleSelect();
      return true;
    }

    // Escape - 取消
    if (key.escape) {
      handleCancel();
      return true;
    }

    return false;
  }, [selectedIndex, displayHeight, items.length, scrollToIndex, handleSelect, handleCancel]);

  // 注册键盘处理器
  useGlobalKeyboard({
    id: `${id}-navigation`,
    priority: DEFAULT_CONFIG.priority,
    activeModes: enabled ? [mode as AppMode] : [],
    handler: handleKeyDown,
  });

  // 没有选项时的提示
  if (items.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>没有可选项</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={displayHeight}>
      {/* 选择列表 */}
      <Box flexDirection="column" overflow="hidden">
        {visibleItems.map((item, index) => {
          const globalIndex = visibleRange.startIndex + index;
          const isSelected = globalIndex === selectedIndex;

          return (
            <Box key={item.key ?? String(globalIndex)}>
              <Text
                color={isSelected ? 'cyan' : 'white'}
                backgroundColor={isSelected ? 'blue' : undefined}
                bold={isSelected}
              >
                {isSelected ? '→ ' : '  '}
                {item.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* 滚动指示器 */}
      {items.length > displayHeight ? (
        <Box justifyContent="space-between" paddingX={1}>
          <Text dimColor>
            {visibleRange.startIndex > 0 ? '▲' : null}
          </Text>
          <Text dimColor>
            {selectedIndex + 1}/{items.length}
          </Text>
          <Text dimColor>
            {visibleRange.endIndex < items.length ? '▼' : null}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};

/**
 * 命令选择器专用组件
 */
interface CommandSelectorProps {
  /** 命令列表 */
  commands: SelectItem[];
  /** 选择回调 */
  onSelect: (command: SelectItem) => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 搜索关键词 */
  searchQuery?: string;
  /** 可见数量 */
  visibleCount?: number;
}

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  commands,
  onSelect,
  onCancel,
  searchQuery = '',
  visibleCount = 6,
}) => {
  // 过滤后的项目
  const filteredItems = useMemo(() => {
    if (!searchQuery) {
      return commands;
    }

    const lowerQuery = searchQuery.toLowerCase();
    return commands.filter(item => item.label.toLowerCase().includes(lowerQuery));
  }, [commands, searchQuery]);

  // 如果有搜索但无结果
  if (searchQuery && filteredItems.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>没有找到匹配项</Text>
      </Box>
    );
  }

  return (
    <ScrollableSelect
      items={filteredItems}
      onSelect={onSelect}
      onCancel={onCancel}
      visibleCount={visibleCount}
      height={visibleCount + 1}
      id="command-selector"
    />
  );
};

export default ScrollableSelect;
