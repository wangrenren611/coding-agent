/**
 * 事件总线类型定义
 */

/**
 * 事件类型枚举
 */
export enum EventType {
    /** 任务开始 */
    TASK_START = 'task:start',
    /** 任务进行中（每次 LLM 调用） */
    TASK_PROGRESS = 'task:progress',
    /** 任务成功完成 */
    TASK_SUCCESS = 'task:success',
    /** 任务失败 */
    TASK_FAILED = 'task:failed',
    /** 任务重试中 */
    TASK_RETRY = 'task:retry',
    /** 工具执行开始 */
    TOOL_START = 'tool:start',
    /** 工具执行成功 */
    TOOL_SUCCESS = 'tool:success',
    /** 工具执行失败 */
    TOOL_FAILED = 'tool:failed',
    /** 流式输出数据块 */
    STREAM_CHUNK = 'stream:chunk',
}

/**
 * 事件数据基类
 */
export interface BaseEventData {
    /** 事件时间戳 */
    timestamp: number;
}

/**
 * 任务开始事件数据
 */
export interface TaskStartData extends BaseEventData {
    /** 用户查询内容 */
    query: string;
}

/**
 * 任务进行中事件数据
 */
export interface TaskProgressData extends BaseEventData {
    /** 当前循环次数 */
    loopCount: number;
    /** 当前重试次数 */
    retryCount: number;
}

/**
 * 任务成功事件数据
 */
export interface TaskSuccessData extends BaseEventData {
    /** 总循环次数 */
    totalLoops: number;
    /** 总重试次数 */
    totalRetries: number;
    /** 执行时长（毫秒） */
    duration: number;
}

/**
 * 任务失败事件数据
 */
export interface TaskFailedData extends BaseEventData {
    /** 错误信息 */
    error: string;
    /** 总循环次数 */
    totalLoops: number;
    /** 总重试次数 */
    totalRetries: number;
}

/**
 * 任务重试事件数据
 */
export interface TaskRetryData extends BaseEventData {
    /** 当前重试次数 */
    retryCount: number;
    /** 最大重试次数 */
    maxRetries: number;
    /** 重试原因 */
    reason: string;
}

/**
 * 工具执行开始事件数据
 */
export interface ToolStartData extends BaseEventData {
    /** 工具名称 */
    toolName: string;
    /** 工具参数 */
    arguments: string;
}

/**
 * 工具执行成功事件数据
 */
export interface ToolSuccessData extends BaseEventData {
    /** 工具名称 */
    toolName: string;
    /** 执行时长（毫秒） */
    duration: number;
    /** 结果长度 */
    resultLength: number;
}

/**
 * 工具执行失败事件数据
 */
export interface ToolFailedData extends BaseEventData {
    /** 工具名称 */
    toolName: string;
    /** 错误信息 */
    error: string;
}

/**
 * 流式输出数据块事件
 */
export interface StreamChunkData extends BaseEventData {
    /** 内容片段 */
    content: string;
}

/**
 * 事件监听器函数类型
 */
export type EventListener<T extends BaseEventData = BaseEventData> = (data: T) => void | Promise<void>;

/**
 * 事件映射：事件类型 -> 对应的数据类型
 */
export interface EventMap {
    [EventType.TASK_START]: TaskStartData;
    [EventType.TASK_PROGRESS]: TaskProgressData;
    [EventType.TASK_SUCCESS]: TaskSuccessData;
    [EventType.TASK_FAILED]: TaskFailedData;
    [EventType.TASK_RETRY]: TaskRetryData;
    [EventType.TOOL_START]: ToolStartData;
    [EventType.TOOL_SUCCESS]: ToolSuccessData;
    [EventType.TOOL_FAILED]: ToolFailedData;
    [EventType.STREAM_CHUNK]: StreamChunkData;
}

/**
 * 事件对象
 */
export interface Event<T extends BaseEventData = BaseEventData> {
    /** 事件类型 */
    type: EventType;
    /** 事件数据 */
    data: T;
}
