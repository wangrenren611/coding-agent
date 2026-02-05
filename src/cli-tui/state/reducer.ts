/**
 * cli-tui State Reducer
 * OpenTUI-optimized state management
 */

import type { ChatState, UIEvent, Message, ToolInvocation } from '../types';
import { v4 as uuid } from 'uuid';

// ==================== Initial State ====================

export const initialState: ChatState = {
  messages: [],
  executionState: 'idle',
  statusMessage: undefined,
  streamingMessageId: null,
};

// ==================== Message Factories ====================

function createUserMessage(content: string): Message {
  return {
    id: uuid(),
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

function createAssistantMessage(messageId: string, initialContent = ''): Message {
  return {
    id: messageId,
    role: 'assistant',
    content: initialContent,
    isStreaming: true,
    status: 'streaming',
    timestamp: Date.now(),
    toolCalls: [],
  };
}

function createSystemMessage(level: 'info' | 'warn' | 'error', content: string): Message {
  return {
    id: uuid(),
    role: 'system',
    level,
    content,
    timestamp: Date.now(),
  };
}

// ==================== Message Operations ====================

function findMessageIndex(messages: Message[], messageId: string): number {
  return messages.findIndex(m => m.id === messageId);
}

function updateMessage(
  messages: Message[],
  messageId: string,
  updates: Partial<Omit<Message, 'role'>>
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const newMessages = [...messages];
  const message = newMessages[index];
  newMessages[index] = { ...message, ...updates } as Message;
  return newMessages;
}

function updateAssistantContent(
  messages: Message[],
  messageId: string,
  contentDelta: string
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (message.role !== 'assistant') return messages;

  const newMessages = [...messages];
  newMessages[index] = {
    ...message,
    content: message.content + contentDelta,
  };
  return newMessages;
}

function completeAssistantMessage(
  messages: Message[],
  messageId: string,
  finalContent?: string
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (message.role !== 'assistant') return messages;

  const newMessages = [...messages];
  newMessages[index] = {
    ...message,
    content: finalContent ?? message.content,
    isStreaming: false,
    status: 'completed',
  };
  return newMessages;
}

// ==================== Tool Call Operations ====================

function addToolCallToMessage(
  messages: Message[],
  messageId: string,
  toolCall: ToolInvocation
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (message.role !== 'assistant') return messages;

  const newMessages = [...messages];
  const toolCalls = [...(message.toolCalls || []), toolCall];
  newMessages[index] = { ...message, toolCalls };
  return newMessages;
}

function updateToolCall(
  messages: Message[],
  messageId: string,
  toolCallId: string,
  updates: Partial<ToolInvocation>
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (message.role !== 'assistant' || !message.toolCalls) return messages;

  const toolCalls = message.toolCalls.map(tc =>
    tc.id === toolCallId ? { ...tc, ...updates } : tc
  );

  const newMessages = [...messages];
  newMessages[index] = { ...message, toolCalls };
  return newMessages;
}

function appendToolStreamOutput(
  messages: Message[],
  messageId: string,
  toolCallId: string,
  output: string
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (message.role !== 'assistant' || !message.toolCalls) return messages;

  const toolCalls = message.toolCalls.map(tc => {
    if (tc.id !== toolCallId) return tc;
    return {
      ...tc,
      streamOutput: (tc.streamOutput ?? '') + output,
    };
  });

  const newMessages = [...messages];
  newMessages[index] = { ...message, toolCalls };
  return newMessages;
}

// ==================== Event Handlers ====================

function handleTextStart(state: ChatState, event: Extract<UIEvent, { type: 'text-start' }>): ChatState {
  const { messageId } = event;
  const existing = state.messages.find(m => m.id === messageId);

  if (existing) {
    return { ...state, streamingMessageId: messageId };
  }

  const newMessage = createAssistantMessage(messageId, '');
  return {
    ...state,
    messages: [...state.messages, newMessage],
    streamingMessageId: messageId,
    executionState: 'running',
  };
}

function handleTextDelta(state: ChatState, event: Extract<UIEvent, { type: 'text-delta' }>): ChatState {
  const { messageId, contentDelta } = event;
  return {
    ...state,
    messages: updateAssistantContent(state.messages, messageId, contentDelta),
  };
}

function handleTextComplete(state: ChatState, event: Extract<UIEvent, { type: 'text-complete' }>): ChatState {
  const { messageId, content } = event;
  return {
    ...state,
    messages: completeAssistantMessage(state.messages, messageId, content),
    streamingMessageId: null,
  };
}

function handleToolStart(state: ChatState, event: Extract<UIEvent, { type: 'tool-start' }>): ChatState {
  const { messageId, toolCallId, toolName, args, timestamp, content } = event;
  let messages = state.messages;

  let message = messages.find(m => m.id === messageId);
  if (!message) {
    const newMessage = createAssistantMessage(messageId, content ?? '');
    messages = [...messages, newMessage];
    message = newMessage;
  } else if (content && message.role === 'assistant' && !message.content) {
    const index = findMessageIndex(messages, messageId);
    messages = [...messages];
    (messages[index] as Message).content = content;
  }

  const toolCall: ToolInvocation = {
    id: toolCallId,
    name: toolName,
    args,
    status: 'running',
    startedAt: timestamp,
  };

  messages = addToolCallToMessage(messages, messageId, toolCall);
  return { ...state, messages };
}

function handleToolStream(state: ChatState, event: Extract<UIEvent, { type: 'tool-stream' }>): ChatState {
  const { messageId, toolCallId, output } = event;
  return {
    ...state,
    messages: appendToolStreamOutput(state.messages, messageId, toolCallId, output),
  };
}

function handleToolComplete(state: ChatState, event: Extract<UIEvent, { type: 'tool-complete' }>): ChatState {
  const { messageId, toolCallId, result, duration, timestamp } = event;
  return {
    ...state,
    messages: updateToolCall(state.messages, messageId, toolCallId, {
      status: 'success',
      result,
      duration,
      completedAt: timestamp,
    }),
  };
}

function handleToolError(state: ChatState, event: Extract<UIEvent, { type: 'tool-error' }>): ChatState {
  const { messageId, toolCallId, error, duration, timestamp } = event;
  return {
    ...state,
    messages: updateToolCall(state.messages, messageId, toolCallId, {
      status: 'error',
      error,
      duration,
      completedAt: timestamp,
    }),
  };
}

function handleCodePatch(state: ChatState, event: Extract<UIEvent, { type: 'code-patch' }>): ChatState {
  const { path, diff } = event;
  const content = `\n📝 Code patch: ${path}\n${diff}\n`;
  return {
    ...state,
    messages: [...state.messages, createSystemMessage('info', content)],
  };
}

function handleStatus(state: ChatState, event: Extract<UIEvent, { type: 'status' }>): ChatState {
  const { state: eventState, message } = event;

  let executionState: ChatState['executionState'] = state.executionState;
  if (eventState) {
    const normalized = eventState.toLowerCase();
    if (normalized === 'running' || normalized === 'thinking') {
      executionState = normalized === 'thinking' ? 'thinking' : 'running';
    } else if (normalized === 'completed' || normalized === 'success') {
      executionState = 'completed';
    } else if (normalized === 'failed' || normalized === 'error') {
      executionState = 'error';
    }
  }

  return {
    ...state,
    executionState,
    statusMessage: message,
  };
}

function handleSessionComplete(state: ChatState): ChatState {
  return {
    ...state,
    executionState: 'completed',
    streamingMessageId: null,
  };
}

function handleError(state: ChatState, event: Extract<UIEvent, { type: 'error' }>): ChatState {
  return {
    ...state,
    messages: [...state.messages, createSystemMessage('error', event.message)],
    executionState: 'error',
  };
}

function handleUIEvent(state: ChatState, event: UIEvent): ChatState {
  switch (event.type) {
    case 'text-start':
      return handleTextStart(state, event);
    case 'text-delta':
      return handleTextDelta(state, event);
    case 'text-complete':
      return handleTextComplete(state, event);
    case 'tool-start':
      return handleToolStart(state, event);
    case 'tool-stream':
      return handleToolStream(state, event);
    case 'tool-complete':
      return handleToolComplete(state, event);
    case 'tool-error':
      return handleToolError(state, event);
    case 'code-patch':
      return handleCodePatch(state, event);
    case 'status':
      return handleStatus(state, event);
    case 'session-complete':
      return handleSessionComplete(state);
    case 'error':
      return handleError(state, event);
    default:
      return state;
  }
}

// ==================== Main Reducer ====================

export type ChatAction =
  | { type: 'add-user-message'; payload: { content: string } }
  | { type: 'add-system-message'; payload: { level: 'info' | 'warn' | 'error'; content: string } }
  | { type: 'apply-event'; payload: { event: UIEvent } }
  | { type: 'clear-messages' }
  | { type: 'set-loading'; payload: { isLoading: boolean } }
  | { type: 'set-execution-state'; payload: { state: ChatState['executionState']; message?: string } }
  | { type: 'set-status-message'; payload: { message?: string } };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'add-user-message':
      return {
        ...state,
        messages: [...state.messages, createUserMessage(action.payload.content)],
        executionState: 'running',
      };

    case 'add-system-message':
      return {
        ...state,
        messages: [
          ...state.messages,
          createSystemMessage(action.payload.level, action.payload.content),
        ],
      };

    case 'apply-event':
      return handleUIEvent(state, action.payload.event);

    case 'clear-messages':
      return {
        ...state,
        messages: [],
        executionState: 'idle',
        statusMessage: undefined,
        streamingMessageId: null,
      };

    case 'set-loading': {
      const isLoading = action.payload.isLoading;
      return {
        ...state,
        executionState: isLoading ? 'running' : 'idle',
        statusMessage: isLoading ? 'Processing...' : undefined,
      };
    }

    case 'set-execution-state':
      return {
        ...state,
        executionState: action.payload.state,
        statusMessage: action.payload.message,
      };

    case 'set-status-message':
      return {
        ...state,
        statusMessage: action.payload.message,
      };

    default:
      return state;
  }
}
