import { ExecutionContext } from "../agent/types";
import { PermissionLevel } from "../permission/types";
import { ToolResult } from "./base";


/** 工具 Schema */
export interface ToolSchema {
    type: 'function';
    function: {
        name: string;
        description: string;
        strict?: boolean;
        parameters: Record<string, unknown>;
    };
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
 * 工具定义
 */
export interface ToolDefinition {
    /** 工具名称 */
    name: string;
    /** 工具描述 */
    description: string;
    /** 参数 schema */
    parameters: ToolSchema;
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
