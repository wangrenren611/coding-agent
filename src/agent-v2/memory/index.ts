/**
 * MemoryManager 模块导出
 */

export * from './types';
export { FileMemoryManager } from './file-memory';
export { MemoryManager } from './memory-manager';
export { MEMORY_ADAPTER_DESCRIPTORS } from './adapters/capabilities';

import type { IMemoryManager, MemoryManagerOptions } from './types';
import { isSupportedMemoryManagerType } from './adapters/factory';
import { FileMemoryManager } from './file-memory';
import { MemoryManager } from './memory-manager';

/**
 * MemoryManager 工厂函数
 * 支持 file/mysql/redis/mongodb/hybrid。
 */
export function createMemoryManager(options: MemoryManagerOptions): IMemoryManager {
    if (!isSupportedMemoryManagerType(options.type)) {
        throw new Error(`Unsupported memory manager type: ${options.type}`);
    }

    if (options.type === 'file') {
        return new FileMemoryManager(options);
    }

    return new MemoryManager(options);
}
