/**
 * cli-tui Chat Store
 * React Context API for state management
 */

import React, { createContext, useContext, useReducer } from 'react';
import type { ChatState, Message } from '../types';
import type { ChatAction } from './reducer';
import { chatReducer, initialState } from './reducer';

interface ChatContextValue {
  state: ChatState;
  dispatch: (action: ChatAction) => void;
  messages: Message[];
  executionState: ChatState['executionState'];
  statusMessage?: string;
  isLoading: boolean;
  addUserMessage: (content: string) => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string) => void;
  applyEvent: (event: import('../types').UIEvent) => void;
  clearMessages: () => void;
  setLoading: (isLoading: boolean) => void;
  setExecutionState: (state: ChatState['executionState'], message?: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  const addUserMessage = (content: string) => {
    dispatch({ type: 'add-user-message', payload: { content } });
  };

  const addSystemMessage = (level: 'info' | 'warn' | 'error', content: string) => {
    dispatch({ type: 'add-system-message', payload: { level, content } });
  };

  const applyEvent = (event: import('../types').UIEvent) => {
    dispatch({ type: 'apply-event', payload: { event } });
  };

  const clearMessages = () => {
    dispatch({ type: 'clear-messages' });
  };

  const setLoading = (isLoading: boolean) => {
    dispatch({ type: 'set-loading', payload: { isLoading } });
  };

  const setExecutionState = (state: ChatState['executionState'], message?: string) => {
    dispatch({ type: 'set-execution-state', payload: { state, message } });
  };

  const value: ChatContextValue = {
    state,
    dispatch,
    messages: state.messages,
    executionState: state.executionState,
    statusMessage: state.statusMessage,
    isLoading: state.executionState === 'running' || state.executionState === 'thinking',
    addUserMessage,
    addSystemMessage,
    applyEvent,
    clearMessages,
    setLoading,
    setExecutionState,
  };

  return <ChatContext value={value}>{children}</ChatContext>;
}

export function useChatStore(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatStore must be used within ChatProvider');
  }
  return context;
}
