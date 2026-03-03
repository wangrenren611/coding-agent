import { createHash, randomUUID } from 'crypto';
import type { ToolCall } from '../agent/core-types';
import { createDefaultPolicySourceRules } from './policy-sources';

export type PermissionEffect = 'allow' | 'deny' | 'ask';

export interface PermissionTicket {
    id: string;
    createdAt: number;
    toolName: string;
    reason: string;
    fingerprint: string;
}

export interface PermissionRequest {
    toolCall: ToolCall;
    sessionId?: string;
    messageId?: string;
    planMode?: boolean;
}

export interface PermissionDecision {
    effect: PermissionEffect;
    reason?: string;
    source?: string;
    ticket?: PermissionTicket;
}

export interface PermissionRule {
    effect: PermissionEffect;
    tool?: string | RegExp;
    reason?: string | ((request: PermissionRequest) => string | undefined);
    source?: string;
    when?: (request: PermissionRequest) => boolean;
}

export interface PermissionEngineOptions {
    /** 追加/覆盖规则 */
    rules?: PermissionRule[];
    /** 是否加载默认策略源（env + legacy bash） */
    useDefaultSources?: boolean;
    /** 是否启用 legacy Plan Mode 静态策略源（默认 false） */
    includeLegacyPlanModePolicy?: boolean;
}

const EFFECT_PRIORITY: Record<PermissionEffect, number> = {
    allow: 1,
    ask: 2,
    deny: 3,
};

function stableSortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => stableSortValue(item));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
        normalized[key] = stableSortValue(nested);
    }
    return normalized;
}

function normalizeArguments(argumentsText: string): string {
    const trimmed = argumentsText.trim();
    if (!trimmed) return '';
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        return JSON.stringify(stableSortValue(parsed));
    } catch {
        return trimmed;
    }
}

function getToolName(toolCall: ToolCall): string {
    return (toolCall.function?.name || '').trim();
}

export class PermissionEngine {
    private readonly rules: PermissionRule[];

    constructor(options?: PermissionEngineOptions) {
        const defaultRules =
            options?.useDefaultSources === false
                ? []
                : createDefaultPolicySourceRules({
                      includeLegacyPlanModePolicy: options?.includeLegacyPlanModePolicy === true,
                  });
        this.rules = [...defaultRules, ...(options?.rules ?? [])];
    }

    evaluate(request: PermissionRequest): PermissionDecision {
        const toolName = getToolName(request.toolCall);
        const matched = this.matchRules(request);
        if (!matched) {
            return { effect: 'allow', source: 'default' };
        }

        if (matched.effect !== 'ask') {
            return matched;
        }

        const reason = matched.reason || `Tool "${toolName}" requires explicit approval`;
        return {
            ...matched,
            reason,
            ticket: matched.ticket ?? this.createTicket(request, reason),
        };
    }

    private matchRules(request: PermissionRequest): PermissionDecision | undefined {
        let best: PermissionDecision | undefined;

        for (const rule of this.rules) {
            if (!this.ruleMatches(rule, request)) {
                continue;
            }
            const candidate: PermissionDecision = {
                effect: rule.effect,
                source: rule.source ?? 'rule',
                reason: this.resolveRuleReason(rule, request),
            };
            if (!best || EFFECT_PRIORITY[candidate.effect] > EFFECT_PRIORITY[best.effect]) {
                best = candidate;
            }
            if (best.effect === 'deny') {
                break;
            }
        }

        return best;
    }

    private ruleMatches(rule: PermissionRule, request: PermissionRequest): boolean {
        if (rule.when && !rule.when(request)) {
            return false;
        }

        if (!rule.tool) {
            return true;
        }

        const toolName = getToolName(request.toolCall);
        if (typeof rule.tool === 'string') {
            return toolName === rule.tool;
        }

        return rule.tool.test(toolName);
    }

    private resolveRuleReason(rule: PermissionRule, request: PermissionRequest): string | undefined {
        if (typeof rule.reason === 'function') {
            return rule.reason(request);
        }
        return rule.reason;
    }

    private createTicket(request: PermissionRequest, reason: string): PermissionTicket {
        const toolName = getToolName(request.toolCall);
        const args = normalizeArguments(request.toolCall.function?.arguments || '');
        const fingerprint = createHash('sha256')
            .update(`${toolName}:${args}`)
            .digest('hex')
            .slice(0, 16);

        return {
            id: randomUUID(),
            createdAt: Date.now(),
            toolName,
            reason,
            fingerprint,
        };
    }
}

export function createDefaultPermissionEngine(options?: PermissionEngineOptions): PermissionEngine {
    return new PermissionEngine(options);
}
