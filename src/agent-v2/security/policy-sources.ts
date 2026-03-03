import { BLOCKED_TOOL_PATTERNS, READ_ONLY_TOOLS } from '../plan/plan-mode';
import type { PermissionRule, PermissionRequest } from './permission-engine';
import { evaluateBashPolicy } from './bash-policy';
import type { BashPolicyEffect } from './bash-policy';

function parseToolList(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function getToolName(request: PermissionRequest): string {
    return (request.toolCall.function?.name || '').trim();
}

function parseToolCallArgs(request: PermissionRequest): Record<string, unknown> | null {
    const raw = request.toolCall.function?.arguments || '';
    if (!raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function getBashPolicyMode(): 'guarded' | 'permissive' {
    return (process.env.BASH_TOOL_POLICY || 'guarded').toLowerCase() === 'permissive' ? 'permissive' : 'guarded';
}

function evaluateLegacyBashPolicy(request: PermissionRequest): { effect: BashPolicyEffect; reason?: string } {
    if (getToolName(request) !== 'bash') {
        return { effect: 'allow' };
    }

    const args = parseToolCallArgs(request);
    if (!args) {
        return { effect: 'deny', reason: 'Invalid bash arguments payload' };
    }

    const command = typeof args.command === 'string' ? args.command.trim() : '';
    if (!command) {
        return { effect: 'allow' };
    }

    const decision = evaluateBashPolicy(command, {
        mode: getBashPolicyMode(),
        allowlistMissEffect: 'ask',
        allowlistMissReason: (cmd) => `Command "${cmd}" is not in guarded allowlist and requires explicit approval`,
    });

    return {
        effect: decision.effect,
        reason: decision.reason,
    };
}

export interface DefaultPolicySourceOptions {
    /**
     * 是否启用 legacy Plan Mode 静态策略源。
     * 默认 false，Plan Mode 限制由工具注册表和工具自身策略承载。
     */
    includeLegacyPlanModePolicy?: boolean;
}

/**
 * 环境变量策略源：
 * - AGENT_PERMISSION_DENY_TOOLS
 * - AGENT_PERMISSION_ASK_TOOLS
 * - AGENT_PERMISSION_ALLOW_TOOLS
 */
export function createEnvPermissionRules(): PermissionRule[] {
    const denyTools = parseToolList(process.env.AGENT_PERMISSION_DENY_TOOLS);
    const askTools = parseToolList(process.env.AGENT_PERMISSION_ASK_TOOLS);
    const allowTools = parseToolList(process.env.AGENT_PERMISSION_ALLOW_TOOLS);

    const rules: PermissionRule[] = [];
    for (const tool of denyTools) {
        rules.push({
            effect: 'deny',
            tool,
            source: 'env',
            reason: `Tool "${tool}" denied by AGENT_PERMISSION_DENY_TOOLS`,
        });
    }
    for (const tool of askTools) {
        rules.push({
            effect: 'ask',
            tool,
            source: 'env',
            reason: `Tool "${tool}" requires approval by AGENT_PERMISSION_ASK_TOOLS`,
        });
    }
    for (const tool of allowTools) {
        rules.push({
            effect: 'allow',
            tool,
            source: 'env',
            reason: `Tool "${tool}" explicitly allowed by AGENT_PERMISSION_ALLOW_TOOLS`,
        });
    }
    return rules;
}

/**
 * Legacy Bash 策略源：
 * 把 bash 工具内部的静态策略保留为统一权限层前置规则。
 */
export function createLegacyBashPermissionRules(): PermissionRule[] {
    return [
        {
            effect: 'ask',
            source: 'legacy_bash',
            tool: 'bash',
            when: (request) => evaluateLegacyBashPolicy(request).effect === 'ask',
            reason: (request) => evaluateLegacyBashPolicy(request).reason || 'Bash command requires explicit approval',
        },
        {
            effect: 'deny',
            source: 'legacy_bash',
            tool: 'bash',
            when: (request) => evaluateLegacyBashPolicy(request).effect === 'deny',
            reason: (request) =>
                evaluateLegacyBashPolicy(request).reason || 'Bash command is blocked by legacy policy source',
        },
    ];
}

/**
 * Legacy Plan Mode 策略源（默认不启用）：
 * 仅用于兼容极端场景，正常应由 plan 工具注册表限制负责。
 */
export function createLegacyPlanModePermissionRules(): PermissionRule[] {
    return [
        {
            effect: 'deny',
            source: 'legacy_plan_mode',
            when: (request) => {
                if (!request.planMode) return false;
                const toolName = getToolName(request);
                for (const pattern of BLOCKED_TOOL_PATTERNS) {
                    if (pattern.test(toolName)) return true;
                }
                return !READ_ONLY_TOOLS.has(toolName);
            },
            reason: 'Tool is blocked by legacy Plan Mode policy source',
        },
    ];
}

/**
 * 默认策略源集合。
 */
export function createDefaultPolicySourceRules(options?: DefaultPolicySourceOptions): PermissionRule[] {
    const rules: PermissionRule[] = [...createEnvPermissionRules(), ...createLegacyBashPermissionRules()];
    if (options?.includeLegacyPlanModePolicy) {
        rules.push(...createLegacyPlanModePermissionRules());
    }
    return rules;
}
