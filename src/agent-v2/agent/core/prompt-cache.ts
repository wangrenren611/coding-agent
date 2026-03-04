import { createHash } from 'crypto';

import type { Tool, Usage } from '../../../providers';
import type { Message } from '../../session/types';

export interface PromptCacheOptions {
    /** 前缀变化日志，默认开启 */
    logPrefixChanges?: boolean;
    /** 动态系统提醒注入（通过 user 消息携带 <system-reminder>，避免修改 system prompt） */
    systemReminderProvider?: () => string | undefined;
    /** 是否在长会话中禁止同会话模型切换（建议通过子智能体切换模型） */
    enforceModelAffinity?: boolean;
}

export interface PromptCachePrepareResult {
    tools: Tool[];
    prefixHash: string;
    prefixChanged: boolean;
    prefixChurnRate: number;
}

export interface PromptCacheMetricsSnapshot {
    requestCount: number;
    prefixChangeCount: number;
    prefixChurnRate: number;
    promptTokensTotal: number;
    promptCacheHitTokensTotal: number;
    promptCacheMissTokensTotal: number;
    promptCacheHitRate: number | null;
}

type CanonicalJson = null | string | number | boolean | CanonicalJson[] | { [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
        return value.map((item) => canonicalize(item));
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    const valueType = typeof value;
    if (valueType !== 'object') {
        return String(value);
    }

    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const result: Record<string, CanonicalJson> = {};
    for (const key of sortedKeys) {
        result[key] = canonicalize(obj[key]);
    }
    return result;
}

function extractSystemMessages(messages: Message[]): Message[] {
    return messages.filter((message) => message.role === 'system');
}

/**
 * v2: 工具定义稳定化（排序 + Canonical JSON）
 * - 解决 Map 插入顺序波动导致的前缀抖动
 * - 解决参数 schema 键顺序波动导致的前缀抖动
 */
export function normalizeToolsForPromptCacheV2(tools: Tool[]): Tool[] {
    const normalized = tools
        .map((tool) => canonicalize(tool))
        .sort((a, b) => {
            const aName = typeof (a as Tool).function?.name === 'string' ? (a as Tool).function.name : '';
            const bName = typeof (b as Tool).function?.name === 'string' ? (b as Tool).function.name : '';
            if (aName !== bName) return aName.localeCompare(bName);
            return JSON.stringify(a).localeCompare(JSON.stringify(b));
        }) as Tool[];

    return normalized;
}

function buildPrefixHash(model: string | undefined, messages: Message[], tools: Tool[]): string {
    const payload = canonicalize({
        model: model || '',
        systemMessages: extractSystemMessages(messages),
        tools,
    });
    const serialized = JSON.stringify(payload);
    return createHash('sha256').update(serialized).digest('hex');
}

/**
 * v2 缓存监控器
 * - 计算 prefix hash，追踪前缀变化率（churn）
 * - 汇总 provider usage 的 prompt cache 命中/未命中 token
 */
export class PromptCacheMonitorV2 {
    private previousPrefixHash: string | null = null;
    private requestCount = 0;
    private prefixChangeCount = 0;
    private promptTokensTotal = 0;
    private promptCacheHitTokensTotal = 0;
    private promptCacheMissTokensTotal = 0;

    prepare(model: string | undefined, messages: Message[], tools: Tool[]): PromptCachePrepareResult {
        const normalizedTools = normalizeToolsForPromptCacheV2(tools);
        const prefixHash = buildPrefixHash(model, messages, normalizedTools);

        this.requestCount += 1;
        const prefixChanged = this.previousPrefixHash !== null && this.previousPrefixHash !== prefixHash;
        if (prefixChanged) {
            this.prefixChangeCount += 1;
        }
        this.previousPrefixHash = prefixHash;

        return {
            tools: normalizedTools,
            prefixHash,
            prefixChanged,
            prefixChurnRate: this.getPrefixChurnRate(),
        };
    }

    recordUsage(usage?: Usage): PromptCacheMetricsSnapshot {
        if (usage) {
            this.promptTokensTotal += usage.prompt_tokens || 0;
            this.promptCacheHitTokensTotal += usage.prompt_cache_hit_tokens || 0;
            this.promptCacheMissTokensTotal += usage.prompt_cache_miss_tokens || 0;
        }
        return this.getSnapshot();
    }

    getSnapshot(): PromptCacheMetricsSnapshot {
        const cacheKnownTotal = this.promptCacheHitTokensTotal + this.promptCacheMissTokensTotal;
        return {
            requestCount: this.requestCount,
            prefixChangeCount: this.prefixChangeCount,
            prefixChurnRate: this.getPrefixChurnRate(),
            promptTokensTotal: this.promptTokensTotal,
            promptCacheHitTokensTotal: this.promptCacheHitTokensTotal,
            promptCacheMissTokensTotal: this.promptCacheMissTokensTotal,
            promptCacheHitRate: cacheKnownTotal > 0 ? this.promptCacheHitTokensTotal / cacheKnownTotal : null,
        };
    }

    private getPrefixChurnRate(): number {
        if (this.requestCount <= 1) return 0;
        return this.prefixChangeCount / (this.requestCount - 1);
    }
}
