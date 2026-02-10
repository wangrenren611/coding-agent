/**
 * MemoryManager 模块导出
 */

export * from './types';
export { FileMemoryManager } from './file-memory';

import type { IMemoryManager, MemoryManagerOptions } from './types';
import { FileMemoryManager } from './file-memory';

/**
 * MemoryManager 工厂函数
 * 当前仅支持 file 实现。
 */
export function createMemoryManager(options: MemoryManagerOptions): IMemoryManager {
  if (options.type !== 'file') {
    throw new Error(`Unsupported memory manager type: ${options.type}`);
  }

  return new FileMemoryManager(options);
}
