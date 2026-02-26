/**
 * ============================================================================
 * Plan Module - Index (简化版)
 * ============================================================================
 *
 * Plan 计划功能模块入口
 *
 * 设计理念：
 * - Plan 就是一个 Markdown 文档
 * - Agent 自己阅读文档并执行
 * - 不需要复杂的状态管理
 *
 * 使用方式：
 * ```typescript
 * // Plan 模式下，Agent 使用 plan_create 创建文档
 * // 执行模式下，Agent 读取文档并执行
 *
 * import { createPlanStorage, getPlanFilePath } from './plan';
 *
 * const storage = createPlanStorage(undefined, undefined, process.cwd());
 *
 * // 创建 Plan
 * const meta = await storage.create({
 *   title: '实现用户认证功能',
 *   content: '# 计划内容...',
 *   sessionId: 'xxx',
 * });
 *
 * // 读取 Plan
 * const plan = await storage.getBySession('xxx');
 * console.log(plan.content); // Markdown 内容
 * ```
 */

// Types
export * from './types';

// Storage
export type { PlanStorage } from './storage';
export {
    FilePlanStorage,
    MemoryManagerPlanStorage,
    createPlanStorage,
    getPlanFilePath,
} from './storage';

// Tools
export { planTools, PlanCreateTool } from './tools';

// Plan Mode
export {
    isToolAllowedInPlanMode,
    filterToolsForPlanMode,
    getBlockedTools,
    READ_ONLY_TOOLS,
    BLOCKED_TOOL_PATTERNS,
} from './plan-mode';
