/**
 * LRU (Least Recently Used) 缓存实现
 * 
 * 支持：
 * - 固定容量限制
 * - O(1) 获取和设置
 * - 访问时自动更新优先级
 */

export class LRUCache<K, V> {
    private readonly maxSize: number;
    private readonly cache: Map<K, V>;
    private readonly onEvict?: (key: K, value: V) => void;

    /**
     * 创建 LRU 缓存
     * @param maxSize 最大容量
     * @param onEvict 驱逐回调 - 当元素被驱逐时调用
     */
    constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
        if (maxSize <= 0) {
            throw new Error('LRU cache max size must be greater than 0');
        }
        this.maxSize = maxSize;
        this.cache = new Map();
        this.onEvict = onEvict;
    }

    /**
     * 获取值
     * 如果存在，会将元素移到末尾（最近使用）
     */
    get(key: K): V | undefined {
        if (!this.cache.has(key)) {
            return undefined;
        }

        // 移动到末尾（最新）
        const value = this.cache.get(key)!;
        this.cache.delete(key);
        this.cache.set(key, value);
        
        return value;
    }

    /**
     * 设置值
     * 如果已存在，则更新值并移到末尾
     * 如果容量已满，则驱逐最旧的元素
     */
    set(key: K, value: V): void {
        // 如果已存在，先删除
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        // 如果容量已满，驱逐最旧的元素
        else if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                const oldestValue = this.cache.get(oldestKey);
                if (oldestValue !== undefined) {
                    this.cache.delete(oldestKey);
                    this.onEvict?.(oldestKey, oldestValue);
                }
            }
        }
        // 添加新元素
        this.cache.set(key, value);
    }

    /**
     * 检查键是否存在
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * 删除指定键
     */
    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    /**
     * 清空缓存
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 获取当前大小
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * 获取最大容量
     */
    get maxSizeValue(): number {
        return this.maxSize;
    }

    /**
     * 获取所有键
     */
    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    /**
     * 获取所有值
     */
    values(): IterableIterator<V> {
        return this.cache.values();
    }

    /**
     * 获取所有条目
     */
    entries(): IterableIterator<[K, V]> {
        return this.cache.entries();
    }

    /**
     * 批量设置
     */
    setMany(entries: [K, V][]): void {
        for (const [key, value] of entries) {
            this.set(key, value);
        }
    }

    /**
     * 预热缓存 - 批量加载数据
     * 会在达到容量时自动驱逐旧数据
     */
    warm(entries: [K, V][]): void {
        for (const [key, value] of entries) {
            this.set(key, value);
        }
    }
}


/**
 * 带 TTL (Time To Live) 的 LRU 缓存
 */

export interface CacheEntry<V> {
    value: V;
    expiresAt: number;
}

export class TTLLRUCache<K, V> {
    private readonly maxSize: number;
    private readonly defaultTTL: number;
    private readonly cache: Map<K, CacheEntry<V>>;
    private readonly onEvict?: (key: K, value: V) => void;

    constructor(maxSize: number, defaultTTL: number, onEvict?: (key: K, value: V) => void) {
        if (maxSize <= 0) {
            throw new Error('TTL LRU cache max size must be greater than 0');
        }
        if (defaultTTL <= 0) {
            throw new Error('TTL must be greater than 0');
        }
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
        this.cache = new Map();
        this.onEvict = onEvict;
    }

    /**
     * 获取值（如果过期则返回 undefined 并删除）
     */
    get(key: K, now?: number): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }

        const currentTime = now ?? Date.now();
        if (entry.expiresAt <= currentTime) {
            this.cache.delete(key);
            return undefined;
        }

        // 移动到末尾
        this.cache.delete(key);
        this.cache.set(key, entry);
        
        return entry.value;
    }

    /**
     * 设置值（带 TTL）
     */
    set(key: K, value: V, ttl?: number): void {
        const expiresAt = (ttl ?? this.defaultTTL) + Date.now();

        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // 找到并删除最旧的未过期元素
            let oldestKey: K | undefined;
            let oldestExpiresAt = Infinity;

            for (const [k, entry] of this.cache.entries()) {
                if (entry.expiresAt < oldestExpiresAt) {
                    oldestExpiresAt = entry.expiresAt;
                    oldestKey = k;
                }
            }

            if (oldestKey !== undefined) {
                const oldValue = this.cache.get(oldestKey)!.value;
                this.cache.delete(oldestKey);
                this.onEvict?.(oldestKey, oldValue);
            }
        }

        this.cache.set(key, { value, expiresAt });
    }

    /**
     * 删除指定键
     */
    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    /**
     * 清空缓存
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 获取当前大小
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * 清理过期元素
     * @returns 删除的元素数量
     */
    cleanExpired(now?: number): number {
        const currentTime = now ?? Date.now();
        let removed = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiresAt <= currentTime) {
                this.cache.delete(key);
                removed++;
            }
        }

        return removed;
    }
}
