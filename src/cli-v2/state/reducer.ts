/**
 * cli-v2 State Reducer
 *
 * 处理来自 StreamAdapter 的 UI 事件，组装完整的消息
 */

import type {
  ChatState,
  ChatAction,
  Message,
  ToolInvocation,
  UIEvent,
} from './types';
import { v4 as uuid } from 'uuid';

// ==================== 初始状态 ====================

export const initialState: ChatState = {
  messages: [],
  executionState: 'idle',
  statusMessage: undefined,
  streamingMessageId: null,
};

// ==================== 消息工厂函数 ====================

/**
 * 创建用户消息
 */
function createUserMessage(content: string): Message {
  return {
    id: uuid(),
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

/**
 * 创建系统消息
 */
function createSystemMessage(level: 'info' | 'warn' | 'error', content: string): Message {
  return {
    id: uuid(),
    role: 'system',
    level,
    content,
    timestamp: Date.now(),
  };
}

/**
 * 创建助手消息
 */
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

/**
 * 创建工具调用
 */
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

// ==================== 消息查找和更新 ====================

/**
 * 查找消息索引
 */
function findMessageIndex(messages: Message[], messageId: string): number {
  return messages.findIndex(m => m.id === messageId);
}

/**
 * 查找消息
 */
function findMessage(messages: Message[], messageId: string): Message | undefined {
  return messages.find(m => m.id === messageId);
}

/**
 * 检查是否为助手消息
 */
function isAssistantMessage(message: Message): boolean {
  return message.role === 'assistant';
}

/**
 * 更新消息
 */
function updateMessage(messages: Message[], messageId: string, updates: Partial<Message>): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const newMessages = [...messages];
  newMessages[index] = { ...newMessages[index], ...updates };
  return newMessages;
}

/**
 * 更新助手消息内容
 */
function updateAssistantContent(messages: Message[], messageId: string, contentDelta: string): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (!isAssistantMessage(message)) return messages;

  const newMessages = [...messages];
  newMessages[index] = {
    ...message,
    content: message.content + contentDelta,
  };
  return newMessages;
}

/**
 * 完成助手消息
 */
function completeAssistantMessage(messages: Message[], messageId: string, finalContent?: string): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (!isAssistantMessage(message)) return messages;

  const newMessages = [...messages];
  newMessages[index] = {
    ...message,
    content: finalContent ?? message.content,
    isStreaming: false,
    status: 'completed',
  };
  return newMessages;
}

// ==================== 工具调用处理 ====================

/**
 * 添加工具调用到消息
 */
function addToolCallToMessage(
  messages: Message[],
  messageId: string,
  toolCall: ToolInvocation
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (!isAssistantMessage(message)) return messages;

  const existingToolCalls = message.toolCalls ?? [];
  const toolCalls = [...existingToolCalls, toolCall];

  const newMessages = [...messages];
  newMessages[index] = {
    ...message,
    toolCalls,
  };
  return newMessages;
}

/**
 * 更新工具调用
 */
function updateToolCall(
  messages: Message[],
  messageId: string,
  toolCallId: string,
  updates: Partial<ToolInvocation>
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (!isAssistantMessage(message) || !message.toolCalls) return messages;

  const toolCalls = message.toolCalls.map(tc =>
    tc.id === toolCallId ? { ...tc, ...updates } : tc
  );

  const newMessages = [...messages];
  newMessages[index] = {
    ...message,
    toolCalls,
  };
  return newMessages;
}

/**
 * 追加工具流式输出
 */
function appendToolStreamOutput(
  messages: Message[],
  messageId: string,
  toolCallId: string,
  output: string
): Message[] {
  const index = findMessageIndex(messages, messageId);
  if (index < 0) return messages;

  const message = messages[index];
  if (!isAssistantMessage(message) || !message.toolCalls) return messages;

  const toolCalls = message.toolCalls.map(tc => {
    if (tc.id !== toolCallId) return tc;
    return {
      ...tc,
      streamOutput: (tc.streamOutput ?? '') + output,
    };
  });

  const newMessages = [...messages];
  newMessages[index] = {
    ...message,
    toolCalls,
  };
  return newMessages;
}

