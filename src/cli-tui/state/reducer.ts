/**
 * cli-tui State Reducer
 *
 * Handles UI events and assembles message state.
 */

import { v4 as uuid } from 'uuid';
import type { ChatAction, ChatState, Message, ToolInvocation, UIEvent } from '../types';

export const initialState: ChatState = {
  messages: [],
  executionState: 'idle',
  statusMessage: undefined,
  streamingMessageId: null,
};

function createUserMessage(content: string): Message {
  return {
    id: uuid(),
    role: 'user',
    content,
    timestamp: Date.now(),
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

function createAssistantMessage(messageId: string, initialContent = ''): Message {
  return {
    id: messageId,
    role: 'assistant',
    content: initialContent,
    isStreaming: true,
    status: 'streaming',
    timestamp: Date.now(),
    toolCalls: undefined,
  };
}

function createToolInvocation(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  timestamp: number
): ToolInvocation {
  return {
    id: toolCallId,
    name: toolName,
    args,
    status: 'running',
    startedAt: timestamp,
  };
}

function findMessageIndex(messages: Message[], messageId: string): number {
  return messages.findIndex(message => message.id === messageId);
}

function findMessage(messages: Message[], messageId: string): Message | undefined {
  return messages.find(message => message.id === messageId);
}

function isAssistantMessage(message: Message): boolean {
  return message.role === 'assistant';
}

function updateAssistantContent(messages: Message[], messageId: string, contentDelta: string): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const current = messages[index];
  if (!isAssistantMessage(current)) return messages;

  const next = [...messages];
  next[index] = {
    ...current,
    content: current.content + contentDelta,
  };
  return next;
}

function completeAssistantMessage(messages: Message[], messageId: string, finalContent?: string): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const current = messages[index];
  if (!isAssistantMessage(current)) return messages;

  const next = [...messages];
  next[index] = {
    ...current,
    content: finalContent ?? current.content,
    isStreaming: false,
    status: 'completed',
  };
  return next;
}

function addToolCallToMessage(messages: Message[], messageId: string, toolCall: ToolInvocation): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const current = messages[index];
  if (!isAssistantMessage(current)) return messages;

  const next = [...messages];
  next[index] = {
    ...current,
    toolCalls: [...(current.toolCalls ?? []), toolCall],
  };
  return next;
}

function updateToolCall(
  messages: Message[],
  messageId: string,
  toolCallId: string,
  updates: Partial<ToolInvocation>
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const current = messages[index];
  if (!isAssistantMessage(current) || !current.toolCalls) return messages;

  const next = [...messages];
  next[index] = {
    ...current,
    toolCalls: current.toolCalls.map(toolCall =>
      toolCall.id === toolCallId ? { ...toolCall, ...updates } : toolCall
    ),
  };
  return next;
}

function appendToolStreamOutput(
  messages: Message[],
  messageId: string,
  toolCallId: string,
  output: string
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const current = messages[index];
  if (!isAssistantMessage(current) || !current.toolCalls) return messages;

  const next = [...messages];
  next[index] = {
    ...current,
    toolCalls: current.toolCalls.map(toolCall =>
      toolCall.id === toolCallId
        ? { ...toolCall, streamOutput: (toolCall.streamOutput ?? '') + output }
        : toolCall
    ),
  };
  return next;
}

function handleTextStart(state: ChatState, event: Extract<UIEvent, { type: 'text-start' }>): ChatState {
  const { messageId } = event;
  if (findMessage(state.messages, messageId)) {
    return {
      ...state,
      streamingMessageId: messageId,
    };
  }

  return {
    ...state,
    messages: [...state.messages, createAssistantMessage(messageId, '')],
    streamingMessageId: messageId,
    executionState: 'running',
  };
}

function handleTextDelta(state: ChatState, event: Extract<UIEvent, { type: 'text-delta' }>): ChatState {
  return {
    ...state,
    messages: updateAssistantContent(state.messages, event.messageId, event.contentDelta),
  };
}

function handleTextComplete(state: ChatState, event: Extract<UIEvent, { type: 'text-complete' }>): ChatState {
  return {
    ...state,
    messages: completeAssistantMessage(state.messages, event.messageId, event.content),
    streamingMessageId: null,
  };
}

function handleToolStart(state: ChatState, event: Extract<UIEvent, { type: 'tool-start' }>): ChatState {
  const { messageId, toolCallId, toolName, args, timestamp, content } = event;
  let messages = state.messages;

  const existingMessage = findMessage(messages, messageId);
  if (!existingMessage) {
    messages = [...messages, createAssistantMessage(messageId, content ?? '')];
  } else if (content && existingMessage.role === 'assistant' && !existingMessage.content) {
    const index = findMessageIndex(messages, messageId);
    const next = [...messages];
    next[index] = {
      ...next[index],
      content,
    };
    messages = next;
  }

  const toolCall = createToolInvocation(toolCallId, toolName, args, timestamp);
  messages = addToolCallToMessage(messages, messageId, toolCall);

  return {
    ...state,
    messages,
  };
}

function handleToolStream(state: ChatState, event: Extract<UIEvent, { type: 'tool-stream' }>): ChatState {
  return {
    ...state,
    messages: appendToolStreamOutput(state.messages, event.messageId, event.toolCallId, event.output),
  };
}

function handleToolComplete(state: ChatState, event: Extract<UIEvent, { type: 'tool-complete' }>): ChatState {
  return {
    ...state,
    messages: updateToolCall(state.messages, event.messageId, event.toolCallId, {
      status: 'success',
      result: event.result,
      duration: event.duration,
      completedAt: event.timestamp,
    }),
  };
}

function handleToolError(state: ChatState, event: Extract<UIEvent, { type: 'tool-error' }>): ChatState {
  return {
    ...state,
    messages: updateToolCall(state.messages, event.messageId, event.toolCallId, {
      status: 'error',
      error: event.error,
      duration: event.duration,
      completedAt: event.timestamp,
    }),
  };
}

function handleCodePatch(state: ChatState, event: Extract<UIEvent, { type: 'code-patch' }>): ChatState {
  const content = `[code-patch] ${event.path}\n${event.diff}`;
  return {
    ...state,
    messages: [...state.messages, createSystemMessage('info', content)],
  };
}

function handleStatus(state: ChatState, event: Extract<UIEvent, { type: 'status' }>): ChatState {
  let executionState: ChatState['executionState'] = state.executionState;

  if (event.state) {
    const normalized = event.state.toLowerCase();
    if (normalized === 'running' || normalized === 'thinking') {
      executionState = normalized === 'thinking' ? 'thinking' : 'running';
    } else if (normalized === 'completed' || normalized === 'success') {
      executionState = 'completed';
    } else if (normalized === 'failed' || normalized === 'error') {
      executionState = 'error';
    } else if (normalized === 'idle') {
      executionState = 'idle';
    }
  }

  return {
    ...state,
    executionState,
    statusMessage: event.message,
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
        messages: [...state.messages, createSystemMessage(action.payload.level, action.payload.content)],
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
    case 'set-messages':
      return {
        ...state,
        messages: action.payload.messages,
        executionState: 'idle',
        streamingMessageId: null,
      };
    case 'set-loading':
      return {
        ...state,
        executionState: action.payload.isLoading ? 'running' : 'idle',
        statusMessage: action.payload.isLoading ? 'Processing...' : undefined,
      };
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
