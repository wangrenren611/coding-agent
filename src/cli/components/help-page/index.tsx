import { Box, Text } from "ink";
import { HandlerPriority, useGlobalKeyboard } from "../../context";
import React from "react";

interface CommandDetailPageProps {
  onBack: () => void;
}

export const HelpPage: React.FC<CommandDetailPageProps> = ({ onBack }) => {
  // 注册 Esc 键返回
  useGlobalKeyboard({
    id: 'page-help',
    priority: HandlerPriority.NAVIGATION,
    activeModes: ['page-help'],
    handler: ({ key }) => {
      if (key.escape) {
        onBack();
        return true;
      }
      return false;
    }
  });

  // 命令详情配置
  const commandDetails = {
    title: 'Help',
    description: 'Display help information for commands',
    content: `
Usage: /help [command]

Display help information for the specified command.
If no command is specified, shows a list of available commands.

Available Commands:
  /help          Show this help message
  /model-select  Select AI model
  /exit          Exit the application
  /clear         Clear the current input

Examples:
  /help
  /help
      `
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* 标题栏 */}
      <Box marginBottom={1}>
        <Text bold color="cyan">{commandDetails.title}</Text>
        <Text dimColor> - {commandDetails.description}</Text>
      </Box>

      {/* 分隔线 */}
      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* 内容 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text>{commandDetails.content.trim()}</Text>
      </Box>

      {/* 底部提示 */}
      <Box marginTop={1}>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    </Box>
  );
};
