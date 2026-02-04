/**
 * cli-v2 State Module
 *
 * Centralized state management for the CLI chat interface
 */

// Export all types
export type {
  // Message types
  MessageRole,
  BaseMessage,
  UserMessageContent,
  AssistantMessageContent,
  SystemMessageContent,
  MessageContent,
  ChatMessage,
  Message,
  ToolInvocationStatus,
  ToolInvocation,

  // UI Event types
  TextStartEvent,
  TextDeltaEvent,
  TextCompleteEvent,
  ToolStartEvent,
  ToolStreamEvent,
  ToolCompleteEvent,
  ToolErrorEvent,
  CodePatchEvent,
  StatusEvent,
  SessionCompleteEvent,
  ErrorEvent,
  UIEvent,

  // State types
  AgentExecutionState,
  ChatState,

  // Action types
  AddUserMessageAction,
  AddSystemMessageAction,
  ApplyEventAction,
  ClearMessagesAction,
  SetLoadingAction,
  SetExecutionStateAction,
  SetStatusMessageAction,
  ChatAction,

  // Helper types
  CreateMessageParams,
  CreateToolInvocationParams,
} from './types';

// Export reducer and initial state
export { chatReducer, initialState } from './reducer';

// Export chat store hook and action creators
export {
  useChatStore,
  chatActions,
  type ChatStore,
} from './chat-store';
