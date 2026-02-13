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

// Agent 配置管理
export {
    AgentConfig,
    QueryValidator,
    ErrorHandler,
    DEFAULT_LOOP_MAX,
    DEFAULT_MAX_RETRIES,
    DEFAULT_MAX_COMPENSATION_RETRIES,
    DEFAULT_RETRY_DELAY_MS,
    DEFAULT_MAX_BUFFER_SIZE,
    DEFAULT_TOOL_TIMEOUT_MS,
    DEFAULT_COMPACTION_TRIGGER_RATIO,
    DEFAULT_KEEP_MESSAGES_NUM,
    MAX_QUERY_LENGTH,
} from './agent/config';
export type {
    NormalizedAgentConfig,
    QueryValidationResult,
    SafeError,
    ErrorClassification,
} from './agent/config';

// Agent 内部类型和工具
export type { ITimeProvider } from './agent/types-internal';
export { MessageBuilder } from './agent/message-builder';
export {
  createUserMessage,
  createAssistantMessage,
  createToolCallMessage,
  createToolResultMessage,
} from './agent/message-builder';

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


// 实用工具
export {
    safeParse,
    safeJSONStringify,
    LRUCache,
    TTLLRUCache,
    Semaphore,
    TimeoutSemaphore,
    SemaphoreGuard,
    now,
    nowISO,
    formatDuration,
    sleep,
    timeout,
    isNonEmptyString,
    isPositiveInteger,
    isObject,
    isArray,
    hasProperty,
    getProperty,
    validateRequired,
    validateLength,
    validateRange,
    validatePattern,
    validateEmail,
    validateUrl,
} from './util';

export type { ValidationResult } from './util';


// 消息仓储
export {
    InMemoryMessageRepository,
} from './session/message-repository';

export type {
    MessageRepository,
    MessageQueryOptions,
} from './session/message-repository';
