/**
 * Agent 核心类型定义
 *
 * 定义 Agent 相关的所有核心类型、枚举和接口
 */

import type { LLMProvider } from '../../providers';
import type { ModelId } from '../../providers/types';
import { ConfirmationRequest, ConfirmationResponse } from '../permission/types';
import { ToolCallRecord, ToolDefinition } from '../tool/type';

// =============================================================================
// Agent 配置和状态
// =============================================================================

/**
 * Agent 配置接口
 */
export interface AgentConfig {
    /** 模型标识符 */
    modelId: ModelId;
    /** 最大循环次数 (防止无限循环) */
    maxLoops: number;
    /** 每个任务最多调用工具次数 */
    maxToolsPerTask: number;
    /** 超时时间（毫秒） */
    timeout: number;
    /** 是否启用备份 */
    enableBackup: boolean;
    /** 最大备份数量 */
    maxBackups: number;
    /** 工作目录 */
    workingDirectory: string;
    /** 是否启用交互模式 */
    interactiveMode: boolean;
    /** 自定义系统提示词 */
    systemPrompt?: string;
}

/**
 * Agent 状态枚举
 */
export enum AgentStatus {
    /** 空闲 */
    IDLE = 'idle',
    /** 运行中 */
    RUNNING = 'running',
    /** 等待用户输入 */
    WAITING = 'waiting',
    /** 已暂停 */
    PAUSED = 'paused',
    /** 已完成 */
    COMPLETED = 'completed',
    /** 失败 */
    FAILED = 'failed',
    /** 已中止 */
    ABORTED = 'aborted',
}

// =============================================================================
// 执行选项和结果
// =============================================================================

/**
 * 执行选项
 */
export interface ExecutionOptions {
    /** 是否启用流式输出 */
    stream?: boolean;
    /** 中止信号 */
    abortSignal?: AbortSignal;
    /** 初始上下文数据 */
    initialContext?: Record<string, unknown>;
}


/**
 * Agent 事件类型
 */
export enum AgentEventType {
    /** 状态变更 */
    STATUS_CHANGED = 'status_changed',
    /** 思考事件 */
    THINKING = 'thinking',
    /** 工具调用开始 */
    TOOL_CALL_START = 'tool_call_start',
    /** 工具调用完成 */
    TOOL_CALL_COMPLETE = 'tool_call_complete',
    /** 工具调用失败 */
    TOOL_CALL_ERROR = 'tool_call_error',
    /** 任务创建 */
    TASK_CREATED = 'task_created',
    /** 任务更新 */
    TASK_UPDATED = 'task_updated',
    /** 进度更新 */
    PROGRESS = 'progress',
    /** 错误 */
    ERROR = 'error',
    /** 完成 */
    COMPLETED = 'completed',
}

/**
 * Agent 事件
 */
export interface AgentEvent {
    /** 事件类型 */
    type: AgentEventType;
    /** 时间戳 */
    timestamp: number;
    /** 事件数据 */
    data?: Record<string, unknown>;
    /** 错误（如果是错误事件） */
    error?: Error;
}

// =============================================================================
// Token 使用统计
// =============================================================================

/**
 * Token 使用统计
 */
export interface TokenUsage {
    /** 输入 token 数 */
    promptTokens: number;
    /** 输出 token 数 */
    completionTokens: number;
    /** 总 token 数 */
    totalTokens: number;
}


/**
 * 任务统计
 */
export interface TaskStats {
    /** 总任务数 */
    total: number;
    /** 已完成数 */
    completed: number;
    /** 进行中数 */
    inProgress: number;
    /** 待处理数 */
    pending: number;
    /** 失败数 */
    failed: number;
}




/**
 * ReAct 循环状态
 */
export enum ReActState {
    /** 思考 */
    THINK = 'think',
    /** 行动 */
    ACT = 'act',
    /** 观察 */
    OBSERVE = 'observe',
    /** 反思 */
    REFLECT = 'reflect',
    /** 完成 */
    DONE = 'done',
}



// =============================================================================
// 备份相关类型
// =============================================================================

/**
 * 备份信息
 */
export interface BackupInfo {
    /** 备份ID */
    id: string;
    /** 原文件路径 */
    originalPath: string;
    /** 备份文件路径 */
    backupPath: string;
    /** 备份时间 */
    timestamp: number;
    /** 文件大小 */
    size: number;
}


/**
 * 执行上下文
 */
export interface ExecutionContext {
    /** 任务ID */
    taskId: string;
    /** 工具调用记录 */
    toolCallRecords: ToolCallRecord[];
    /** 确认记录 */
    confirmationRecords: ConfirmationRequest[];
}

/**
 * Agent 构造选项
 */
export interface AgentOptions {
    /** LLM Provider */
    provider: LLMProvider;
    /** Agent 配置 */
    config: Partial<AgentConfig>;
    /** 确认回调 */
    onConfirmation?: (request: ConfirmationRequest) => Promise<ConfirmationResponse>;
    /** 事件回调 */
    onEvent?: (event: AgentEvent) => void;
    /** 系统定义系统提示词 */
    systemPrompt: string;
    tools?: ToolDefinition[];
}

