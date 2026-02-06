/**
 * cli-tui Chat Store
 *
 * Context-backed chat state for agent + UI integration.
 */

import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react';
import type { AgentExecutionState, ChatAction, Message, UIEvent } from '../types';
import { chatReducer, initialState } from './reducer';

const chatActions = {
  addUserMessage: (content: string): ChatAction => ({
    type: 'add-user-message',
    payload: { content },
  }),
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string): ChatAction => ({
    type: 'add-system-message',
    payload: { level, content },
  }),
  applyEvent: (event: UIEvent): ChatAction => ({
    type: 'apply-event',
    payload: { event },
  }),
  clearMessages: (): ChatAction => ({
    type: 'clear-messages',
  }),
  setLoading: (isLoading: boolean): ChatAction => ({
    type: 'set-loading',
    payload: { isLoading },
  }),
  setExecutionState: (state: AgentExecutionState, message?: string): ChatAction => ({
    type: 'set-execution-state',
    payload: { state, message },
  }),
  setStatusMessage: (message?: string): ChatAction => ({
    type: 'set-status-message',
    payload: { message },
  }),
};

export interface ChatStore {
  messages: Message[];
  executionState: AgentExecutionState;
  statusMessage?: string;
  streamingMessageId: string | null;
  isLoading: boolean;
  dispatch: React.Dispatch<ChatAction>;
  addUserMessage: (content: string) => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string) => void;
  applyEvent: (event: UIEvent) => void;
  clearMessages: () => void;
  setLoading: (isLoading: boolean) => void;
  setExecutionState: (state: AgentExecutionState, message?: string) => void;
  setStatusMessage: (message?: string) => void;
}

const ChatStoreContext = createContext<ChatStore | null>(null);

const useChatStoreInternal = (): ChatStore => {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  const addUserMessage = useCallback((content: string) => {
    dispatch(chatActions.addUserMessage(content));
  }, []);

  const addSystemMessage = useCallback((level: 'info' | 'warn' | 'error', content: string) => {
    dispatch(chatActions.addSystemMessage(level, content));
  }, []);

  const applyEvent = useCallback((event: UIEvent) => {
    dispatch(chatActions.applyEvent(event));
  }, []);

  const clearMessages = useCallback(() => {
    dispatch(chatActions.clearMessages());
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    dispatch(chatActions.setLoading(isLoading));
  }, []);

  const setExecutionState = useCallback((executionState: AgentExecutionState, message?: string) => {
    dispatch(chatActions.setExecutionState(executionState, message));
  }, []);

  const setStatusMessage = useCallback((message?: string) => {
    dispatch(chatActions.setStatusMessage(message));
  }, []);

  const isLoading = useMemo(() => {
    return state.executionState === 'running' || state.executionState === 'thinking';
  }, [state.executionState]);

  return {
    messages: state.messages,
    executionState: state.executionState,
    statusMessage: state.statusMessage,
    streamingMessageId: state.streamingMessageId,
    isLoading,
    dispatch,
    addUserMessage,
    addSystemMessage,
    applyEvent,
    clearMessages,
    setLoading,
    setExecutionState,
    setStatusMessage,
  };
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const store = useChatStoreInternal();
  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>;
};

export const useChatStore = (): ChatStore => {
  const context = useContext(ChatStoreContext);
  if (!context) {
    throw new Error('useChatStore must be used within ChatProvider');
  }
  return context;
};
