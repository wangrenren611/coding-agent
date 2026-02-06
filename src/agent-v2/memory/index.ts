/**
 * MemoryManager 模块导出
 * 提供统一的存储接口和默认实现
 */

export * from './types';
export * from './file-memory';

import { IMemoryManager, MemoryManagerOptions } from './types';
import { FileMemoryManager } from './file-memory';

/**
 * MemoryManager 工厂函数
 * 根据配置创建对应的存储实现
 */
export function createMemoryManager(options: MemoryManagerOptions): IMemoryManager {
  switch (options.type) {
    case 'file':
    default:
      return new FileMemoryManager(options);
  }
}
