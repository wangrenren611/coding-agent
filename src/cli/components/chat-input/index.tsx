/**
 * Chat Input Component
 *
 * 支持命令选择和消息输入
 * 使用键盘管理器统一处理键盘事件
 * 支持上下键切换输入历史
 *
 * 注意：在 typing 模式下使用局部的 useInput 处理上下键历史导航
 * 因为全局的 KeyboardManager 在该模式下被禁用，避免与 Input 组件冲突
 */

import Input from 'ink-text-input';
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';
import {
  useKeyboard,
  type AppMode,
} from '../../context';
import { CommandSelector, SelectItem } from '../scrollable-select';
import { useInputHistory } from '../../hooks';

interface ChatInputProps {
  /** 提交回调 */
  onSubmit?: (value: string) => void;
  /** 占位符文本 */
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSubmit: externalOnSubmit,
  placeholder = 'Enter your message or /command...'
}) => {
  const { mode, setMode } = useKeyboard();

  // 使用输入历史管理
  const {
    inputValue,
    setInputValue,
    submitInput,
    hasPrevious,
    hasNext,
    navigatePrevious,
    navigateNext,
    resetNavigation,
  } = useInputHistory({ maxHistory: 100 });

  // 用于强制刷新 Input 组件
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => {
    if (mode.startsWith('page-')) {
      setInputValue('');
      resetNavigation();
    }
  }, [mode, setInputValue, resetNavigation]);

  // 命令到页面模式的映射
  const commandToPageMode: Record<string, AppMode> = {
    '/init': 'page-init',
    '/help': 'page-help',
    '/model-select': 'page-model-select',
    '/settings': 'page-settings',
    '/memory': 'page-memory',
    '/history': 'page-history',
    '/session': 'page-session',
    '/new-session': 'page-new-session',
    '/delete-session': 'page-delete-session',
    '/list-sessions': 'page-list-sessions',
    '/export': 'page-export',
    '/import': 'page-import',
    '/config': 'page-config',
    '/version': 'page-version',
    '/about': 'page-about',
    '/debug': 'page-debug',
    '/status': 'page-status',
    '/reset': 'page-reset',
  };

  // 命令列表
  const commandList: SelectItem[] = [
    { label: '/help', value: '/help' },
    { label: '/model-select', value: '/model-select' },
    { label: '/exit', value: '/exit' },
    { label: '/clear', value: '/clear' },
  ];

  // 检查是否为命令输入
  const checkCommand = (v: string): boolean => {
    return v.startsWith('/') && commandList.some(item => item.label.includes(v));
  };

  // 处理值变化
  const handleChange = (newValue: string) => {
    setInputValue(newValue);
    // 根据输入内容切换模式
    if (checkCommand(newValue)) {
      setMode('commandSelect');
    } else {
      setMode('typing');
    }
  };

  // 处理提交
  const handleSubmit = (submittedValue: string) => {
    // 如果是命令，切换到命令选择模式
    if (mode !== 'typing') {
      return;
    }

    // 触发外部提交回调
    if (externalOnSubmit && submittedValue.trim()) {
      externalOnSubmit(submittedValue);
      // 将输入添加到历史
      submitInput(submittedValue);
    }

    // 清空输入
    setInputValue('');
    resetNavigation();
    // 强制刷新 Input 组件
    setInputKey(prev => prev + 1);
  };

  // 处理命令选择
  const handleSelectCommand = (item: SelectItem) => {
    const commandValue = item.value;
    setInputValue(item.label);
    setMode('typing');

    // 特殊命令：/exit 直接退出，/clear 清空输入
    if (commandValue === '/exit') {
      process.exit(0);
    }

    if (commandValue === '/clear') {
      setInputValue('');
      resetNavigation();
      return;
    }

    // 其他命令：切换到对应的页面模式
    const pageMode = commandToPageMode[commandValue];

    if (pageMode) {
      setMode(pageMode);
    }
  };

  // 处理取消命令选择
  const handleCancelCommand = () => {
    setMode('typing');
  };

  // =============================================================================
  // 键盘事件处理 - 上下键切换历史
  // =============================================================================

  // 使用局部的 useInput 处理上下键历史导航
  // 注意：只在 typing 模式下激活，避免与其他键盘处理器冲突
  useInput((_, key) => {
    // 只处理上下箭头键，其他键由 Input 组件处理
    if (key.upArrow && hasPrevious) {
      navigatePrevious();
      setInputKey(prev => prev + 1);
      return;
    }

    if (key.downArrow && hasNext) {
      navigateNext();
      setInputKey(prev => prev + 1);
      return;
    }
  }, {
    isActive: mode === 'typing'  // 只在 typing 模式下激活
  });

  // 计算历史导航提示
  const historyHint = (() => {
    if (hasPrevious && hasNext) {
      return ' (↑↓ history)';
    }
    if (hasPrevious) {
      return ' (↑ history)';
    }
    if (hasNext) {
      return ' (↓ history)';
    }
    return '';
  })();

  return (
    <Box flexDirection="column" width="100%">
      {/* 输入框 */}
      <Box width="100%" borderColor="gray" borderStyle="single" borderLeft={false} borderRight={false}>
        <Text>{'> '}</Text>
        <Input
          key={inputKey}
          value={inputValue}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
        {historyHint && (
          <Text dimColor>{historyHint}</Text>
        )}
      </Box>
      {/* 命令选择器 - 只在 commandSelect 模式显示 */}
      {mode === 'commandSelect' && (
        <Box height={10} flexDirection="column">
          <Box paddingX={1} borderBottom={true} borderColor="gray">
            <Text bold color="cyan">Commands</Text>
            <Text dimColor> (↑↓ navigate, Page翻页, Enter select, Esc cancel, Ctrl+C exit)</Text>
          </Box>
          <Box marginTop={0}>
            <CommandSelector
              commands={commandList}
              searchQuery={inputValue}
              onSelect={handleSelectCommand}
              onCancel={handleCancelCommand}
              visibleCount={6}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ChatInput;
