/**
 * 信号量实现 - 用于控制并发
 * 
 * 支持：
 * - 限制并发数量
 * - 等待队列
 * - 异步获取许可
 */

export class Semaphore {
    private readonly maxConcurrent: number;
    private currentCount: number = 0;
    private waitQueue: Array<() => void> = [];

    /**
     * 创建信号量
     * @param maxConcurrent 最大并发数
     */
    constructor(maxConcurrent: number) {
        if (maxConcurrent <= 0) {
            throw new Error('Semaphore max concurrent must be greater than 0');
        }
        this.maxConcurrent = maxConcurrent;
    }

    /**
     * 获取许可（如果无法立即获取则等待）
     */
    async acquire(): Promise<void> {
        if (this.currentCount < this.maxConcurrent) {
            this.currentCount++;
            return;
        }

        // 需要等待
        return new Promise<void>((resolve) => {
            this.waitQueue.push(resolve);
        });
    }

    /**
     * 释放许可
     */
    release(): void {
        if (this.waitQueue.length > 0) {
            // 唤醒等待队列中的下一个
            const next = this.waitQueue.shift();
            if (next) {
                next();
                return;
            }
        }
        this.currentCount--;
    }

    /**
     * 尝试获取许可（不等待）
     */
    tryAcquire(): boolean {
        if (this.currentCount < this.maxConcurrent) {
            this.currentCount++;
            return true;
        }
        return false;
    }

    /**
     * 获取当前正在执行的的数量
     */
    getCurrentCount(): number {
        return this.currentCount;
    }

    /**
     * 获取等待队列长度
     */
    getQueueLength(): number {
        return this.waitQueue.length;
    }

    /**
     * 检查是否可以立即获取许可
     */
    isAvailable(): boolean {
        return this.currentCount < this.maxConcurrent;
    }
}


/**
 * 带超时的信号量
 */

export class TimeoutSemaphore extends Semaphore {
    private readonly timeoutMs: number;

    constructor(maxConcurrent: number, timeoutMs: number) {
        super(maxConcurrent);
        if (timeoutMs <= 0) {
            throw new Error('Timeout must be greater than 0');
        }
        this.timeoutMs = timeoutMs;
    }

    /**
     * 获取许可（带超时）
     * 如果超时则抛出错误
     */
    async acquire(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                // 从等待队列中移除
                const index = this.getQueueLength();
                reject(new Error(`Semaphore acquisition timeout after ${this.timeoutMs}ms`));
            }, this.timeoutMs);

            super.acquire().then(() => {
                clearTimeout(timeoutId);
                resolve();
            }).catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    }
}


/**
 * 异步资源包装器 - 自动获取和释放许可
 */

export class SemaphoreGuard {
    constructor(private readonly semaphore: Semaphore) {
        // 私有构造函数，只能通过静态方法创建
    }

    static async acquire(semaphore: Semaphore): Promise<SemaphoreGuard> {
        await semaphore.acquire();
        return new SemaphoreGuard(semaphore);
    }

    release(): void {
        this.semaphore.release();
    }

    /**
     * 使用 try-finally 确保释放
     */
    static async use<T>(
        semaphore: Semaphore, 
        fn: () => Promise<T>
    ): Promise<T> {
        const guard = await SemaphoreGuard.acquire(semaphore);
        try {
            return await fn();
        } finally {
            guard.release();
        }
    }
}
