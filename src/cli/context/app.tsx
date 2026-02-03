/**
 * App Context
 *
 * 应用全局状态管理
 */
import React from 'react';
import { createContext, useContext, useState } from 'react';
import type { ModelId } from '../../providers/types/registry';

// ============================================================================
// App Context Type
// ============================================================================

export type AppContextType = {
  model: ModelId;
  setModel: (model: ModelId) => void;
  currentPath: string;
};

// ============================================================================
// Default Context
// ============================================================================
const DefaultModel: ModelId = 'kimi-k2.5';
const AppContext = createContext<AppContextType>({
  model: DefaultModel,
  setModel: () => {},
  currentPath: process.cwd(),
});

// ============================================================================
// Provider Component
// ============================================================================

export const AppContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [model, setModel] = useState<ModelId>(DefaultModel);

  return (
    <AppContext.Provider
      value={{
        model,
        setModel,
        currentPath: process.cwd(),
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

// ============================================================================
// Hook
// ============================================================================

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppContextProvider');
  }
  return context;
};
