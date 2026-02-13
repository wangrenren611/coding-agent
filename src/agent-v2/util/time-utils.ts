/**
 * 时间工具函数
 */

export function now(): number {
    return Date.now();
}

export function nowISO(): string {
    return new Date().toISOString();
}

export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    if (ms < 3600000) {
        return `${(ms / 60000).toFixed(1)}m`;
    }
    return `${(ms / 3600000).toFixed(1)}h`;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function timeout<T>(ms: number, promise: Promise<T>): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        )
    ]);
}
