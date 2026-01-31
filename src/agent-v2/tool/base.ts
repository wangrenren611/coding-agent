import { z } from 'zod';

/**
 * 统一的工具执行结果接口
 */
export interface ToolResult<T = unknown> {
    /** 是否成功 */
    success: boolean;
    /** 结果数据 */
    metadata?: T;
    /** 错误信息（失败时必填） */
    error?: string;
    output?: string;
}



/**
 * 工具基类
 *
 * @typeParam T - Zod schema 类型
 */
export abstract class BaseTool<T extends z.ZodType> {
    /** 工具名称 */
    abstract name: string;

    /** 工具描述 */
    abstract description: string;

    /** 参数 schema */
    abstract schema: T;

    /** 会话 ID */
    sessionId?: string;

    /**
     * 执行工具
     * @param args - 解析后的参数
     * @returns 统一的工具结果
     */
    abstract execute(args?: z.infer<T>): Promise<ToolResult> | ToolResult;


    /**
     * 创建成功结果
     */
  protected success<T>({ metadata, output }: { metadata: T, output: ToolResult['output'] }): ToolResult<T> {
        return {
            success: true,
            metadata,
            output,
        };
 }

    /**
     * 创建失败结果
     */
    protected fail({ error }: { error?: ToolResult['error'] }): ToolResult {
        return {
            success: false,
            error,
        };
    }
}

export { z };
