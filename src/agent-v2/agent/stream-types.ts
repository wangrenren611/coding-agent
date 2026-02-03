import { AgentStatus } from "./types";



/**
 * Agent 消息事件类型：涵盖了从思考到执行的全生命周期
 */
export enum AgentMessageType {
  // 文本流
  TEXT_START = 'text-start',                 // Agent 的最终部分回复
  TEXT_DELTA = 'text-delta',                 // Agent 的最终部分回复
  TEXT_COMPLETE = 'text-complete',                 // Agent 的最终回复结束

  // 工具流
  TOOL_CALL_CREATED = 'tool_call_created',  // 准备调用工具（含参数）
  TOOL_CALL_STREAM = 'tool_call_stream',    // 工具执行中的实时日志（如终端输出）
  TOOL_CALL_RESULT = 'tool_call_result',    // 工具执行结果

  // 代码变更流
  CODE_PATCH = 'code_patch',     // 代码 Diff 变更

  // 状态流
  STATUS = 'status',             // 任务状态切换（loading, error, finished）
  ERROR = 'error'                // 系统级异常
}

/**
 * 基础消息结构：所有流式包必须携带 msgId
 */
export interface BaseAgentMessage {
  sessionId: string;   // 会话 ID
  timestamp: number;   // 毫秒时间戳
}

/**
 * 文本开始消息
 */
export interface TextStartMessage extends BaseAgentMessage {
  type: AgentMessageType.TEXT_START;
  payload: { content: string };
  msgId: string;       // 你后端生成的唯一逻辑 ID
}

/**
 * 思考/文本增量消息
 */
export interface ThoughtMessage extends BaseAgentMessage {
  type: AgentMessageType.TEXT_DELTA;
  payload: { content: string };
  msgId: string;       // 你后端生成的唯一逻辑 ID
}

/**
 * 文本完成消息
 */
export interface TextMessage extends BaseAgentMessage {
  type: AgentMessageType.TEXT_COMPLETE;
  payload: { content: string };
  msgId: string;       // 你后端生成的唯一逻辑 ID
}

export interface ToolCall {
  callId: string;    // LLM 返回的 tool_call_id
  toolName: string;
  args: string;      // 原始参数字符串或 JSON
}

/**
 * 工具调用创建消息
 */
export interface ToolCallCreatedMessage extends BaseAgentMessage {
  type: AgentMessageType.TOOL_CALL_CREATED;
  payload: {
    tool_calls: ToolCall[];
    /** Optional plain-text content returned together with tool_calls (non-streaming path) */
    content?: string;
  };
  msgId: string;       // 你后端生成的唯一逻辑 ID
}

/**
 * 工具调用流式输出消息
 */
export interface ToolCallStreamMessage extends BaseAgentMessage {
  type: AgentMessageType.TOOL_CALL_STREAM;
  payload: {
    callId: string;
    output: string;    // 实时吐出的日志片段
  };
}

/**
 * 工具调用结果消息
 */
export interface ToolCallResultMessage extends BaseAgentMessage {
  type: AgentMessageType.TOOL_CALL_RESULT;
  payload: {
    callId: string;
    status: 'success' | 'error';
    result: any;       // 工具返回的完整结果
    exitCode?: number;
  };
}

/**
 * 代码补丁消息（用于渲染 Diff 视图）
 */
export interface CodePatchMessage extends BaseAgentMessage {
  type: AgentMessageType.CODE_PATCH;
  payload: {
    path: string;      // 文件相对路径
    diff: string;      // 标准 Unified Diff 格式
    language?: string; // 编程语言
  };
  msgId: string;       // 你后端生成的唯一逻辑 ID
}

/**
 * 状态消息
 */
export interface StatusMessage extends BaseAgentMessage {
  type: AgentMessageType.STATUS;
  payload: {
    state: AgentStatus;
    message?: string;
  };
  msgId?: string;       // 你后端生成的唯一逻辑 ID
}

/**
 * 错误消息
 */
export interface ErrorMessage extends BaseAgentMessage {
  type: AgentMessageType.ERROR;
  payload: {
    error: string;
    phase?: string;
  };
}

/**
 * 统一联合类型
 */
export type AgentMessage =
  | TextStartMessage
  | ThoughtMessage
  | TextMessage
  | ToolCallCreatedMessage
  | ToolCallStreamMessage
  | ToolCallResultMessage
  | CodePatchMessage
  | StatusMessage
  | ErrorMessage;
