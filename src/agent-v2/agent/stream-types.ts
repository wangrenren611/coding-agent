import { AgentStatus } from "./types";



/**
 * Agent 消息事件类型：涵盖了从思考到执行的全生命周期
 */
export enum AgentMessageType {
  // 文本流
  THOUGHT = 'thought',           // Agent 的推理过程
  TEXT = 'text',                 // Agent 的最终回复
  
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
interface BaseAgentMessage {
  sessionId: string;   // 会话 ID
  timestamp: number;   // 毫秒时间戳
}

/**
 * 1. 思考与文本
 */
interface ThoughtMessage extends BaseAgentMessage {
  type: AgentMessageType.THOUGHT;
  payload: { content: string };
  msgId: string;       // 你后端生成的唯一逻辑 ID

}

interface TextMessage extends BaseAgentMessage {
  type: AgentMessageType.TEXT;
  payload: { content: string };
  msgId: string;       // 你后端生成的唯一逻辑 ID
}

interface ToolCall {
        callId: string;    // LLM 返回的 tool_call_id
        toolName: string;
        args: string;      // 原始参数字符串或 JSON
}
/**
 * 2. 工具调用过程
 */
interface ToolCallCreatedMessage extends BaseAgentMessage {
  type: AgentMessageType.TOOL_CALL_CREATED;
  payload: {
      tool_calls: ToolCall[];
  };
  msgId: string;       // 你后端生成的唯一逻辑 ID
}

interface ToolCallStreamMessage extends BaseAgentMessage {
  type: AgentMessageType.TOOL_CALL_STREAM;
  payload: {
    callId: string;
    output: string;    // 实时吐出的日志片段
  };
}

interface ToolCallResultMessage extends BaseAgentMessage {
  type: AgentMessageType.TOOL_CALL_RESULT;
  payload: {
    callId: string;
    status: 'success' | 'error';
    result: any;       // 工具返回的完整结果
    exitCode?: number;
  };
}

/**
 * 3. 代码补丁（用于渲染 Diff 视图）
 */
interface CodePatchMessage extends BaseAgentMessage {
  type: AgentMessageType.CODE_PATCH;
  payload: {
    path: string;      // 文件相对路径
    diff: string;      // 标准 Unified Diff 格式
    language?: string; // 编程语言
  };
  msgId: string;       // 你后端生成的唯一逻辑 ID
}

/**
 * 4. 状态反馈
 */
interface StatusMessage extends BaseAgentMessage {
  type: AgentMessageType.STATUS;
  payload: {
    state: AgentStatus;
    message?: string;
  };
  msgId?: string;       // 你后端生成的唯一逻辑 ID
}

/**
 * 统一联合类型
 */
export type AgentMessage = 
  | ThoughtMessage 
  | TextMessage 
  | ToolCallCreatedMessage 
  | ToolCallStreamMessage 
  | ToolCallResultMessage 
  | CodePatchMessage 
  | StatusMessage;