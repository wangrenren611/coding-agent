import { Box, Text } from "ink";
import React from "react";
import { HandlerPriority, useGlobalKeyboard } from "../../context";
import { CommandSelector } from "../scrollable-select";
import { ProviderRegistry, type ModelId } from "../../../providers";

import { useAppContext } from "../../context";

export const ModelSelect: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { setModel } = useAppContext();

  useGlobalKeyboard({
    id: 'page-model-select',
    priority: HandlerPriority.NAVIGATION,
    activeModes: ['page-model-select'],
    handler: ({ key }) => {
      if (key.escape) {
        onBack();
        return true;
      }
      return false;
    }
  });

  const handleSelectCommand = (item: {
    value: string;
    label: string;
  }) => {
    setModel(item.value as ModelId);
    onBack();
  };

  const handleCancelCommand = () => {
    onBack();
  };

  // 获取所有模型，显示名称和 ID
  const modelOptions = ProviderRegistry.listModels().map((model) => ({
    value: model.id,
    label: `${model.name} (${model.LLMMAX_TOKENS.toLocaleString()} tokens)`,
  }));

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Model Select</Text>
      <Text dimColor> (↑↓ navigate Page翻页 Enter select Esc cancel, Ctrl+C exit)</Text>
      <CommandSelector
        commands={modelOptions}
        onSelect={handleSelectCommand}
        onCancel={handleCancelCommand}
        visibleCount={8}
      />
    </Box>
  );
};

export default ModelSelect;
