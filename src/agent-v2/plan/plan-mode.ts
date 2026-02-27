/**
 * Plan Module - Plan Mode
 *
 * Plan Mode (只读权限模式) 的工具过滤逻辑
 */

// ==================== 常量 ====================

/**
 * Plan 模式下允许的工具（白名单）
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
    // 文件读取
    'read_file',
    'glob',
    'grep',
    'lsp',
    // 网络
    'web_search',
    'web_fetch',
    // Plan 工具
    'plan_create',
    // Task 工具 - 用于探索和分析
    'task',
    'task_create',
    'task_get',
    'task_list',
    'task_update',
    'task_stop',
    // Skill
    'skill',
]);

/**
 * Plan 模式下禁止的工具模式（黑名单）
 */
export const BLOCKED_TOOL_PATTERNS: readonly RegExp[] = [
    // 文件写入
    /^write_file$/,
    /^precise_replace$/,
    /^batch_replace$/,
    // 命令执行
    /^bash$/,
] as const;

// ==================== 辅助函数 ====================

/**
 * 检查工具是否在 Plan Mode 下被允许
 *
 * 检查顺序：
 * 1. 先检查黑名单（优先级更高）
 * 2. 再检查白名单
 */
export function isToolAllowedInPlanMode(toolName: string): boolean {
    // 检查黑名单
    for (const pattern of BLOCKED_TOOL_PATTERNS) {
        if (pattern.test(toolName)) {
            return false;
        }
    }

    // 检查白名单
    return READ_ONLY_TOOLS.has(toolName);
}

/**
 * 过滤工具列表，返回 Plan Mode 下可用的工具名称
 */
export function filterToolsForPlanMode(toolNames: readonly string[]): string[] {
    return toolNames.filter((name) => isToolAllowedInPlanMode(name));
}

/**
 * 获取被阻止的工具列表
 */
export function getBlockedTools(toolNames: readonly string[]): string[] {
    return toolNames.filter((name) => !isToolAllowedInPlanMode(name));
}
