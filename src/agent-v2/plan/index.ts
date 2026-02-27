/**
 * Plan Module - Index
 *
 * Plan 计划功能模块入口
 *
 * 设计理念：
 * - Plan 就是一个 Markdown 文档
 * - Agent 自己阅读文档并执行
 * - 不需要复杂的状态管理
 *
 * 使用示例：
 * ```typescript
 * import { createPlanStorage } from './plan';
 *
 * const storage = createPlanStorage(process.cwd());
 *
 * // 创建 Plan
 * const meta = await storage.create({
 *   title: '实现用户认证功能',
 *   content: '# 计划内容...',
 *   sessionId: 'session-xxx',
 * });
 *
 * // 读取 Plan
 * const plan = await storage.getBySession('session-xxx');
 * console.log(plan?.content); // Markdown 内容
 * ```
 */

// Types
export type { PlanMeta, PlanData, CreatePlanParams } from './types';
export {
    PLANS_DIR_NAME,
    PLAN_ID_PREFIX,
    planCreateSchema,
    generatePlanId,
    nowIso,
    isValidSessionId,
    sanitizeSessionId,
} from './types';

// Storage
export type { PlanStorage } from './storage';
export { FilePlanStorage, PlanStorageError, createPlanStorage, getPlanFilePath } from './storage';

// Tools
export { PlanCreateTool } from './tools';

// Plan Mode
export {
    isToolAllowedInPlanMode,
    filterToolsForPlanMode,
    getBlockedTools,
    READ_ONLY_TOOLS,
    BLOCKED_TOOL_PATTERNS,
} from './plan-mode';
