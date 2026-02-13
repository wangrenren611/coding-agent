/**
 * 流式处理器状态定义
 */

/**
 * 处理器状态枚举
 * 
 * 状态转换图：
 * IDLE -> REASONING -> TEXT -> COMPLETED
 * IDLE -> TEXT -> COMPLETED
 * IDLE -> TEXT -> TOOL_CALLS -> COMPLETED
 * IDLE -> REASONING -> TEXT -> TOOL_CALLS -> COMPLETED
 * 任意状态 -> ABORTED
 */
export enum ProcessorState {
    /** 初始状态，等待处理 */
    IDLE = 'idle',
    /** 正在处理推理内容 */
    REASONING = 'reasoning',
    /** 正在处理文本内容 */
    TEXT = 'text',
    /** 正在处理工具调用 */
    TOOL_CALLS = 'tool_calls',
    /** 处理完成 */
    COMPLETED = 'completed',
    /** 处理中止（缓冲区溢出等） */
    ABORTED = 'aborted',
}

/**
 * 状态转换映射
 * 定义每个状态可以转换到的下一个状态
 */
export const STATE_TRANSITIONS: Record<ProcessorState, ProcessorState[]> = {
    [ProcessorState.IDLE]: [
        ProcessorState.REASONING,
        ProcessorState.TEXT,
        ProcessorState.TOOL_CALLS,
        ProcessorState.COMPLETED,
        ProcessorState.ABORTED,
    ],
    [ProcessorState.REASONING]: [
        ProcessorState.TEXT,
        ProcessorState.TOOL_CALLS,
        ProcessorState.COMPLETED,
        ProcessorState.ABORTED,
    ],
    [ProcessorState.TEXT]: [
        ProcessorState.TOOL_CALLS,
        ProcessorState.COMPLETED,
        ProcessorState.ABORTED,
    ],
    [ProcessorState.TOOL_CALLS]: [
        ProcessorState.COMPLETED,
        ProcessorState.ABORTED,
    ],
    [ProcessorState.COMPLETED]: [ProcessorState.ABORTED],
    [ProcessorState.ABORTED]: [],
};

/**
 * 状态转换验证
 * @param from 当前状态
 * @param to 目标状态
 * @returns 是否允许转换
 */
export function canTransition(from: ProcessorState, to: ProcessorState): boolean {
    return STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 内容类型
 */
export enum ContentType {
    /** 推理内容 */
    REASONING = 'reasoning',
    /** 普通文本 */
    TEXT = 'text',
    /** 工具调用 */
    TOOL_CALLS = 'tool_calls',
}

/**
 * 状态变更事件
 */
export interface StateChangeEvent {
    /** 之前的状态 */
    previousState: ProcessorState;
    /** 新状态 */
    newState: ProcessorState;
    /** 触发的内容类型 */
    trigger?: ContentType;
    /** 时间戳 */
    timestamp: number;
}
