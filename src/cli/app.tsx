/**
 * Main Application Component
 *
 * Root component that sets up all providers and renders appropriate view
 */

import React, { useCallback } from 'react';
import { Box, useStdout } from 'ink';
import { ChatInput } from './components/chat-input';
import { MessageList } from './components/message-list';
import { useKeyboard } from './context';
import { HelpPage } from './components/help-page';
import { ModelSelect } from './components/model-select';
import Welcome from './components/welcome';
import useAgent from './hooks/use-agent';
import { useAppContext } from './context';
import { useGlobalShortcuts } from './context';

// ============================================================================
// Main App Component
// ============================================================================

const App: React.FC = () => {
  const { mode, setMode } = useKeyboard();
  const { model } = useAppContext();
  const { stdout } = useStdout();

  // 注册全局快捷键
  useGlobalShortcuts(() => process.exit(0));

  // Agent 状态管理
  const { messages, isLoading, submitMessage } = useAgent({
    model
  });

  // 处理消息提交
  const handleSubmit = useCallback((value: string) => {
    submitMessage(value);
  }, [submitMessage]);

  // 页面模式：显示对应的页面组件
  if (mode === 'page-help') {
    return <HelpPage onBack={() => setMode('typing')} />;
  }

  if (mode === 'page-model-select') {
    return <ModelSelect onBack={() => setMode('typing')} />;
  }

  // 默认视图：消息列表 + 输入框
  return (
    <Box flexDirection="column" width="100%">
      {/* 欢迎消息 - 只在第一次显示 */}
      {messages.length === 0 && <Welcome />}

      {/* 消息列表 */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        maxMessages={0}  // 0 表示不限制消息数量
      />

      {/* 输入框 - 固定在底部 */}
      <Box marginTop={1}>
        <ChatInput onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
};

export default App;
