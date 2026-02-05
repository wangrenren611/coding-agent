/**
 * Web Types
 *
 * Re-exports from cli-v2 state management
 */

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
} from '../../../src/cli-v2/state/types'
