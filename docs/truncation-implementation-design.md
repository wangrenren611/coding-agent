# Coding Agent 截断系统实现设计

> 文档版本: 1.0  
> 基于参考: `/docs/opencode-truncation-mechanism.md`  
> 创建日期: 2025-02-26  
> 分支: `feature/permission-truncation`

---

## 目录

1. [设计原则](#1-设计原则)
2. [模块结构](#2-模块结构)
3. [核心类型设计](#3-核心类型设计)
4. [核心服务设计](#4-核心服务设计)
5. [截断策略设计](#5-截断策略设计)
6. [存储管理设计](#6-存储管理设计)
7. [中间件集成设计](#7-中间件集成设计)
8. [与现有系统集成方案](#8-与现有系统集成方案)
9. [配置设计](#9-配置设计)
10. [工具自定义截断](#10-工具自定义截断)
11. [实现优先级](#11-实现优先级)
12. [扩展点设计](#12-扩展点设计)
13. [测试计划](#13-测试计划)
14. [实现检查清单](#14-实现检查清单)

---

## 1. 设计原则

| 原则 | 说明 | 实现方式 |
|------|------|----------|
| **最小侵入** | 不修改现有工具代码 | 通过中间件/装饰器模式集成 |
| **可配置** | 灵活的配置层级 | 全局配置 + 工具级别覆盖 + 单次调用定制 |
| **可扩展** | 支持自定义扩展 | 策略模式 + 存储抽象 + 事件钩子 |
| **类型安全** | 完整的类型定义 | TypeScript 严格模式 + Zod 验证 |
| **向后兼容** | 不影响现有功能 | 默认配置保持现有行为，渐进式引入 |
| **测试友好** | 易于单元测试 | 依赖注入 + 接口抽象 |

---

## 2. 模块结构

```
src/agent-v2/truncation/
├── index.ts                    # 导出入口
├── types.ts                    # 类型定义
├── constants.ts                # 常量配置
├── service.ts                  # 截断核心服务 (TruncationService)
├── storage.ts                  # 文件存储管理 (TruncationStorage)
├── middleware.ts               # 工具执行中间件
├── strategies/
│   ├── index.ts                # 策略导出
│   ├── base.ts                 # 策略基类 (BaseTruncationStrategy)
│   ├── line-based.ts           # 行数截断策略
│   ├── byte-based.ts           # 字节截断策略
│   └── smart.ts                # 智能截断策略（可选）
└── __tests__/
    ├── service.test.ts
    ├── storage.test.ts
    ├── strategies.test.ts
    └── middleware.test.ts
```

### 2.1 模块职责

| 模块 | 职责 | 依赖 |
|------|------|------|
| `types.ts` | 类型定义，无运行时代码 | - |
| `constants.ts` | 默认配置常量 | - |
| `service.ts` | 截断核心逻辑，协调各组件 | types, storage, strategies |
| `storage.ts` | 文件读写、清理、路径管理 | types, constants |
| `strategies/` | 各种截断算法实现 | types |
| `middleware.ts` | 与工具系统集成 | service, types |

---

## 3. 核心类型设计

### 3.1 文件: `types.ts`

```typescript
/**
 * 截断方向
 */
export type TruncationDirection = 'head' | 'tail';

/**
 * 截断结果（判别联合）
 * 
 * 使用判别联合的好处：
 * - TypeScript 自动类型收窄
 * - 明确区分截断和未截断状态
 */
export type TruncationResult =
  | { 
      /** 截断后的内容 */
      content: string; 
      /** 是否截断 */
      truncated: false;
    }
  | { 
      content: string; 
      truncated: true; 
      /** 完整内容的存储路径 */
      outputPath: string;
      /** 移除的行数 */
      removedLines?: number;
      /** 移除的字节数 */
      removedBytes?: number;
    };

/**
 * 截断配置
 */
export interface TruncationConfig {
  /** 最大行数（默认 2000） */
  maxLines: number;
  /** 最大字节数（默认 50KB = 51200） */
  maxBytes: number;
  /** 截断方向（默认 head） */
  direction: TruncationDirection;
  /** 是否启用（默认 true） */
  enabled: boolean;
  /** 文件保留天数（默认 7） */
  retentionDays: number;
  /** 自定义存储目录（可选） */
  storageDir?: string;
}

/**
 * 截断选项（单次调用覆盖配置）
 */
export interface TruncationOptions {
  /** 覆盖最大行数 */
  maxLines?: number;
  /** 覆盖最大字节数 */
  maxBytes?: number;
  /** 覆盖截断方向 */
  direction?: TruncationDirection;
  /** 跳过截断 */
  skip?: boolean;
}

/**
 * 截断上下文（传递给截断服务）
 */
export interface TruncationContext {
  /** 工具名称 */
  toolName: string;
  /** 会话 ID */
  sessionId?: string;
  /** 消息 ID */
  messageId?: string;
  /** 工具特定选项 */
  options?: TruncationOptions;
}

/**
 * 截断策略接口
 */
export interface TruncationStrategy {
  /** 策略名称 */
  readonly name: string;
  
  /**
   * 检查是否需要截断
   * @param content 原始内容
   * @param config 截断配置
   * @returns 是否需要截断
   */
  needsTruncation(content: string, config: TruncationConfig): boolean;
  
  /**
   * 执行截断
   * @param content 原始内容
   * @param config 截断配置
   * @returns 截断后的内容和统计信息
   */
  truncate(
    content: string, 
    config: TruncationConfig
  ): { 
    content: string; 
    removedLines?: number; 
    removedBytes?: number;
  };
}

/**
 * 截断事件类型
 */
export type TruncationEventType = 'truncated' | 'skipped' | 'error';

/**
 * 截断事件
 */
export interface TruncationEvent {
  /** 事件类型 */
  type: TruncationEventType;
  /** 工具名称 */
  toolName: string;
  /** 原始大小（字节） */
  originalSize: number;
  /** 截断后大小（字节） */
  truncatedSize: number;
  /** 存储路径（截断时有值） */
  outputPath?: string;
  /** 错误信息（错误时有值） */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 截断事件回调
 */
export type TruncationEventCallback = (event: TruncationEvent) => void;

/**
 * 存储接口（便于扩展不同存储后端）
 */
export interface ITruncationStorage {
  /**
   * 保存内容到存储
   * @param content 内容
   * @param context 上下文
   * @returns 存储路径
   */
  save(content: string, context: TruncationContext): Promise<string>;
  
  /**
   * 读取存储的内容
   * @param path 存储路径
   * @returns 内容
   */
  read(path: string): Promise<string>;
  
  /**
   * 清理过期文件
   * @param retentionDays 保留天数
   * @returns 清理的文件数
   */
  cleanup(retentionDays: number): Promise<number>;
  
  /**
   * 获取存储目录
   */
  getStorageDir(): string;
}
```

### 3.2 类型使用示例

```typescript
// 判别联合的类型收窄
const result = await truncationService.output(content, context);

if (result.truncated) {
  // TypeScript 知道这里有 outputPath
  console.log(`完整内容保存在: ${result.outputPath}`);
  console.log(`移除了 ${result.removedLines} 行`);
} else {
  // TypeScript 知道这里没有 outputPath
  console.log('内容未截断');
}
```

---

## 4. 核心服务设计

### 4.1 文件: `service.ts`

```typescript
import type {
  TruncationConfig,
  TruncationOptions,
  TruncationContext,
  TruncationResult,
  TruncationStrategy,
  TruncationEventCallback,
} from './types';
import { DEFAULT_TRUNCATION_CONFIG } from './constants';
import { TruncationStorage } from './storage';
import { DefaultTruncationStrategy } from './strategies';

/**
 * 截断服务配置
 */
export interface TruncationServiceConfig {
  /** 全局配置（部分覆盖） */
  global?: Partial<TruncationConfig>;
  /** 工具级别配置覆盖 */
  tools?: Record<string, Partial<TruncationConfig>>;
  /** 事件回调 */
  onEvent?: TruncationEventCallback;
  /** 自定义存储实例 */
  storage?: ITruncationStorage;
  /** 自定义策略实例 */
  strategy?: TruncationStrategy;
}

/**
 * 截断核心服务
 * 
 * 职责：
 * - 管理配置（全局 + 工具级别）
 * - 协调截断策略
 * - 管理存储
 * - 发送事件
 */
export class TruncationService {
  private config: TruncationConfig;
  private toolConfigs: Map<string, Partial<TruncationConfig>>;
  private storage: ITruncationStorage;
  private strategy: TruncationStrategy;
  private onEvent?: TruncationEventCallback;

  constructor(config: TruncationServiceConfig = {}) {
    // 合并默认配置
    this.config = { ...DEFAULT_TRUNCATION_CONFIG, ...config.global };
    
    // 工具配置
    this.toolConfigs = new Map(
      Object.entries(config.tools || {})
    );
    
    // 存储实例
    this.storage = config.storage || new TruncationStorage(this.config.storageDir);
    
    // 策略实例
    this.strategy = config.strategy || new DefaultTruncationStrategy();
    
    // 事件回调
    this.onEvent = config.onEvent;
  }

  /**
   * 截断输出（核心方法）
   * 
   * @param content 原始内容
   * @param context 截断上下文
   * @returns 截断结果
   */
  async output(
    content: string, 
    context: TruncationContext
  ): Promise<TruncationResult> {
    const effectiveConfig = this.getEffectiveConfig(context);

    // 检查是否禁用
    if (!effectiveConfig.enabled) {
      this.emitEvent({
        type: 'skipped',
        toolName: context.toolName,
        originalSize: Buffer.byteLength(content, 'utf-8'),
        truncatedSize: Buffer.byteLength(content, 'utf-8'),
        timestamp: Date.now(),
      });
      return { content, truncated: false };
    }

    // 检查是否需要截断
    if (!this.strategy.needsTruncation(content, effectiveConfig)) {
      this.emitEvent({
        type: 'skipped',
        toolName: context.toolName,
        originalSize: Buffer.byteLength(content, 'utf-8'),
        truncatedSize: Buffer.byteLength(content, 'utf-8'),
        timestamp: Date.now(),
      });
      return { content, truncated: false };
    }

    try {
      // 执行截断
      const truncated = this.strategy.truncate(content, effectiveConfig);
      const originalSize = Buffer.byteLength(content, 'utf-8');
      const truncatedSize = Buffer.byteLength(truncated.content, 'utf-8');

      // 保存完整内容
      const outputPath = await this.storage.save(content, context);

      // 生成提示信息
      const hint = this.generateHint(outputPath, truncated.removedLines, truncated.removedBytes);
      const finalContent = this.formatOutput(
        truncated.content, 
        hint, 
        effectiveConfig.direction,
        truncated.removedLines,
        truncated.removedBytes
      );

      this.emitEvent({
        type: 'truncated',
        toolName: context.toolName,
        originalSize,
        truncatedSize: Buffer.byteLength(finalContent, 'utf-8'),
        outputPath,
        timestamp: Date.now(),
      });

      return {
        content: finalContent,
        truncated: true,
        outputPath,
        removedLines: truncated.removedLines,
        removedBytes: truncated.removedBytes,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.emitEvent({
        type: 'error',
        toolName: context.toolName,
        originalSize: Buffer.byteLength(content, 'utf-8'),
        truncatedSize: Buffer.byteLength(content, 'utf-8'),
        error: errorMessage,
        timestamp: Date.now(),
      });

      // 错误时返回原内容
      return { content, truncated: false };
    }
  }

  /**
   * 清理过期文件
   */
  async cleanup(): Promise<number> {
    return this.storage.cleanup(this.config.retentionDays);
  }

  /**
   * 更新全局配置
   */
  updateConfig(config: Partial<TruncationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 设置工具特定配置
   */
  setToolConfig(toolName: string, config: Partial<TruncationConfig>): void {
    this.toolConfigs.set(toolName, config);
  }

  /**
   * 获取有效配置（全局 + 工具覆盖 + 单次选项）
   */
  private getEffectiveConfig(context: TruncationContext): TruncationConfig {
    const toolConfig = this.toolConfigs.get(context.toolName) || {};
    const options = context.options || {};

    return {
      ...this.config,
      ...toolConfig,
      ...options,
      // 确保布尔值正确处理
      enabled: options.skip !== undefined ? !options.skip : (toolConfig.enabled ?? this.config.enabled),
    };
  }

  /**
   * 生成提示信息
   */
  private generateHint(
    outputPath: string, 
    removedLines?: number, 
    removedBytes?: number
  ): string {
    const unit = removedBytes ? 'bytes' : 'lines';
    const removed = removedBytes || removedLines || 0;
    
    // TODO: 后续可以根据权限系统判断是否有 Task 工具权限
    // 目前使用默认提示
    return `The tool call succeeded but the output was truncated. ` +
           `Full output saved to: ${outputPath}\n` +
           `Use Grep to search the full content or Read with offset/limit to view specific sections.`;
  }

  /**
   * 格式化输出
   */
  private formatOutput(
    content: string,
    hint: string,
    direction: TruncationDirection,
    removedLines?: number,
    removedBytes?: number
  ): string {
    const unit = removedBytes ? 'bytes' : 'lines';
    const removed = removedBytes || removedLines || 0;

    if (direction === 'head') {
      return `${content}\n\n...${removed} ${unit} truncated...\n\n${hint}`;
    } else {
      return `...${removed} ${unit} truncated...\n\n${hint}\n\n${content}`;
    }
  }

  /**
   * 发送事件
   */
  private emitEvent(event: TruncationEvent): void {
    this.onEvent?.(event);
  }
}
```

---

## 5. 截断策略设计

### 5.1 文件: `strategies/base.ts`

```typescript
import type { TruncationStrategy, TruncationConfig } from '../types';

/**
 * 截断策略基类
 * 
 * 提供通用的辅助方法
 */
export abstract class BaseTruncationStrategy implements TruncationStrategy {
  abstract readonly name: string;
  
  abstract needsTruncation(content: string, config: TruncationConfig): boolean;
  abstract truncate(
    content: string, 
    config: TruncationConfig
  ): { content: string; removedLines?: number; removedBytes?: number };

  /**
   * 计算内容的行数
   */
  protected countLines(content: string): number {
    return content.split('\n').length;
  }

  /**
   * 计算内容的字节数
   */
  protected countBytes(content: string): number {
    return Buffer.byteLength(content, 'utf-8');
  }

  /**
   * 按行截断（头部）
   */
  protected truncateHead(content: string, maxLines: number): string[] {
    const lines = content.split('\n');
    return lines.slice(0, maxLines);
  }

  /**
   * 按行截断（尾部）
   */
  protected truncateTail(content: string, maxLines: number): string[] {
    const lines = content.split('\n');
    return lines.slice(-maxLines);
  }
}
```

### 5.2 文件: `strategies/default.ts` (或 `smart.ts`)

```typescript
import { BaseTruncationStrategy } from './base';
import type { TruncationConfig } from '../types';

/**
 * 默认截断策略
 * 
 * 同时检查行数和字节数限制，任一超限则截断
 */
export class DefaultTruncationStrategy extends BaseTruncationStrategy {
  readonly name = 'default';

  needsTruncation(content: string, config: TruncationConfig): boolean {
    const lineCount = this.countLines(content);
    const byteCount = this.countBytes(content);

    return lineCount > config.maxLines || byteCount > config.maxBytes;
  }

  truncate(
    content: string, 
    config: TruncationConfig
  ): { content: string; removedLines?: number; removedBytes?: number } {
    const lines = content.split('\n');
    const totalLines = lines.length;
    const totalBytes = this.countBytes(content);

    // 判断主要限制因素
    const hitBytesLimit = totalBytes > config.maxBytes;

    // 收集保留的行
    const kept: string[] = [];
    let bytes = 0;
    let hitBytes = false;

    if (config.direction === 'head') {
      // 从头部开始
      for (let i = 0; i < lines.length && kept.length < config.maxLines; i++) {
        const lineBytes = this.countBytes(lines[i]) + (kept.length > 0 ? 1 : 0);
        if (bytes + lineBytes > config.maxBytes) {
          hitBytes = true;
          break;
        }
        kept.push(lines[i]);
        bytes += lineBytes;
      }
    } else {
      // 从尾部开始
      for (let i = lines.length - 1; i >= 0 && kept.length < config.maxLines; i--) {
        const lineBytes = this.countBytes(lines[i]) + (kept.length > 0 ? 1 : 0);
        if (bytes + lineBytes > config.maxBytes) {
          hitBytes = true;
          break;
        }
        kept.unshift(lines[i]);
        bytes += lineBytes;
      }
    }

    const finalHitBytes = hitBytes || hitBytesLimit;
    const removedLines = totalLines - kept.length;
    const removedBytes = totalBytes - bytes;

    return {
      content: kept.join('\n'),
      removedLines: finalHitBytes ? undefined : removedLines,
      removedBytes: finalHitBytes ? removedBytes : undefined,
    };
  }
}
```

### 5.3 文件: `strategies/index.ts`

```typescript
export { BaseTruncationStrategy } from './base';
export { DefaultTruncationStrategy } from './default';
// 未来可扩展：
// export { LineBasedStrategy } from './line-based';
// export { ByteBasedStrategy } from './byte-based';
```

---

## 6. 存储管理设计

### 6.1 文件: `storage.ts`

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { ITruncationStorage, TruncationContext } from './types';

/**
 * 默认存储目录
 */
const DEFAULT_STORAGE_DIR = path.join(process.cwd(), 'data', 'truncation');

/**
 * 截断内容文件存储
 * 
 * 职责：
 * - 保存截断的完整内容
 * - 管理文件路径
 * - 清理过期文件
 */
export class TruncationStorage implements ITruncationStorage {
  private storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || DEFAULT_STORAGE_DIR;
  }

  /**
   * 确保存储目录存在
   */
  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch {
      // 目录已存在，忽略
    }
  }

  /**
   * 生成文件名
   * 格式: {toolName}_{timestamp}_{random}.txt
   */
  private generateFilename(context: TruncationContext): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const toolName = context.toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${toolName}_${timestamp}_${random}.txt`;
  }

  /**
   * 保存内容到文件
   */
  async save(content: string, context: TruncationContext): Promise<string> {
    await this.ensureDir();
    
    const filename = this.generateFilename(context);
    const filePath = path.join(this.storageDir, filename);
    
    await fs.writeFile(filePath, content, 'utf-8');
    
    return filePath;
  }

  /**
   * 读取文件内容
   */
  async read(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  /**
   * 清理过期文件
   * 
   * @param retentionDays 保留天数
   * @returns 清理的文件数
   */
  async cleanup(retentionDays: number): Promise<number> {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    
    let cleanedCount = 0;
    
    try {
      const files = await fs.readdir(this.storageDir);
      
      for (const file of files) {
        const filePath = path.join(this.storageDir, file);
        
        try {
          const stat = await fs.stat(filePath);
          
          if (stat.isFile() && stat.mtime.getTime() < cutoffTime) {
            await fs.unlink(filePath);
            cleanedCount++;
          }
        } catch {
          // 忽略单个文件错误
        }
      }
    } catch {
      // 目录不存在或无法访问，忽略
    }
    
    return cleanedCount;
  }

  /**
   * 获取存储目录
   */
  getStorageDir(): string {
    return this.storageDir;
  }
}
```

---

## 7. 中间件集成设计

### 7.1 文件: `middleware.ts`

```typescript
import type { ToolResult } from '../tool/base';
import type { TruncationService } from './service';
import type { TruncationContext, TruncationOptions } from './types';

/**
 * 截断中间件配置
 */
export interface TruncationMiddlewareConfig {
  /** 截断服务实例 */
  service: TruncationService;
  /** 跳过截断的工具列表（这些工具的输出不会被截断） */
  skipTools?: string[];
  /** 自定义判断函数 */
  shouldTruncate?: (
    toolName: string, 
    result: ToolResult
  ) => boolean | TruncationOptions;
}

/**
 * 截断中间件函数类型
 */
export type TruncationMiddleware = (
  toolName: string,
  result: ToolResult,
  context: TruncationContext
) => Promise<ToolResult>;

/**
 * 创建截断中间件
 * 
 * @param config 中间件配置
 * @returns 中间件函数
 * 
 * @example
 * ```typescript
 * const service = new TruncationService({ ... });
 * const middleware = createTruncationMiddleware({ service });
 * 
 * // 在 ToolRegistry 中使用
 * registry.setTruncationMiddleware(middleware);
 * ```
 */
export function createTruncationMiddleware(config: TruncationMiddlewareConfig): TruncationMiddleware {
  const { service, skipTools = [], shouldTruncate } = config;

  return async (
    toolName: string,
    result: ToolResult,
    context: TruncationContext
  ): Promise<ToolResult> => {
    // 没有输出，直接返回
    if (!result.output) {
      return result;
    }

    // 工具标记已自行处理截断
    if (result.metadata && 'truncated' in result.metadata && result.metadata.truncated !== undefined) {
      return result;
    }

    // 在跳过列表中
    if (skipTools.includes(toolName)) {
      return result;
    }

    // 自定义判断
    if (shouldTruncate) {
      const decision = shouldTruncate(toolName, result);
      if (decision === false) {
        return result;
      }
      if (typeof decision === 'object') {
        context = { ...context, options: decision };
      }
    }

    // 执行截断
    const truncated = await service.output(result.output, context);

    // 返回更新后的结果
    return {
      ...result,
      output: truncated.content,
      metadata: {
        ...result.metadata,
        truncated: truncated.truncated,
        ...(truncated.truncated && {
          truncationPath: truncated.outputPath,
          truncationRemovedLines: truncated.removedLines,
          truncationRemovedBytes: truncated.removedBytes,
        }),
      },
    };
  };
}
```

---

## 8. 与现有系统集成方案

### 8.1 方案选择

**推荐方案：在 ToolRegistry 中集成**

理由：
- ToolRegistry 是工具执行的统一入口
- 修改点集中，影响范围小
- 便于全局控制

### 8.2 修改文件: `tool/registry.ts`

```typescript
// 新增导入
import type { TruncationMiddleware } from '../truncation/middleware';

export class ToolRegistry {
  // ... 现有代码 ...
  
  private truncationMiddleware?: TruncationMiddleware;

  /**
   * 设置截断中间件
   */
  setTruncationMiddleware(middleware: TruncationMiddleware): void {
    this.truncationMiddleware = middleware;
  }

  /**
   * 执行工具（修改后）
   */
  async execute(
    toolCalls: ToolCall[],
    context?: ExecutionContext
  ): Promise<ToolExecutionResult[]> {
    // ... 现有执行逻辑 ...

    const results = await Promise.all(
      toolCalls.map(async (toolCall) => {
        // ... 现有代码直到获取 result ...

        // 应用截断中间件（新增）
        if (this.truncationMiddleware && result.output) {
          result = await this.truncationMiddleware(name, result, {
            toolName: name,
            sessionId: context?.sessionId,
          });
        }

        // ... 后续处理 ...
        return {
          tool_call_id: toolCall.id,
          name,
          arguments: paramsStr,
          result,
        };
      })
    );

    return results;
  }
}
```

### 8.3 初始化代码示例

```typescript
// 在创建 ToolRegistry 后设置截断
import { TruncationService, createTruncationMiddleware } from '../truncation';

export const createDefaultToolRegistry = (config: ToolRegistryConfig, provider?: LLMProvider) => {
  const toolRegistry = new ToolRegistry(config);
  toolRegistry.register(getDefaultTools(config.workingDirectory, provider));

  // 创建截断服务
  const truncationService = new TruncationService({
    global: {
      maxLines: 2000,
      maxBytes: 50 * 1024,
      direction: 'head',
    },
    tools: {
      bash: { direction: 'tail', maxLines: 500 },
      grep: { maxLines: 3000 },
    },
    onEvent: (event) => {
      console.log(`[Truncation] ${event.type}: ${event.toolName}`);
    },
  });

  // 创建并设置中间件
  const middleware = createTruncationMiddleware({
    service: truncationService,
    skipTools: ['web_fetch'],  // 跳过某些工具
  });

  toolRegistry.setTruncationMiddleware(middleware);

  return toolRegistry;
};
```

---

## 9. 配置设计

### 9.1 常量配置: `constants.ts`

```typescript
import type { TruncationConfig } from './types';

/**
 * 默认截断配置
 */
export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  maxLines: 2000,
  maxBytes: 50 * 1024,  // 50KB
  direction: 'head',
  enabled: true,
  retentionDays: 7,
};

/**
 * 工具特定默认配置
 */
export const TOOL_TRUNCATION_CONFIGS: Record<string, Partial<TruncationConfig>> = {
  // bash 输出通常看尾部（最新日志/错误）
  bash: {
    direction: 'tail',
    maxLines: 500,
  },
  
  // grep 结果可能很长
  grep: {
    maxLines: 3000,
  },
  
  // read 文件本身支持分页，不需要额外截断
  read: {
    enabled: false,
  },
};
```

### 9.2 用户配置示例

```typescript
// 用户可以在创建 Agent 时传入配置
const agent = new Agent({
  provider,
  truncation: {
    maxLines: 1500,
    maxBytes: 30 * 1024,
    tools: {
      bash: { direction: 'tail' },
      grep: { maxLines: 2000 },
    },
  },
});
```

---

## 10. 工具自定义截断

### 10.1 方式一：声明式配置

```typescript
// tool/bash.ts
export default class BashTool extends BaseTool<z.ZodType> {
  name = 'bash';
  description = '...';
  schema = z.object({ ... });

  // 声明截断配置
  truncation: Partial<TruncationConfig> = {
    direction: 'tail',
    maxLines: 500,
  };

  async execute(args, context) {
    // ... 执行逻辑 ...
  }
}
```

### 10.2 方式二：自行处理

```typescript
// tool/custom.ts
export class CustomTool extends BaseTool<z.ZodType> {
  async execute(args, context) {
    const output = await generateLargeOutput();

    // 工具自己处理截断
    return {
      success: true,
      output: customTruncate(output),
      metadata: {
        // 标记已处理，跳过自动截断
        truncated: true,
        customTruncation: true,
      },
    };
  }
}
```

### 10.3 中间件识别逻辑

```typescript
// middleware.ts 中
if (result.metadata && 'truncated' in result.metadata && result.metadata.truncated !== undefined) {
  // 工具已自行处理截断，跳过
  return result;
}
```

---

## 11. 实现优先级

### 11.1 阶段一：核心实现 (P0)

| 文件 | 说明 | 预计行数 |
|------|------|----------|
| `types.ts` | 类型定义 | ~100 |
| `constants.ts` | 常量配置 | ~30 |
| `service.ts` | 核心服务 | ~150 |
| `strategies/base.ts` | 策略基类 | ~40 |
| `strategies/default.ts` | 默认策略 | ~60 |

### 11.2 阶段二：集成 (P1)

| 文件 | 说明 | 预计行数 |
|------|------|----------|
| `storage.ts` | 文件存储 | ~80 |
| `middleware.ts` | 中间件 | ~60 |
| `registry.ts` 修改 | 集成点 | ~20 |
| `index.ts` | 导出 | ~20 |

### 11.3 阶段三：测试 (P2)

| 文件 | 说明 |
|------|------|
| `__tests__/service.test.ts` | 服务测试 |
| `__tests__/storage.test.ts` | 存储测试 |
| `__tests__/strategies.test.ts` | 策略测试 |
| `__tests__/middleware.test.ts` | 中间件测试 |

---

## 12. 扩展点设计

### 12.1 扩展点概览

```
┌─────────────────────────────────────────────────────────────┐
│                      扩展点                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 自定义截断策略                                           │
│     class MyStrategy extends BaseTruncationStrategy {       │
│       // 实现自定义算法                                      │
│     }                                                       │
│     service = new TruncationService({ strategy: ... })      │
│                                                             │
│  2. 自定义存储后端                                           │
│     class S3Storage implements ITruncationStorage {         │
│       // 保存到 S3                                          │
│     }                                                       │
│     service = new TruncationService({ storage: ... })       │
│                                                             │
│  3. 自定义中间件逻辑                                         │
│     const middleware = createTruncationMiddleware({         │
│       shouldTruncate: (tool, result) => { ... }             │
│     })                                                      │
│                                                             │
│  4. 事件监听                                                 │
│     service = new TruncationService({                       │
│       onEvent: (event) => {                                 │
│         // 记录日志、发送指标                                │
│       }                                                     │
│     })                                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 12.2 扩展示例：自定义策略

```typescript
// 只截断 JSON 的策略
class JsonAwareStrategy extends BaseTruncationStrategy {
  readonly name = 'json-aware';

  needsTruncation(content: string, config: TruncationConfig): boolean {
    // 如果是 JSON，检查数组长度
    try {
      const json = JSON.parse(content);
      if (Array.isArray(json)) {
        return json.length > config.maxLines;
      }
    } catch {}
    
    // 否则使用默认检查
    return super.needsTruncation(content, config);
  }

  truncate(content: string, config: TruncationConfig) {
    try {
      const json = JSON.parse(content);
      if (Array.isArray(json)) {
        const kept = json.slice(0, config.maxLines);
        return {
          content: JSON.stringify(kept, null, 2),
          removedLines: json.length - kept.length,
        };
      }
    } catch {}
    
    // 回退到默认行为
    return new DefaultTruncationStrategy().truncate(content, config);
  }
}
```

---

## 13. 测试计划

### 13.1 单元测试

```typescript
// __tests__/service.test.ts

describe('TruncationService', () => {
  describe('output', () => {
    it('should not truncate when disabled', async () => {
      const service = new TruncationService({ global: { enabled: false } });
      const result = await service.output(longContent, { toolName: 'test' });
      expect(result.truncated).toBe(false);
    });

    it('should truncate when exceeds maxLines', async () => {
      const service = new TruncationService({ global: { maxLines: 10 } });
      const result = await service.output(contentWith100Lines, { toolName: 'test' });
      expect(result.truncated).toBe(true);
    });

    it('should respect tool-specific config', async () => {
      const service = new TruncationService({
        global: { maxLines: 100 },
        tools: { bash: { maxLines: 10 } },
      });
      const result = await service.output(contentWith50Lines, { toolName: 'bash' });
      expect(result.truncated).toBe(true);
    });
  });
});
```

### 13.2 集成测试

```typescript
// __tests__/integration.test.ts

describe('Truncation Integration', () => {
  it('should truncate tool output via middleware', async () => {
    const registry = new ToolRegistry(config);
    const service = new TruncationService({ global: { maxLines: 10 } });
    registry.setTruncationMiddleware(createTruncationMiddleware({ service }));

    const results = await registry.execute([toolCall]);
    
    expect(results[0].result.output).toContain('truncated');
    expect(results[0].result.metadata?.truncated).toBe(true);
  });
});
```

---

## 14. 实现检查清单

### 14.1 Phase 1: 核心类型与服务

- [ ] 创建 `src/agent-v2/truncation/` 目录
- [ ] 实现 `types.ts` - 所有类型定义
- [ ] 实现 `constants.ts` - 默认配置
- [ ] 实现 `strategies/base.ts` - 策略基类
- [ ] 实现 `strategies/default.ts` - 默认策略
- [ ] 实现 `service.ts` - 核心服务
- [ ] 编写核心单元测试

### 14.2 Phase 2: 存储与中间件

- [ ] 实现 `storage.ts` - 文件存储
- [ ] 实现 `middleware.ts` - 中间件函数
- [ ] 实现 `index.ts` - 导出入口
- [ ] 修改 `registry.ts` - 集成中间件
- [ ] 编写集成测试

### 14.3 Phase 3: 优化与文档

- [ ] 添加配置文档
- [ ] 添加使用示例
- [ ] 性能测试
- [ ] 清理逻辑优化

---

## 附录

### A. 相关文件路径

```
src/agent-v2/
├── truncation/              # 新增模块
│   ├── index.ts
│   ├── types.ts
│   ├── constants.ts
│   ├── service.ts
│   ├── storage.ts
│   ├── middleware.ts
│   └── strategies/
│       ├── index.ts
│       ├── base.ts
│       └── default.ts
├── tool/
│   ├── registry.ts          # 修改：添加中间件支持
│   ├── base.ts              # 无需修改
│   └── ...
└── ...
```

### B. 参考文档

- OpenCode 截断机制分析: `/docs/opencode-truncation-mechanism.md`
- 现有工具系统: `src/agent-v2/tool/`
- 现有安全模块: `src/agent-v2/security/`

### C. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2025-02-26 | 初始设计 |
