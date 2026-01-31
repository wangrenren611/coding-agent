/**
 * Agent 核心类型定义
 *
 * 定义 Agent 相关的所有核心类型、枚举和接口
 */

import type { LLMProvider } from '../providers';
import type { ModelId } from '../providers/types';

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
    /** 规划中 */
    PLANNING = 'planning',
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
 * Agent 执行结果
 */
export interface AgentResult {
    /** 是否成功 */
    success: boolean;
    /** 最终响应内容 */
    response?: string;
    /** 执行的工具调用记录 */
    toolCalls: ToolCallRecord[];
    /** 执行的任务记录 */
    tasks: Task[];
    /** 使用的 token 数量 */
    usage?: TokenUsage;
    /** 错误信息（如果失败） */
    error?: Error;
    /** 执行耗时（毫秒） */
    duration: number;
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

// =============================================================================
// 工具相关类型
// =============================================================================

/**
 * JSON Schema 类型定义（简化版）
 */
export interface JSONSchema7 {
    type?: string;
    properties?: Record<string, JSONSchema7>;
    required?: string[];
    items?: JSONSchema7;
    enum?: (string | number | boolean)[];
    description?: string;
    [key: string]: unknown;
}

/**
 * 工具分类
 */
export enum ToolCategory {
    /** 文件操作 */
    FILE = 'file',
    /** 代码操作 */
    CODE = 'code',
    /** 搜索 */
    SEARCH = 'search',
    /** 执行 */
    EXECUTE = 'execute',
    /** 系统 */
    SYSTEM = 'system',
    /** 分析 */
    ANALYSIS = 'analysis',
    /** Git 操作 */
    GIT = 'git',
}

/**
 * 权限级别
 */
export enum PermissionLevel {
    /** 安全，可直接执行 */
    SAFE = 'safe',
    /** 中等，需要确认 */
    MODERATE = 'moderate',
    /** 危险，需要明确授权 */
    DANGEROUS = 'dangerous',
}

/**
 * 工具定义
 */
export interface ToolDefinition {
    /** 工具名称 */
    name: string;
    /** 工具描述 */
    description: string;
    /** 参数 schema */
    parameters: JSONSchema7;
    /** 执行函数 */
    execute: (params: unknown, context: ExecutionContext) => Promise<ToolResult>;
    /** 是否需要确认 */
    requireConfirmation?: boolean;
    /** 工具分类 */
    category?: ToolCategory;
    /** 权限级别 */
    permission?: PermissionLevel;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
    /** 是否成功 */
    success: boolean;
    /** 结果数据 */
    data?: unknown;
    /** 错误信息 */
    error?: string;
    /** 是否需要重试 */
    retryable?: boolean;
}

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
    /** 调用ID */
    id: string;
    /** 工具名称 */
    toolName: string;
    /** 调用参数 */
    parameters: unknown;
    /** 调用结果 */
    result: ToolResult;
    /** 开始时间 */
    startTime: number;
    /** 结束时间 */
    endTime: number;
    /** 耗时（毫秒） */
    duration: number;
    /** 是否成功 */
    success: boolean;
}

// =============================================================================
// 任务相关类型
// =============================================================================

/**
 * 任务状态
 */
export enum TaskStatus {
    /** 待处理 */
    PENDING = 'pending',
    /** 进行中 */
    IN_PROGRESS = 'in_progress',
    /** 阻塞中 */
    BLOCKED = 'blocked',
    /** 已完成 */
    COMPLETED = 'completed',
    /** 失败 */
    FAILED = 'failed',
    /** 已取消 */
    CANCELLED = 'cancelled',
}

/**
 * 任务
 */
export interface Task {
    /** 任务ID */
    id: string;
    /** 任务描述 */
    description: string;
    /** 任务状态 */
    status: TaskStatus;
    /** 父任务ID */
    parentTaskId?: string;
    /** 子任务ID列表 */
    subtaskIds: string[];
    /** 依赖的任务ID列表 */
    dependencies: string[];
    /** 创建时间 */
    createdAt: Date;
    /** 开始时间 */
    startedAt?: Date;
    /** 完成时间 */
    completedAt?: Date;
    /** 执行结果 */
    result?: unknown;
    /** 错误信息 */
    error?: Error;
    /** 相关文件 */
    files?: string[];
}

/**
 * 任务计划
 */
export interface TaskPlan {
    /** 主任务 */
    mainTask: Task;
    /** 所有子任务 */
    subtasks: Task[];
    /** 执行顺序（任务ID列表） */
    executionOrder: string[];
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

// =============================================================================
// 上下文相关类型
// =============================================================================

/**
 * 思考记录
 */
export interface Thought {
    /** 思考内容 */
    content: string;
    /** 时间戳 */
    timestamp: number;
    /** 相关工具调用 */
    relatedToolCall?: string;
}

/**
 * 文件变更记录
 */
export interface FileChangeRecord {
    /** 文件路径 */
    path: string;
    /** 变更类型 */
    changeType: 'created' | 'modified' | 'deleted';
    /** 变更时间 */
    timestamp: number;
    /** 备份路径（如果有） */
    backupPath?: string;
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
    /** 上下文ID */
    id: string;
    /** 工作目录 */
    workingDirectory: string;
    /** 环境变量 */
    envVars: Record<string, string>;
    /** 用户输入历史 */
    userInputHistory: string[];
    /** 工具调用历史 */
    toolCallHistory: ToolCallRecord[];
    /** 文件变更历史 */
    fileChangeHistory: FileChangeRecord[];
    /** 当前任务 */
    currentTask?: Task;
    /** 思考记录 */
    thoughts: Thought[];
    /** 开始时间 */
    startTime: number;
}

// =============================================================================
// ReAct 循环相关类型
// =============================================================================

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

/**
 * ReAct 循环上下文
 */
export interface ReActContext {
    /** 当前状态 */
    state: ReActState;
    /** 当前循环次数 */
    loopCount: number;
    /** 最后的思考 */
    lastThought?: string;
    /** 最后的行动 */
    lastAction?: ToolCallRecord;
    /** 最后的观察 */
    lastObservation?: ToolResult;
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

// =============================================================================
// 确认请求
// =============================================================================

/**
 * 确认请求
 */
export interface ConfirmationRequest {
    /** 请求ID */
    id: string;
    /** 请求描述 */
    description: string;
    /** 工具名称 */
    toolName?: string;
    /** 参数 */
    parameters?: unknown;
    /** 权限级别 */
    permission: PermissionLevel;
}

/**
 * 确认响应
 */
export interface ConfirmationResponse {
    /** 请求ID */
    id: string;
    /** 是否批准 */
    approved: boolean;
    /** 用户消息 */
    message?: string;
}

// =============================================================================
// Agent 构造选项
// =============================================================================

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
}
