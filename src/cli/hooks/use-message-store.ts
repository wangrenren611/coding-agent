/**
 * 消息状态管理 Hook
 *
 * 使用 Reducer 模式管理消息状态，提供可预测的状态更新
 * 职责：
 * 1. 管理 UIMessage 列表状态
 * 2. 处理各种 UIEvent 并更新状态
 * 3. 提供消息查询和分组功能
 */

import { useReducer, useCallback, useMemo } from 'react';
import type {
  UIMessage,
  UserMessage,
  AssistantTextMessage,
  AssistantToolMessage,
  SystemMessage,
  ToolInvocation,
  UIEvent,
  MessageRenderGroup,
} from '../types/message-types';

// =============================================================================
// 状态定义
// =============================================================================

interface MessageState {
  /** 所有消息列表（按时间顺序） */
  messages: UIMessage[];
  /** 当前活跃的助手消息 ID（正在流式输出） */
  activeAssistantMessageId: string | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 当前步骤 */
  currentStep: number;
}

const initialState: MessageState = {
  messages: [],
  activeAssistantMessageId: null,
  isLoading: false,
  currentStep: 0,
};

// =============================================================================
// Action 类型
// =============================================================================

type MessageAction =
  | { type: 'ADD_USER_MESSAGE'; payload: { content: string; id: string } }
  | { type: 'START_ASSISTANT_MESSAGE'; payload: { messageId: string; hasToolCalls?: boolean } }
  | { type: 'APPEND_ASSISTANT_CONTENT'; payload: { messageId: string; contentDelta: string; isDone: boolean } }
  | { type: 'START_TOOL_CALLS'; payload: { messageId: string; toolCalls: ToolInvocation[] } }
  | { type: 'UPDATE_TOOL_CALL_STATUS'; payload: {
      messageId: string;
      toolCallId: string;
      status: ToolInvocation['status'];
      result?: unknown;
      error?: string;
      duration?: number;
    }}
  | { type: 'COMPLETE_ASSISTANT_MESSAGE'; payload: { messageId: string; finalContent?: string } }
  | { type: 'ADD_SYSTEM_MESSAGE'; payload: { level: SystemMessage['level']; content: string; details?: string } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_STEP'; payload: number }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'APPLY_EVENT'; payload: UIEvent };

// =============================================================================
// Reducer
// =============================================================================

function messageReducer(state: MessageState, action: MessageAction): MessageState {
  switch (action.type) {
    case 'ADD_USER_MESSAGE': {
      const userMessage: UserMessage = {
        type: 'user',
        id: action.payload.id,
        content: action.payload.content,
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: [...state.messages, userMessage],
        isLoading: true,
      };
    }

    case 'START_ASSISTANT_MESSAGE': {
      const assistantMessage: AssistantTextMessage = {
        type: 'assistant-text',
        id: action.payload.messageId,
        content: '',
        status: 'streaming',
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: [...state.messages, assistantMessage],
        activeAssistantMessageId: action.payload.messageId,
      };
    }

    case 'APPEND_ASSISTANT_CONTENT': {
      const { messageId, contentDelta, isDone } = action.payload;

      return {
        ...state,
        messages: state.messages.map((msg) => {
          if (msg.id !== messageId) return msg;

          if (msg.type === 'assistant-text') {
            return {
              ...msg,
              content: msg.content + contentDelta,
              status: isDone ? 'complete' : 'streaming',
            };
          }

          if (msg.type === 'assistant-tool' && !msg.toolCalls.every(tc => tc.status !== 'pending')) {
            return {
              ...msg,
              content: (msg.content || '') + contentDelta,
            };
          }

          return msg;
        }),
        activeAssistantMessageId: isDone ? null : state.activeAssistantMessageId,
      };
    }

    case 'START_TOOL_CALLS': {
      const { messageId, toolCalls } = action.payload;

      // 查找现有的助手消息
      const existingMsgIndex = state.messages.findIndex(
        m => m.id === messageId && (m.type === 'assistant-text' || m.type === 'assistant-tool')
      );

      if (existingMsgIndex === -1) {
        // 创建新的工具消息
        const toolMessage: AssistantToolMessage = {
          type: 'assistant-tool',
          id: messageId,
          content: '',
          toolCalls,
          status: 'streaming',
          timestamp: Date.now(),
        };
        return {
          ...state,
          messages: [...state.messages, toolMessage],
          activeAssistantMessageId: messageId,
        };
      }

      // 更新现有消息为工具消息类型
      return {
        ...state,
        messages: state.messages.map((msg, idx) => {
          if (idx !== existingMsgIndex) return msg;

          const existingContent = msg.type === 'assistant-text' ? msg.content : msg.content || '';

          return {
            type: 'assistant-tool',
            id: msg.id,
            content: existingContent,
            toolCalls,
            status: 'streaming',
            timestamp: msg.timestamp,
          } as AssistantToolMessage;
        }),
        activeAssistantMessageId: messageId,
      };
    }

    case 'UPDATE_TOOL_CALL_STATUS': {
      const { messageId, toolCallId, status, result, error, duration } = action.payload;

      return {
        ...state,
        messages: state.messages.map((msg) => {
          if (msg.id !== messageId || msg.type !== 'assistant-tool') return msg;

          const updatedToolCalls = msg.toolCalls.map((tc) => {
            if (tc.id !== toolCallId) return tc;

            return {
              ...tc,
              status,
              ...(result !== undefined && { result }),
              ...(error !== undefined && { error }),
              ...(duration !== undefined && { duration }),
              ...(status !== 'pending' && status !== 'running' && { completedAt: Date.now() }),
            };
          });

          // 检查是否所有工具调用都已完成
          const allCompleted = updatedToolCalls.every(tc => tc.status === 'success' || tc.status === 'error');

          return {
            ...msg,
            toolCalls: updatedToolCalls,
            status: allCompleted ? 'complete' : 'streaming',
          };
        }),
      };
    }

    case 'COMPLETE_ASSISTANT_MESSAGE': {
      const { messageId, finalContent } = action.payload;

      return {
        ...state,
        messages: state.messages.map((msg) => {
          if (msg.id !== messageId) return msg;

          if (msg.type === 'assistant-text') {
            return {
              ...msg,
              content: finalContent || msg.content,
              status: 'complete',
            };
          }

          if (msg.type === 'assistant-tool') {
            return {
              ...msg,
              content: finalContent || msg.content,
              status: 'complete',
            };
          }

          return msg;
        }),
        activeAssistantMessageId: null,
        isLoading: false,
      };
    }

    case 'ADD_SYSTEM_MESSAGE': {
      const systemMessage: SystemMessage = {
        type: 'system',
        id: `system-${Date.now()}`,
        level: action.payload.level,
        content: action.payload.content,
        timestamp: Date.now(),
        ...(action.payload.details && { details: action.payload.details }),
      };
      return {
        ...state,
        messages: [...state.messages, systemMessage],
      };
    }

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_STEP':
      return { ...state, currentStep: action.payload };

    case 'CLEAR_MESSAGES':
      return { ...initialState };

    case 'APPLY_EVENT': {
      const event = action.payload;

      switch (event.type) {
        case 'assistant-message-start':
          return messageReducer(state, {
            type: 'START_ASSISTANT_MESSAGE',
            payload: { messageId: event.messageId, hasToolCalls: event.hasToolCalls },
          });

        case 'assistant-message-delta':
          return messageReducer(state, {
            type: 'APPEND_ASSISTANT_CONTENT',
            payload: {
              messageId: event.messageId,
              contentDelta: event.contentDelta || '',
              isDone: event.isDone,
            },
          });

        case 'assistant-message-complete':
          return messageReducer(state, {
            type: 'COMPLETE_ASSISTANT_MESSAGE',
            payload: { messageId: event.messageId, finalContent: event.content },
          });

        case 'tool-invocation-start': {
          // 检查是否已存在该工具调用
          const existingMsg = state.messages.find(
            m => m.id === event.messageId && m.type === 'assistant-tool'
          );

          if (existingMsg) {
            // 更新现有消息
            return messageReducer(state, {
              type: 'START_TOOL_CALLS',
              payload: {
                messageId: event.messageId,
                toolCalls: [
                  ...(existingMsg as AssistantToolMessage).toolCalls,
                  {
                    id: event.toolCallId,
                    name: event.toolName,
                    args: event.args,
                    status: 'running',
                    startedAt: event.timestamp,
                  },
                ],
              },
            });
          }

          return messageReducer(state, {
            type: 'START_TOOL_CALLS',
            payload: {
              messageId: event.messageId,
              toolCalls: [{
                id: event.toolCallId,
                name: event.toolName,
                args: event.args,
                status: 'running',
                startedAt: event.timestamp,
              }],
            },
          });
        }

        case 'tool-invocation-complete':
          return messageReducer(state, {
            type: 'UPDATE_TOOL_CALL_STATUS',
            payload: {
              messageId: event.messageId,
              toolCallId: event.toolCallId,
              status: 'success',
              result: event.result,
              duration: event.duration,
            },
          });

        case 'tool-invocation-error':
          return messageReducer(state, {
            type: 'UPDATE_TOOL_CALL_STATUS',
            payload: {
              messageId: event.messageId,
              toolCallId: event.toolCallId,
              status: 'error',
              error: event.error,
              duration: event.duration,
            },
          });

        case 'error':
          return messageReducer(state, {
            type: 'ADD_SYSTEM_MESSAGE',
            payload: {
              level: 'error',
              content: event.error.message,
              details: event.phase,
            },
          });

        case 'session-complete':
          return { ...state, isLoading: false, activeAssistantMessageId: null };

        default:
          return state;
      }
    }

    default:
      return state;
  }
}

// =============================================================================
// Hook
// =============================================================================

export interface UseMessageStoreReturn {
  /** 所有消息 */
  messages: UIMessage[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 当前步骤 */
  currentStep: number;
  /** 活跃的助手消息 ID */
  activeAssistantMessageId: string | null;

  // Actions
  addUserMessage: (content: string, id: string) => void;
  startAssistantMessage: (messageId: string, hasToolCalls?: boolean) => void;
  appendAssistantContent: (messageId: string, contentDelta: string, isDone: boolean) => void;
  startToolCalls: (messageId: string, toolCalls: ToolInvocation[]) => void;
  updateToolCallStatus: (
    messageId: string,
    toolCallId: string,
    status: ToolInvocation['status'],
    result?: unknown,
    error?: string,
    duration?: number
  ) => void;
  completeAssistantMessage: (messageId: string, finalContent?: string) => void;
  addSystemMessage: (level: SystemMessage['level'], content: string, details?: string) => void;
  setLoading: (loading: boolean) => void;
  setStep: (step: number) => void;
  clearMessages: () => void;
  applyEvent: (event: UIEvent) => void;

  // Selectors
  getMessageGroups: () => MessageRenderGroup[];
  getLastUserMessage: () => UserMessage | undefined;
  getLastAssistantMessage: () => (AssistantTextMessage | AssistantToolMessage) | undefined;
}

export function useMessageStore(): UseMessageStoreReturn {
  const [state, dispatch] = useReducer(messageReducer, initialState);

  // Actions
  const addUserMessage = useCallback((content: string, id: string) => {
    dispatch({ type: 'ADD_USER_MESSAGE', payload: { content, id } });
  }, []);

  const startAssistantMessage = useCallback((messageId: string, hasToolCalls?: boolean) => {
    dispatch({ type: 'START_ASSISTANT_MESSAGE', payload: { messageId, hasToolCalls } });
  }, []);

  const appendAssistantContent = useCallback((messageId: string, contentDelta: string, isDone: boolean) => {
    dispatch({ type: 'APPEND_ASSISTANT_CONTENT', payload: { messageId, contentDelta, isDone } });
  }, []);

  const startToolCalls = useCallback((messageId: string, toolCalls: ToolInvocation[]) => {
    dispatch({ type: 'START_TOOL_CALLS', payload: { messageId, toolCalls } });
  }, []);

  const updateToolCallStatus = useCallback((
    messageId: string,
    toolCallId: string,
    status: ToolInvocation['status'],
    result?: unknown,
    error?: string,
    duration?: number
  ) => {
    dispatch({
      type: 'UPDATE_TOOL_CALL_STATUS',
      payload: { messageId, toolCallId, status, result, error, duration },
    });
  }, []);

  const completeAssistantMessage = useCallback((messageId: string, finalContent?: string) => {
    dispatch({ type: 'COMPLETE_ASSISTANT_MESSAGE', payload: { messageId, finalContent } });
  }, []);

  const addSystemMessage = useCallback((level: SystemMessage['level'], content: string, details?: string) => {
    dispatch({ type: 'ADD_SYSTEM_MESSAGE', payload: { level, content, details } });
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading });
  }, []);

  const setStep = useCallback((step: number) => {
    dispatch({ type: 'SET_STEP', payload: step });
  }, []);

  const clearMessages = useCallback(() => {
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  const applyEvent = useCallback((event: UIEvent) => {
    dispatch({ type: 'APPLY_EVENT', payload: event });
  }, []);

  // Selectors
  const getMessageGroups = useCallback((): MessageRenderGroup[] => {
    const groups: MessageRenderGroup[] = [];
    let currentGroup: MessageRenderGroup | null = null;
    let groupIndex = 0;

    for (const message of state.messages) {
      if (message.type === 'user') {
        // 用户消息开始新组
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          id: `group-${groupIndex++}`,
          groupType: 'user-turn',
          messages: [message],
        };
      } else if (message.type === 'assistant-text' || message.type === 'assistant-tool') {
        if (currentGroup?.groupType === 'assistant-turn') {
          // 继续助手组
          currentGroup.messages.push(message);
          currentGroup.isStreaming = message.status === 'streaming';
        } else {
          // 开始新的助手组
          if (currentGroup) {
            groups.push(currentGroup);
          }
          currentGroup = {
            id: `group-${groupIndex++}`,
            groupType: 'assistant-turn',
            messages: [message],
            isStreaming: message.status === 'streaming',
          };
        }
      } else if (message.type === 'system') {
        // 系统消息附加到当前组，或创建新组
        if (currentGroup) {
          currentGroup.messages.push(message);
        } else {
          currentGroup = {
            id: `group-${groupIndex++}`,
            groupType: 'assistant-turn',
            messages: [message],
          };
        }
      }
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }, [state.messages]);

  const getLastUserMessage = useCallback((): UserMessage | undefined => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].type === 'user') {
        return state.messages[i] as UserMessage;
      }
    }
    return undefined;
  }, [state.messages]);

  const getLastAssistantMessage = useCallback((): (AssistantTextMessage | AssistantToolMessage) | undefined => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg.type === 'assistant-text' || msg.type === 'assistant-tool') {
        return msg as AssistantTextMessage | AssistantToolMessage;
      }
    }
    return undefined;
  }, [state.messages]);

  return {
    messages: state.messages,
    isLoading: state.isLoading,
    currentStep: state.currentStep,
    activeAssistantMessageId: state.activeAssistantMessageId,
    addUserMessage,
    startAssistantMessage,
    appendAssistantContent,
    startToolCalls,
    updateToolCallStatus,
    completeAssistantMessage,
    addSystemMessage,
    setLoading,
    setStep,
    clearMessages,
    applyEvent,
    getMessageGroups,
    getLastUserMessage,
    getLastAssistantMessage,
  };
}

export default useMessageStore;
