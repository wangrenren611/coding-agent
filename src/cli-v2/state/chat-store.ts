import { useCallback, useReducer } from 'react';
import type { Message, MessageStatus, ToolInvocation, UIEvent } from './types';

const MAX_MESSAGES = 200;

const isTerminalStatus = (state?: string): boolean => {
  if (!state) return false;
  const normalized = state.toLowerCase();
  return (
    normalized === 'completed' ||
    normalized === 'success' ||
    normalized === 'succeeded' ||
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'aborted'
  );
};

interface ChatState {
  messages: Message[];
  isLoading: boolean;
}

const initialState: ChatState = {
  messages: [],
  isLoading: false,
};

type ChatAction =
  | { type: 'ADD_USER'; payload: { id: string; content: string } }
  | { type: 'ADD_SYSTEM'; payload: { level: 'info' | 'warn' | 'error'; content: string; details?: string } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'CLEAR' }
  | { type: 'APPLY_EVENT'; payload: UIEvent };

const trimMessages = (messages: Message[]): Message[] => {
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
};

const ensureAssistantMessage = (messages: Message[], messageId: string, timestamp: number): Message[] => {
  const existing = messages.find(m => m.type === 'assistant' && m.id === messageId);
  if (existing) return messages;
  return [
    ...messages,
    {
      type: 'assistant',
      id: messageId,
      content: '',
      status: 'streaming',
      timestamp,
    },
  ];
};

const updateAssistant = (
  messages: Message[],
  messageId: string,
  updater: (message: Extract<Message, { type: 'assistant' }>) => Extract<Message, { type: 'assistant' }>
): Message[] => {
  return messages.map(message => {
    if (message.type !== 'assistant' || message.id !== messageId) return message;
    return updater(message);
  });
};

const updateToolCall = (
  message: Extract<Message, { type: 'assistant' }>,
  toolCallId: string,
  updater: (toolCall: ToolInvocation) => ToolInvocation
): Extract<Message, { type: 'assistant' }> => {
  const toolCalls = message.toolCalls ?? [];
  const nextToolCalls = toolCalls.map(call => (call.id === toolCallId ? updater(call) : call));
  return {
    ...message,
    toolCalls: nextToolCalls,
  };
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'ADD_USER': {
      const nextMessages = trimMessages([
        ...state.messages,
        {
          type: 'user',
          id: action.payload.id,
          content: action.payload.content,
          timestamp: Date.now(),
        },
      ]);
      return {
        ...state,
        messages: nextMessages,
        isLoading: true,
      };
    }
    case 'ADD_SYSTEM': {
      const nextMessages = trimMessages([
        ...state.messages,
        {
          type: 'system',
          id: `system-${Date.now()}`,
          level: action.payload.level,
          content: action.payload.content,
          details: action.payload.details,
          timestamp: Date.now(),
        },
      ]);
      return { ...state, messages: nextMessages };
    }
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'CLEAR':
      return { ...initialState };
    case 'APPLY_EVENT': {
      const event = action.payload;
      switch (event.type) {
        case 'assistant-start': {
          const nextMessages = ensureAssistantMessage(state.messages, event.messageId, event.timestamp);
          return { ...state, messages: trimMessages(nextMessages) };
        }
        case 'assistant-delta': {
          const nextMessages = updateAssistant(state.messages, event.messageId, message => ({
            ...message,
            content: message.content + event.contentDelta,
            status: event.isDone ? 'complete' : 'streaming',
          }));
          return { ...state, messages: nextMessages };
        }
        case 'assistant-complete': {
          const nextMessages = updateAssistant(state.messages, event.messageId, message => ({
            ...message,
            content: event.content ?? message.content,
            status: 'complete',
          }));
          return { ...state, messages: nextMessages };
        }
        case 'tool-start': {
          const withAssistant = ensureAssistantMessage(state.messages, event.messageId, event.timestamp);
          const nextMessages = updateAssistant(withAssistant, event.messageId, message => ({
            ...message,
            status: message.status,
            toolCalls: [
              ...(message.toolCalls ?? []),
              {
                id: event.toolCallId,
                name: event.toolName,
                args: event.args,
                status: 'running',
                startedAt: event.timestamp,
              },
            ],
          }));
          return { ...state, messages: trimMessages(nextMessages) };
        }
        case 'tool-complete': {
          const nextMessages = updateAssistant(state.messages, event.messageId, message =>
            updateToolCall(message, event.toolCallId, toolCall => ({
              ...toolCall,
              status: 'success',
              result: event.result,
              duration: event.duration,
              completedAt: event.timestamp,
            }))
          );
          return { ...state, messages: nextMessages };
        }
        case 'tool-error': {
          const nextMessages = updateAssistant(state.messages, event.messageId, message =>
            updateToolCall(message, event.toolCallId, toolCall => ({
              ...toolCall,
              status: 'error',
              error: event.error,
              duration: event.duration,
              completedAt: event.timestamp,
            }))
          );
          return { ...state, messages: nextMessages };
        }
        case 'error': {
          const nextMessages = trimMessages([
            ...state.messages,
            {
              type: 'system',
              id: `system-${Date.now()}`,
              level: 'error',
              content: event.message,
              details: event.phase,
              timestamp: Date.now(),
            },
          ]);
          return { ...state, messages: nextMessages, isLoading: false };
        }
        case 'status': {
          if (!event.state) return state;
          const loading = !isTerminalStatus(event.state);
          return { ...state, isLoading: loading };
        }
        case 'session-complete':
          return { ...state, isLoading: false };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

export interface UseChatStoreReturn {
  messages: Message[];
  isLoading: boolean;
  addUserMessage: (content: string) => string;
  applyEvent: (event: UIEvent) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string, details?: string) => void;
}

export function useChatStore(): UseChatStoreReturn {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  const addUserMessage = useCallback((content: string) => {
    const id = `user-${Date.now()}`;
    dispatch({ type: 'ADD_USER', payload: { id, content } });
    return id;
  }, []);

  const applyEvent = useCallback((event: UIEvent) => {
    dispatch({ type: 'APPLY_EVENT', payload: event });
  }, []);

  const clearMessages = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading });
  }, []);

  const addSystemMessage = useCallback((level: 'info' | 'warn' | 'error', content: string, details?: string) => {
    dispatch({ type: 'ADD_SYSTEM', payload: { level, content, details } });
  }, []);

  return {
    messages: state.messages,
    isLoading: state.isLoading,
    addUserMessage,
    applyEvent,
    clearMessages,
    setLoading,
    addSystemMessage,
  };
}
