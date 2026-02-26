/**
 * 截断系统模块入口
 *
 * 提供工具输出截断功能，防止过长的工具输出占用过多上下文
 *
 * @module truncation
 *
 * @example
 * ```typescript
 * import { TruncationService, createTruncationMiddleware } from './truncation';
 *
 * // 创建截断服务
 * const truncationService = new TruncationService({
 *   global: { maxLines: 2000, maxBytes: 50 * 1024 },
 *   tools: {
 *     bash: { direction: 'tail', maxLines: 500 },
 *   },
 *   onEvent: (event) => console.log(`[Truncation] ${event.type}: ${event.toolName}`),
 * });
 *
 * // 创建中间件
 * const middleware = createTruncationMiddleware({ service: truncationService });
 *
 * // 集成到工具注册表
 * toolRegistry.setTruncationMiddleware(middleware);
 * ```
 */

// 类型导出
export type {
    TruncationDirection,
    TruncationResult,
    TruncationConfig,
    TruncationOptions,
    TruncationContext,
    TruncationStrategy,
    TruncationEventType,
    TruncationEvent,
    TruncationEventCallback,
    ITruncationStorage,
} from './types';

// 常量导出
export { DEFAULT_TRUNCATION_CONFIG, TOOL_TRUNCATION_CONFIGS } from './constants';

// 服务导出
export { TruncationService, type TruncationServiceConfig } from './service';

// 存储导出
export { TruncationStorage } from './storage';

// 中间件导出
export { createTruncationMiddleware, type TruncationMiddlewareConfig, type TruncationMiddleware } from './middleware';

// 策略导出
export { BaseTruncationStrategy, DefaultTruncationStrategy } from './strategies';
