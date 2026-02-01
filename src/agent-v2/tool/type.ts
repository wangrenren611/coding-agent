
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