// ==================== UI 事件处理 ====================

/**
 * 处理文本开始事件
 */
function handleTextStart(state: ChatState, event: Extract<UIEvent, { type: 'text-start' }>): ChatState {
  const { messageId } = event;

  // 如果已经存在该消息，不重复创建
  const existing = findMessage(state.messages, messageId);
  if (existing) {
    return {
      ...state,
      streamingMessageId: messageId,
    };
  }

  // 创建新的助手消息
  const newMessage = createAssistantMessage(messageId, '');

  return {
    ...state,
    messages: [...state.messages, newMessage],
    streamingMessageId: messageId,
    executionState: 'running',
  };
}

/**
 * 处理文本增量事件
 */
function handleTextDelta(state: ChatState, event: Extract<UIEvent, { type: 'text-delta' }>): ChatState {
  const { messageId, contentDelta } = event;

  return {
    ...state,
    messages: updateAssistantContent(state.messages, messageId, contentDelta),
  };
}

/**
 * 处理文本完成事件
 */
function handleTextComplete(state: ChatState, event: Extract<UIEvent, { type: 'text-complete' }>): ChatState {
  const { messageId, content } = event;

  return {
    ...state,
    messages: completeAssistantMessage(state.messages, messageId, content),
    streamingMessageId: null,
  };
}

/**
 * 处理工具开始事件
 */
function handleToolStart(state: ChatState, event: Extract<UIEvent, { type: 'tool-start' }>): ChatState {
  const { messageId, toolCallId, toolName, args, timestamp, content } = event;

  let messages = state.messages;

  // 如果消息不存在，先创建（可能非流式模式下工具先到达）
  let message = findMessage(messages, messageId);
  if (!message) {
    const newMessage = createAssistantMessage(messageId, content ?? '');
    messages = [...messages, newMessage];
    message = newMessage;
  } else if (content && isAssistantMessage(message) && !message.content) {
    // 补充消息内容（非流式模式）
    const index = findMessageIndex(messages, messageId);
    messages = [...messages];
    (messages[index] as Message).content = content;
  }

  // 添加工具调用
  const toolCall = createToolInvocation(toolCallId, toolName, args, timestamp);
  messages = addToolCallToMessage(messages, messageId, toolCall);

  return {
    ...state,
    messages,
  };
}

/**
 * 处理工具流式输出事件
 */
function handleToolStream(state: ChatState, event: Extract<UIEvent, { type: 'tool-stream' }>): ChatState {
  const { messageId, toolCallId, output } = event;

  return {
    ...state,
    messages: appendToolStreamOutput(state.messages, messageId, toolCallId, output),
  };
}

/**
 * 处理工具完成事件
 */
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

/**
 * 处理工具错误事件
 */
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

/**
 * 处理代码补丁事件
 */
function handleCodePatch(state: ChatState, event: Extract<UIEvent, { type: 'code-patch' }>): ChatState {
  // 代码补丁可以作为系统消息添加，或者附加到相关消息
  const { path, diff } = event;
  const content = `\n📝 Code patch: ${path}\n${diff}\n`;

  return {
    ...state,
    messages: [...state.messages, createSystemMessage('info', content)],
  };
}

/**
 * 处理状态事件
 */
function handleStatus(state: ChatState, event: Extract<UIEvent, { type: 'status' }>): ChatState {
  const { state: eventState, message } = event;

  // 映射状态
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

/**
 * 处理会话完成事件
 */
function handleSessionComplete(state: ChatState): ChatState {
  return {
    ...state,
    executionState: 'completed',
    streamingMessageId: null,
  };
}

/**
 * 处理错误事件
 */
function handleError(state: ChatState, event: Extract<UIEvent, { type: 'error' }>): ChatState {
  return {
    ...state,
    messages: [...state.messages, createSystemMessage('error', event.message)],
    executionState: 'error',
  };
}

/**
 * 处理 UI 事件
 */
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

// ==================== 主 Reducer ====================

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
