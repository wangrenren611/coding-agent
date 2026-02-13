/**
 * 工具函数导出
 */

export function safeParse(data: string): any | null {

    if(!data){
        return null;
    }

    try {
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

export function safeJSONStringify(data: any): string {
    if(!data){
        return '';
    }

    try {
        return JSON.stringify(data);
    } catch (error) {
        return '';
    }
}

// LRU Cache
export { LRUCache, TTLLRUCache } from './lru-cache';

// Semaphore
export { Semaphore, TimeoutSemaphore, SemaphoreGuard } from './semaphore';

// Time Utils
export * from './time-utils';

// Validation - DEPRECATED: These functions are not used
// export * from './validation';
