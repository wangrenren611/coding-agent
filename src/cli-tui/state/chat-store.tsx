/**
 * cli-tui Chat Store
 *
 * Context-backed chat state for agent + UI integration.
 * With persistent session storage support.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AgentExecutionState, ChatAction, Message, UIEvent } from '../types';
import { chatReducer, initialState } from './reducer';
import {
  type SessionInfo,
  type SessionStorage,
  initializeSessionStorage,
  closeSessionStorage,
  listSessions,
  createSession,
  saveMessage,
  deleteSession,
  switchSession,
  getOrCreateCurrentSession,
  sanitizeSessionMessagesForLLM,
} from './session-storage';

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
  // New actions for session management
  setMessages: (messages: Message[]): ChatAction => ({
    type: 'set-messages',
    payload: { messages },
  }),
};

// Extend ChatAction type for session management
declare module '../types' {
  interface ChatActionMap {
    'set-messages': { messages: Message[] };
  }
}

export interface ChatStore {
  // Messages and UI state
  messages: Message[];
  executionState: AgentExecutionState;
  statusMessage?: string;
  streamingMessageId: string | null;
  isLoading: boolean;

  // Session management
  sessions: SessionInfo[];
  currentSessionId: string | null;
  isStorageReady: boolean;

  // Actions
  dispatch: React.Dispatch<ChatAction>;
  addUserMessage: (content: string) => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string) => void;
  applyEvent: (event: UIEvent) => void;
  clearMessages: () => void;
  setLoading: (isLoading: boolean) => void;
  setExecutionState: (state: AgentExecutionState, message?: string) => void;
  setStatusMessage: (message?: string) => void;

  // Session actions
  createNewSession: (title?: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSessionById: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
}

const ChatStoreContext = createContext<ChatStore | null>(null);

const STORAGE_PATH = process.env.CODING_AGENT_SESSIONS_PATH || '.coding-agent/sessions';

const useChatStoreInternal = (): ChatStore => {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const storageRef = useRef<SessionStorage | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isStorageReady, setIsStorageReady] = useState(false);

  // Initialize storage on mount
  useEffect(() => {
    let mounted = true;

    async function initStorage() {
      try {
        const storage = await initializeSessionStorage(STORAGE_PATH);
        if (!mounted) {
          await closeSessionStorage(storage);
          return;
        }

        storageRef.current = storage;
        setIsStorageReady(true);

        // Load session list
        let sessionList = await listSessions(storage);

        // Ensure there is always a default active session before first message.
        if (sessionList.length === 0) {
          await getOrCreateCurrentSession(storage, '');
          sessionList = await listSessions(storage);
        } else {
          storage.currentSessionId = sessionList[0]?.sessionId ?? null;
          if (storage.currentSessionId) {
            const changed = await sanitizeSessionMessagesForLLM(storage, storage.currentSessionId);
            if (changed) {
              sessionList = await listSessions(storage);
            }
          }
        }

        setSessions(sessionList);
        setCurrentSessionId(storage.currentSessionId);
      } catch (error) {
        console.error('Failed to initialize session storage:', error);
        setIsStorageReady(false);
      }
    }

    initStorage();

    return () => {
      mounted = false;
      if (storageRef.current) {
        closeSessionStorage(storageRef.current);
        storageRef.current = null;
      }
    };
  }, []);

  // Auto-save messages when they change
  useEffect(() => {
    if (!isStorageReady || !storageRef.current) {
      return;
    }

    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && !lastMessage.isStreaming) {
      // UI system messages are local notifications and must not be sent back to LLM history.
      if (lastMessage.role === 'system') {
        return;
      }

      let cancelled = false;

      (async () => {
        const storage = storageRef.current;
        if (!storage) return;

        // Ensure there is always an active session before saving.
        if (!storage.currentSessionId) {
          await getOrCreateCurrentSession(storage, '');
          if (cancelled) return;
        }

        if (cancelled) return;
        await saveMessage(storage, lastMessage);
      })().catch(error => {
        console.error('Failed to save message:', error);
      });

      return () => {
        cancelled = true;
      };
    }
  }, [state.messages, isStorageReady]);

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

  // Session management actions
  const createNewSession = useCallback(async (title?: string): Promise<string> => {
    if (!storageRef.current) {
      throw new Error('Storage not initialized');
    }

    const systemPrompt = ''; // Will be set by agent
    const sessionId = await createSession(storageRef.current, systemPrompt, title);
    setCurrentSessionId(sessionId);

    // Clear current messages for new session
    dispatch(chatActions.clearMessages());

    // Refresh session list
    const sessionList = await listSessions(storageRef.current);
    setSessions(sessionList);

    return sessionId;
  }, []);

  const loadSession = useCallback(async (sessionId: string): Promise<void> => {
    if (!storageRef.current) {
      throw new Error('Storage not initialized');
    }

    const messages = await switchSession(storageRef.current, sessionId);
    setCurrentSessionId(sessionId);

    // Load messages into state
    dispatch(chatActions.setMessages(messages));
  }, []);

  const deleteSessionById = useCallback(async (sessionId: string): Promise<void> => {
    if (!storageRef.current) {
      throw new Error('Storage not initialized');
    }

    await deleteSession(storageRef.current, sessionId);

    // If deleting current session, clear messages
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
      dispatch(chatActions.clearMessages());
    }

    // Refresh session list
    const sessionList = await listSessions(storageRef.current);
    setSessions(sessionList);
  }, [currentSessionId]);

  const refreshSessions = useCallback(async (): Promise<void> => {
    if (!storageRef.current) {
      return;
    }

    const sessionList = await listSessions(storageRef.current);
    setSessions(sessionList);
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
    sessions,
    currentSessionId,
    isStorageReady,
    dispatch,
    addUserMessage,
    addSystemMessage,
    applyEvent,
    clearMessages,
    setLoading,
    setExecutionState,
    setStatusMessage,
    createNewSession,
    loadSession,
    deleteSessionById,
    refreshSessions,
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
