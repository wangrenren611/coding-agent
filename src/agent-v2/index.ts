/**
 * Agent v2 统一导出入口
 */

// Agent 核心
export { Agent } from './agent/agent';
export type {
  AgentOptions,
  AgentStatus,
  StreamCallback,
} from './agent/types';
export { AgentError, ToolError } from './agent/errors';

// 流式消息类型
export type {
  AgentMessage,
  AgentMessageType,
} from './agent/stream-types';

// 事件总线
export { EventBus, EventType } from './eventbus/eventbus';
export type {
  EventMap,
  EventListener,
  BaseEventData,
  TaskStartData,
  TaskProgressData,
  TaskSuccessData,
  TaskFailedData,
  TaskRetryData,
  ToolStartData,
  ToolSuccessData,
  ToolFailedData,
  StreamChunkData,
  Event,
} from './eventbus/types';

// 工具系统
export { ToolRegistry } from './tool/registry';
export { BaseTool } from './tool/base';
export type {
  ToolRegistryConfig,
  ToolEventCallbacks,
} from './tool/registry';
export type { ToolCategory } from './tool/type';
// Re-export ToolResult and ToolSchema from their source files
export type { ToolResult } from './tool/base';
export type { ToolSchema } from './tool/type';

// 会话管理
export { Session } from './session';
export { Compaction } from './session/compaction';
export type {
  SessionOptions,
  SessionConfig,
  Message,
  CompactionConfig,
} from './session';

// MemoryManager
export {
  createMemoryManager,
  FileMemoryManager,
} from './memory';
export type {
  IMemoryManager,
  MemoryManagerOptions,
  SessionData,
  CurrentContext,
  HistoryMessage,
  TaskData,
  CompactionRecord,
  QueryOptions,
  HistoryQueryOptions,
  SessionFilter,
  TaskFilter,
  HistoryFilter,
  CompactContextOptions,
  StorageItem,
} from './memory/types';

// 工具函数
export { v4 as uuid } from 'uuid';
