/**
 * Plan Mode 测试 (简化版)
 */

import { describe, it, expect } from 'vitest';
import {
    isToolAllowedInPlanMode,
    filterToolsForPlanMode,
    getBlockedTools,
    READ_ONLY_TOOLS,
    BLOCKED_TOOL_PATTERNS,
} from '../plan-mode';

describe('Plan Mode', () => {
    describe('READ_ONLY_TOOLS', () => {
        it('应该包含文件读取工具', () => {
            expect(READ_ONLY_TOOLS).toContain('read_file');
            expect(READ_ONLY_TOOLS).toContain('glob');
            expect(READ_ONLY_TOOLS).toContain('grep');
        });

        it('应该包含网络工具', () => {
            expect(READ_ONLY_TOOLS).toContain('web_search');
            expect(READ_ONLY_TOOLS).toContain('web_fetch');
        });

        it('应该包含 Plan 工具', () => {
            expect(READ_ONLY_TOOLS).toContain('plan_create');
        });

        it('应该包含 Task 工具', () => {
            expect(READ_ONLY_TOOLS).toContain('task');
            expect(READ_ONLY_TOOLS).toContain('task_create');
            expect(READ_ONLY_TOOLS).toContain('task_get');
            expect(READ_ONLY_TOOLS).toContain('task_list');
            expect(READ_ONLY_TOOLS).toContain('task_update');
            expect(READ_ONLY_TOOLS).toContain('task_stop');
        });

        it('应该包含 Skill 工具', () => {
            expect(READ_ONLY_TOOLS).toContain('skill');
        });
    });

    describe('BLOCKED_TOOL_PATTERNS', () => {
        it('应该阻止写文件工具', () => {
            expect(BLOCKED_TOOL_PATTERNS.some(p => p.test('write_file'))).toBe(true);
        });

        it('应该阻止 Bash 工具', () => {
            expect(BLOCKED_TOOL_PATTERNS.some(p => p.test('bash'))).toBe(true);
        });

        it('不应该阻止 Task 工具', () => {
            expect(BLOCKED_TOOL_PATTERNS.some(p => p.test('task_create'))).toBe(false);
            expect(BLOCKED_TOOL_PATTERNS.some(p => p.test('task_update'))).toBe(false);
        });
    });

    describe('isToolAllowedInPlanMode()', () => {
        it('应该允许读取工具', () => {
            expect(isToolAllowedInPlanMode('read_file')).toBe(true);
            expect(isToolAllowedInPlanMode('glob')).toBe(true);
            expect(isToolAllowedInPlanMode('grep')).toBe(true);
        });

        it('应该允许网络工具', () => {
            expect(isToolAllowedInPlanMode('web_search')).toBe(true);
            expect(isToolAllowedInPlanMode('web_fetch')).toBe(true);
        });

        it('应该允许 Plan 工具', () => {
            expect(isToolAllowedInPlanMode('plan_create')).toBe(true);
        });

        it('应该允许 Task 工具', () => {
            expect(isToolAllowedInPlanMode('task')).toBe(true);
            expect(isToolAllowedInPlanMode('task_create')).toBe(true);
            expect(isToolAllowedInPlanMode('task_get')).toBe(true);
            expect(isToolAllowedInPlanMode('task_list')).toBe(true);
            expect(isToolAllowedInPlanMode('task_update')).toBe(true);
            expect(isToolAllowedInPlanMode('task_stop')).toBe(true);
        });

        it('应该允许 Skill 工具', () => {
            expect(isToolAllowedInPlanMode('skill')).toBe(true);
        });

        it('不应该允许写文件工具', () => {
            expect(isToolAllowedInPlanMode('write_file')).toBe(false);
            expect(isToolAllowedInPlanMode('precise_replace')).toBe(false);
            expect(isToolAllowedInPlanMode('batch_replace')).toBe(false);
        });

        it('不应该允许 Bash 工具', () => {
            expect(isToolAllowedInPlanMode('bash')).toBe(false);
        });

        it('不应该允许未知工具', () => {
            expect(isToolAllowedInPlanMode('unknown_tool')).toBe(false);
        });
    });

    describe('filterToolsForPlanMode()', () => {
        it('应该只返回允许的工具', () => {
            const tools = ['read_file', 'write_file', 'glob', 'bash', 'task'];
            const filtered = filterToolsForPlanMode(tools);

            expect(filtered).toContain('read_file');
            expect(filtered).toContain('glob');
            expect(filtered).toContain('task');
            expect(filtered).not.toContain('write_file');
            expect(filtered).not.toContain('bash');
        });

        it('应该返回空数组如果所有工具都被阻止', () => {
            const tools = ['write_file', 'bash'];
            const filtered = filterToolsForPlanMode(tools);

            expect(filtered).toEqual([]);
        });
    });

    describe('getBlockedTools()', () => {
        it('应该返回被阻止的工具列表', () => {
            const tools = ['read_file', 'write_file', 'glob', 'bash'];
            const blocked = getBlockedTools(tools);

            expect(blocked).toContain('write_file');
            expect(blocked).toContain('bash');
            expect(blocked).not.toContain('read_file');
            expect(blocked).not.toContain('glob');
        });

        it('应该返回空数组如果没有工具被阻止', () => {
            const tools = ['read_file', 'glob', 'task_create'];
            const blocked = getBlockedTools(tools);

            expect(blocked).toEqual([]);
        });
    });
});
