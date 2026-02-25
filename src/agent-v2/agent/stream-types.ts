import { AgentStatus } from './types';
import type { Usage } from '../../providers';

/**
 * Agent 消息事件类型：涵盖了从思考到执行的全生命周期
 */
export enum AgentMessageType {
    // 文本流
    TEXT_START = 'text-start', // Agent 开始生成文本回复
    TEXT_DELTA = 'text-delta', // Agent 的增量文本内容
    TEXT_COMPLETE = 'text-complete', // Agent 的文本回复结束

    // 推理流 (Reasoning - thinking 模式)
    REASONING_START = 'reasoning-start', // 开始推理/思考
    REASONING_DELTA = 'reasoning-delta', // 推理/思考增量内容
    REASONING_COMPLETE = 'reasoning-complete', // 推理/思考完成

    // 工具流
    TOOL_CALL_CREATED = 'tool_call_created', // 准备调用工具（含参数）
    TOOL_CALL_STREAM = 'tool_call_stream', // 工具执行中的实时日志（如终端输出）
    TOOL_CALL_RESULT = 'tool_call_result', // 工具执行结果

    // 代码变更流
    CODE_PATCH = 'code_patch', // 代码 Diff 变更

    // 资源使用流
    USAGE_UPDATE = 'usage_update', // Token 使用量更新

    // 状态流
    STATUS = 'status', // 任务状态切换（loading, error, finished）
    ERROR = 'error', // 系统级异常

    // 子 Agent 事件冒泡
    SUBAGENT_EVENT = 'subagent_event', // 子 Agent 事件冒泡到父会话
}

/**
 * 基础消息结构：所有流式包必须携带 msgId
 */
export interface BaseAgentMessage {
    sessionId: string; // 会话 ID
    timestamp: number; // 毫秒时间戳
}

/**
 * 文本开始消息
 */
export interface TextStartMessage extends BaseAgentMessage {
    type: AgentMessageType.TEXT_START;
    payload: { content: string };
    msgId: string; // 你后端生成的唯一逻辑 ID
}

/**
 * 思考/文本增量消息
 */
export interface ThoughtMessage extends BaseAgentMessage {
    type: AgentMessageType.TEXT_DELTA;
    payload: { content: string };
    msgId: string; // 你后端生成的唯一逻辑 ID
}

/**
 * 文本完成消息
 */
export interface TextMessage extends BaseAgentMessage {
    type: AgentMessageType.TEXT_COMPLETE;
    payload: { content: string };
    msgId: string; // 你后端生成的唯一逻辑 ID
}

/**
 * 推理开始消息 (thinking 模式)
 */
export interface ReasoningStartMessage extends BaseAgentMessage {
    type: AgentMessageType.REASONING_START;
    payload: { content: string };
    msgId: string;
}

/**
 * 推理增量消息 (thinking 模式)
 */
export interface ReasoningDeltaMessage extends BaseAgentMessage {
    type: AgentMessageType.REASONING_DELTA;
    payload: { content: string };
    msgId: string;
}

/**
 * 推理完成消息 (thinking 模式)
 */
export interface ReasoningCompleteMessage extends BaseAgentMessage {
    type: AgentMessageType.REASONING_COMPLETE;
    payload: { content: string };
    msgId: string;
}

export interface ToolCall {
    callId: string; // LLM 返回的 tool_call_id
    toolName: string;
    args: string; // 原始参数字符串或 JSON
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
    msgId: string; // 你后端生成的唯一逻辑 ID
}

/**
 * 工具调用流式输出消息
 */
export interface ToolCallStreamMessage extends BaseAgentMessage {
    type: AgentMessageType.TOOL_CALL_STREAM;
    payload: {
        callId: string;
        output: string; // 实时吐出的日志片段
    };
    msgId?: string; // 关联的消息 ID
}

/**
 * 工具调用结果消息
 */
export interface ToolCallResultMessage extends BaseAgentMessage {
    type: AgentMessageType.TOOL_CALL_RESULT;
    payload: {
        callId: string;
        status: 'success' | 'error';
        result: any; // 工具返回的完整结果
        exitCode?: number;
    };
    msgId?: string; // 关联的消息 ID
}

/**
 * 代码补丁消息（用于渲染 Diff 视图）
 */
export interface CodePatchMessage extends BaseAgentMessage {
    type: AgentMessageType.CODE_PATCH;
    payload: {
        path: string; // 文件相对路径
        diff: string; // 标准 Unified Diff 格式
        language?: string; // 编程语言
    };
    msgId: string; // 你后端生成的唯一逻辑 ID
}

export interface StatusRetryInfo {
    type: 'normal' | 'compensation';
    attempt: number;
    max?: number;
    delayMs?: number;
    nextRetryAt?: number;
    reason?: string;
    errorCode?: string;
}

export interface StatusMeta {
    source?: 'agent' | 'llm-caller' | 'tool-executor' | 'session';
    phase?: 'lifecycle' | 'thinking' | 'retry' | 'tool' | 'completion' | 'failure';
    retry?: StatusRetryInfo;
}

/**
 * 状态消息
 */
export interface StatusMessage extends BaseAgentMessage {
    type: AgentMessageType.STATUS;
    payload: {
        state: AgentStatus;
        message?: string;
        meta?: StatusMeta;
    };
    msgId?: string; // 你后端生成的唯一逻辑 ID
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
 * Token 使用量更新消息
 */
export interface UsageUpdateMessage extends BaseAgentMessage {
    type: AgentMessageType.USAGE_UPDATE;
    payload: {
        usage: Usage;
        /** 累计使用量（多轮对话） */
        cumulative?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
    };
    msgId?: string;
}

/**
 * 基础事件联合类型（不包含子 Agent 事件）
 */
export type BaseAgentEvent =
    | TextStartMessage
    | ThoughtMessage
    | TextMessage
    | ReasoningStartMessage
    | ReasoningDeltaMessage
    | ReasoningCompleteMessage
    | ToolCallCreatedMessage
    | ToolCallStreamMessage
    | ToolCallResultMessage
    | CodePatchMessage
    | UsageUpdateMessage
    | StatusMessage
    | ErrorMessage;

/**
 * 子 Agent 事件冒泡消息
 *
 * 将子 Agent 的事件转发到父会话，实现实时进度可见
 */
export interface SubagentEventMessage extends BaseAgentMessage {
    type: AgentMessageType.SUBAGENT_EVENT;
    payload: {
        /** 子任务 ID */
        task_id: string;
        /** 子 Agent 类型 */
        subagent_type: string;
        /** 子会话 ID */
        child_session_id: string;
        /** 原始事件（来自子 Agent，可能是另一个 SubagentEventMessage 以支持嵌套） */
        event: AgentMessage;
    };
    msgId?: string;
}

/**
 * 统一联合类型
 */
export type AgentMessage = BaseAgentEvent | SubagentEventMessage;
