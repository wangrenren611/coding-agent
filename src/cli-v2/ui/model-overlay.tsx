import React, { useMemo } from 'react';
import { ProviderRegistry, type ModelId } from '../../providers';
import { SelectList, type SelectItem } from './select-list';

interface ModelOverlayProps {
  currentModel: ModelId;
  isActive: boolean;
  onSelect: (model: ModelId) => void;
  onClose: () => void;
}

export const ModelOverlay: React.FC<ModelOverlayProps> = ({
  currentModel,
  isActive,
  onSelect,
  onClose,
}) => {
  const items = useMemo<SelectItem[]>(() => {
    return ProviderRegistry.listModels().map(model => ({
      id: model.id,
      label: model.name,
      description: model.id === currentModel ? 'current' : model.id,
    }));
  }, [currentModel]);

  if (!isActive) return null;

  return (
    <SelectList
      items={items}
      onSelect={(item) => onSelect(item.id as ModelId)}
      onCancel={onClose}
      isActive={isActive}
      header="Models"
      height={8}
    />
  );
};
