// ==================== Session Types ====================

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export interface CreateSessionOptions {
  title?: string
  id?: string
}

// ==================== Message Types ====================

export type MessageRole = 'user' | 'assistant' | 'tool'

export type MessageType = 'text' | 'tool-call' | 'tool-result' | 'status'

export interface BaseMessage {
  id?: string
  messageId: string
  role: MessageRole
  type: MessageType
  content: string
  timestamp?: number
  finish_reason?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ToolCall extends BaseMessage {
  type: 'tool-call'
  tool_calls?: ToolCallInfo[]
}

export interface ToolResult extends BaseMessage {
  type: 'tool-result'
  tool_call_id: string
}

export interface StatusMessage extends BaseMessage {
  type: 'status'
  status: AgentStatus
}

export type Message = BaseMessage | ToolCall | ToolResult | StatusMessage

export interface ToolCallInfo {
  callId: string
  toolName: string
  args: string
  status?: 'pending' | 'running' | 'success' | 'error'
  result?: string
}

// ==================== Agent Status ====================

export enum AgentStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  THINKING = 'thinking',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ABORTED = 'aborted',
  RETRYING = 'retrying',
}

// ==================== Stream Event Types ====================

export enum StreamEventType {
  TEXT = 'text',
  TOOL_CALL_CREATED = 'tool_call_created',
  TOOL_CALL_RESULT = 'tool_call_result',
  STATUS = 'status',
  ERROR = 'error',
}

export interface StreamEvent {
  type: StreamEventType
  payload: unknown
  msgId?: string
  sessionId: string
  timestamp: number
}

export interface TextStreamEvent extends StreamEvent {
  type: StreamEventType.TEXT
  payload: { content: string }
}

export interface ToolCallCreatedEvent extends StreamEvent {
  type: StreamEventType.TOOL_CALL_CREATED
  payload: {
    tool_calls: Array<{
      callId: string
      toolName: string
      args: string
    }>
  }
}

export interface ToolCallResultEvent extends StreamEvent {
  type: StreamEventType.TOOL_CALL_RESULT
  payload: {
    callId: string
    result: string
    status: 'success' | 'error'
  }
}

export interface StatusStreamEvent extends StreamEvent {
  type: StreamEventType.STATUS
  payload: {
    state: AgentStatus
    message: string
  }
}

export interface ErrorStreamEvent extends StreamEvent {
  type: StreamEventType.ERROR
  payload: {
    error: string
  }
}

export type AgentStreamEvent =
  | TextStreamEvent
  | ToolCallCreatedEvent
  | ToolCallResultEvent
  | StatusStreamEvent
  | ErrorStreamEvent

// ==================== Tool Categories ====================

export enum ToolCategory {
  FILE_OPERATIONS = 'file_operations',
  COMMAND_TOOLS = 'command_tools',
  WEB_TOOLS = 'web_tools',
  TASK_TOOLS = 'task_tools',
  OTHER = 'other',
}

export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // File operations
  read_file: ToolCategory.FILE_OPERATIONS,
  write_file: ToolCategory.FILE_OPERATIONS,
  glob: ToolCategory.FILE_OPERATIONS,
  grep: ToolCategory.FILE_OPERATIONS,

  // Command tools
  bash: ToolCategory.COMMAND_TOOLS,

  // Web tools
  web_search: ToolCategory.WEB_TOOLS,
  web_fetch: ToolCategory.WEB_TOOLS,

  // Task tools
  task: ToolCategory.TASK_TOOLS,
  todo_create: ToolCategory.TASK_TOOLS,
  todo_get_all: ToolCategory.TASK_TOOLS,
  todo_apply_ops: ToolCategory.TASK_TOOLS,
}

export function getToolCategory(toolName: string): ToolCategory {
  return TOOL_CATEGORIES[toolName] || ToolCategory.OTHER
}

// ==================== UI State Types ====================

export interface ChatState {
  messages: Message[]
  agentStatus: AgentStatus
  isStreaming: boolean
  currentMessageId: string | null
  toolCalls: Map<string, ToolCallInfo>
  error: string | null
}

export interface SessionState {
  sessions: Session[]
  currentSessionId: string | null
  isLoading: boolean
}

// ==================== API Request/Response Types ====================

export interface ChatRequest {
  message: string
  sessionId: string
}

export interface ChatResponse {
  success: boolean
  sessionId: string
  messageId?: string
}

export interface CreateSessionRequest {
  title?: string
}

export interface CreateSessionResponse {
  session: Session
}

export interface ListSessionsResponse {
  sessions: Session[]
}

export interface GetSessionResponse {
  session: Session | null
}

export interface DeleteSessionResponse {
  success: boolean
}
