/**
 * ============================================================================
 * Plan Module - Plan Mode
 * ============================================================================
 *
 * Plan Mode - 只读权限模式
 *
 * 功能：
 * 1. 限制工具调用为只读操作
 * 2. 过滤危险的写操作
 * 3. 允许使用 Task 工具进行探索和分析
 */

// ==================== 常量 ====================

/**
 * Plan 模式下允许的工具
 */
export const READ_ONLY_TOOLS: string[] = [
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
];

/**
 * Plan 模式下禁止的工具模式
 */
export const BLOCKED_TOOL_PATTERNS: RegExp[] = [
    // 文件写入
    /^write_file$/,
    /^precise_replace$/,
    /^batch_replace$/,
    // 命令执行
    /^bash$/,
];

// ==================== Helper Functions ====================

/**
 * 检查工具是否在 Plan Mode 下被允许
 */
export function isToolAllowedInPlanMode(toolName: string): boolean {
    // 检查黑名单模式
    for (const pattern of BLOCKED_TOOL_PATTERNS) {
        if (pattern.test(toolName)) {
            return false;
        }
    }

    // 检查白名单
    return READ_ONLY_TOOLS.includes(toolName);
}

/**
 * 过滤工具列表，返回 Plan Mode 下可用的工具名称
 */
export function filterToolsForPlanMode(toolNames: string[]): string[] {
    return toolNames.filter((name) => isToolAllowedInPlanMode(name));
}

/**
 * 获取被阻止的工具列表
 */
export function getBlockedTools(toolNames: string[]): string[] {
    return toolNames.filter((name) => !isToolAllowedInPlanMode(name));
}
