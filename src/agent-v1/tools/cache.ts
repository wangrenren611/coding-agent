/**
 * Tool Cache - 工具结果缓存
 *
 * 缓存工具执行结果以提高性能
 */

/**
 * 缓存配置
 */
export interface ToolCacheConfig {
    /** 是否启用缓存 */
    enabled?: boolean;
    /** 最大缓存条目数 */
    maxSize?: number;
    /** 缓存过期时间（毫秒） */
    ttl?: number;
}

/**
 * 缓存条目
 */
interface CacheEntry {
    result: import('../types').ToolResult;
    timestamp: number;
    hits: number;
}

/**
 * ToolCache - 工具结果缓存管理
 */
export class ToolCache {
    private cache: Map<string, CacheEntry> = new Map();
    private config: Required<ToolCacheConfig>;

    constructor(config: ToolCacheConfig = {}) {
        this.config = {
            enabled: config.enabled ?? true,
            maxSize: config.maxSize ?? 100,
            ttl: config.ttl ?? 300000, // 5 minutes
        };
    }

    /**
     * 生成缓存键
     */
    private generateKey(toolName: string, params: unknown): string {
        const str = typeof params === 'string'
            ? params
            : JSON.stringify(params);
        return `${toolName}:${str}`;
    }

    /**
     * 获取缓存结果
     */
    get(toolName: string, params: unknown): import('../types').ToolResult | null {
        if (!this.config.enabled) {
            return null;
        }

        const key = this.generateKey(toolName, params);
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        // 检查是否过期
        if (Date.now() - entry.timestamp > this.config.ttl) {
            this.cache.delete(key);
            return null;
        }

        entry.hits++;
        return entry.result;
    }

    /**
     * 设置缓存
     */
    set(toolName: string, params: unknown, result: import('../types').ToolResult): void {
        if (!this.config.enabled) {
            return;
        }

        // 不缓存失败结果
        if (!result.success) {
            return;
        }

        // 检查缓存大小
        if (this.cache.size >= this.config.maxSize) {
            this.evictOldest();
        }

        const key = this.generateKey(toolName, params);
        this.cache.set(key, {
            result,
            timestamp: Date.now(),
            hits: 0,
        });
    }

    /**
     * 使指定工具的缓存失效
     */
    invalidate(toolName: string): void {
        const prefix = `${toolName}:`;
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * 清空缓存
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 淘汰最旧的缓存
     */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    /**
     * 获取缓存统计
     */
    getStats() {
        let totalHits = 0;
        for (const entry of this.cache.values()) {
            totalHits += entry.hits;
        }

        return {
            size: this.cache.size,
            maxSize: this.config.maxSize,
            enabled: this.config.enabled,
            ttl: this.config.ttl,
            totalHits,
        };
    }

    /**
     * 检查是否启用
     */
    isEnabled(): boolean {
        return this.config.enabled;
    }
}
