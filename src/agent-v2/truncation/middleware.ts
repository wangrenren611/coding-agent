/**
 * 截断中间件
 *
 * @module truncation/middleware
 */

import type { ToolResult } from '../tool/base';
import type { TruncationService } from './service';
import type { TruncationContext, TruncationOptions } from './types';

/**
 * 截断中间件配置
 */
export interface TruncationMiddlewareConfig {
    /** 截断服务实例 */
    service: TruncationService;
    /** 跳过截断的工具列表（这些工具的输出不会被截断） */
    skipTools?: string[];
    /** 自定义判断函数 */
    shouldTruncate?: (toolName: string, result: ToolResult) => boolean | TruncationOptions;
}

/**
 * 截断中间件函数类型
 */
export type TruncationMiddleware = (
    toolName: string,
    result: ToolResult,
    context: TruncationContext
) => Promise<ToolResult>;

/**
 * 创建截断中间件
 *
 * @param config 中间件配置
 * @returns 中间件函数
 *
 * @example
 * ```typescript
 * const service = new TruncationService({ ... });
 * const middleware = createTruncationMiddleware({ service });
 *
 * // 在 ToolRegistry 中使用
 * registry.setTruncationMiddleware(middleware);
 * ```
 */
export function createTruncationMiddleware(config: TruncationMiddlewareConfig): TruncationMiddleware {
    const { service, skipTools = [], shouldTruncate } = config;

    return async (
        toolName: string,
        result: ToolResult,
        context: TruncationContext
    ): Promise<ToolResult> => {
        // 没有输出，直接返回
        if (!result.output) {
            return result;
        }

        // 工具标记已自行处理截断（metadata 中有 truncated 字段且已定义）
        // 工具标记已自行处理截断（metadata 中有 truncated 字段且已定义）
        const existingMetadata = result.metadata as Record<string, unknown> | undefined;
        if (existingMetadata && existingMetadata.truncated !== undefined) {
            return result;
        }

        // 在跳过列表中
        if (skipTools.includes(toolName)) {
            return result;
        }

        // 自定义判断
        if (shouldTruncate) {
            const decision = shouldTruncate(toolName, result);
            if (decision === false) {
                return result;
            }
            if (typeof decision === 'object') {
                context = { ...context, options: decision };
            }
        }

        // 执行截断
        const truncated = await service.output(result.output, context);

        // 返回更新后的结果
        const finalMetadata = result.metadata as Record<string, unknown> | undefined;
        return {
            ...result,
            output: truncated.content,
            metadata: {
                ...finalMetadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && {
                    truncationPath: truncated.outputPath,
                    truncationRemovedLines: truncated.removedLines,
                    truncationRemovedBytes: truncated.removedBytes,
                }),
            },
        };
    };
}
