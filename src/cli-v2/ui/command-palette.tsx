import React, { useMemo } from 'react';
import { SelectList, type SelectItem } from './select-list';

export interface Command {
  id: string;
  label: string;
  description?: string;
  run: () => void;
}

interface CommandPaletteProps {
  query: string;
  commands: Command[];
  isActive: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  query,
  commands,
  isActive,
  onClose,
}) => {
  const items = useMemo<SelectItem[]>(() => {
    const trimmed = query.startsWith('/') ? query.slice(1).toLowerCase() : query.toLowerCase();
    const filtered = commands.filter(command => {
      if (!trimmed) return true;
      return command.label.toLowerCase().includes(trimmed) || command.description?.toLowerCase().includes(trimmed);
    });

    return filtered.map(command => ({
      id: command.id,
      label: command.label,
      description: command.description,
    }));
  }, [commands, query]);

  const handleSelect = (item: SelectItem) => {
    const command = commands.find(cmd => cmd.id === item.id);
    command?.run();
  };

  if (!isActive) return null;

  return (
    <SelectList
      items={items}
      onSelect={handleSelect}
      onCancel={onClose}
      isActive={isActive}
      header="Commands"
    />
  );
};
