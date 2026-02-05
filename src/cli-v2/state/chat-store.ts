/**
 * cli-v2 Chat Store
 *
 * React hook for managing chat state using useReducer
 */

import { useReducer, useCallback, useMemo } from 'react';
import type { UIEvent, Message, ChatAction } from './types';
import { chatReducer, initialState } from './reducer';

/**
 * Action creators for type-safe dispatching
 */
export const chatActions = {
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

  setExecutionState: (state: 'idle' | 'running' | 'thinking' | 'error' | 'completed', message?: string): ChatAction => ({
    type: 'set-execution-state',
    payload: { state, message },
  }),

  setStatusMessage: (message?: string): ChatAction => ({
    type: 'set-status-message',
    payload: { message },
  }),
};

/**
 * Chat Store Hook Return Type
 */
export interface ChatStore {
  // State
  messages: Message[];
  executionState: 'idle' | 'running' | 'thinking' | 'error' | 'completed';
  statusMessage?: string;
  streamingMessageId: string | null;
  isLoading: boolean;

  // Actions
  dispatch: React.Dispatch<ChatAction>;
  addUserMessage: (content: string) => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string) => void;
  applyEvent: (event: UIEvent) => void;
  clearMessages: () => void;
  setLoading: (isLoading: boolean) => void;
  setExecutionState: (state: 'idle' | 'running' | 'thinking' | 'error' | 'completed', message?: string) => void;
  setStatusMessage: (message?: string) => void;
}

/**
 * useChatStore - Main hook for chat state management
 *
 * Provides a complete state management solution for the CLI chat interface,
 * handling message assembly from stream events using useReducer.
 *
 * @example
 * ```tsx
 * const {
 *   messages,
 *   isLoading,
 *   addUserMessage,
 *   applyEvent,
 * } = useChatStore();
 *
 * // Handle user input
 * const handleSubmit = (input: string) => {
 *   addUserMessage(input);
 *   agent.execute(input);
 * };
 *
 * // Handle stream events from StreamAdapter
 * adapter.on('event', applyEvent);
 * ```
 */
export function useChatStore(): ChatStore {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  // Memoized action wrappers for stable references
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

  const setExecutionState = useCallback((state: 'idle' | 'running' | 'thinking' | 'error' | 'completed', message?: string) => {
    dispatch(chatActions.setExecutionState(state, message));
  }, []);

  const setStatusMessage = useCallback((message?: string) => {
    dispatch(chatActions.setStatusMessage(message));
  }, []);

  // Derive isLoading from executionState
  const isLoading = useMemo(() => {
    return state.executionState === 'running' || state.executionState === 'thinking';
  }, [state.executionState]);


  return {
    // State
    messages: state.messages,
    executionState: state.executionState,
    statusMessage: state.statusMessage,
    streamingMessageId: state.streamingMessageId,
    isLoading,

    // Actions
    dispatch,
    addUserMessage,
    addSystemMessage,
    applyEvent,
    clearMessages,
    setLoading,
    setExecutionState,
    setStatusMessage,
  };
}

/**
 * Export types for external use
 */
export type { ChatState, Message, UIEvent, ChatAction } from './types';
