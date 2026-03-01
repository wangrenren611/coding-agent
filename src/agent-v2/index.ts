/**
 * Agent v2 统一导出入口
 */

// Agent 核心
export { Agent } from './agent/agent';
export { AgentStatus } from './agent/types';
export type { AgentOptions, StreamCallback } from './agent/types';
export { AgentError, ToolError } from './agent/errors';

// Agent 内部类型和工具
export type { ITimeProvider } from './agent/types-internal';

// 流式消息类型
export { AgentMessageType } from './agent/stream-types';
export type { AgentMessage, SubagentEventMessage, BaseAgentEvent } from './agent/stream-types';

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
export type { ToolRegistryConfig, ToolEventCallbacks } from './tool/registry';
export type { ToolCategory } from './tool/type';
// Re-export ToolResult and ToolSchema from their source files
export type { ToolResult } from './tool/base';
export type { ToolSchema } from './tool/type';

// 会话管理
export { Session } from './session';
export { Compaction } from './session/compaction';
export type { SessionOptions, SessionConfig, Message, CompactionConfig } from './session';

// MemoryManager
export { createMemoryManager, FileMemoryManager } from './memory';
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

// 日志模块
export { Logger, ChildLogger, createLogger, getLogger, setDefaultLogger } from './logger';
export { LogLevel, LogLevelName } from './logger/types';
export type {
    LoggerConfig,
    LogRecord,
    LogContext,
    LogLevel as LogLevelType,
    ITransport,
    IFormatter,
    LogMiddleware,
    LogStats,
    ConsoleTransportConfig,
    FileTransportConfig,
    TransportConfig,
} from './logger/types';
export { JsonFormatter, PrettyFormatter } from './logger/formatters';
export { ConsoleTransport, FileTransport } from './logger/transports';
export {
    createContextMiddleware,
    ContextManager,
    getContextManager,
    createAgentEventMapper,
    createEventLoggerMiddleware,
} from './logger/middleware';

// 多智能体编排内核
export {
    InMemoryEventStream,
    InMemoryStateStore,
    DefaultPolicyEngine,
    GatewayRouter,
    AgentRuntimeService,
    OrchestratorKernel,
    AgentSendMessageTool,
    AgentReceiveMessagesTool,
    AgentAckMessagesTool,
    AgentNackMessageTool,
    AgentListDeadLettersTool,
    AgentRequeueDeadLetterTool,
} from './orchestration';
export type { AgentRuntimeServiceOptions } from './orchestration';
export type {
    AgentRuntime,
    AgentProfile,
    RunRecord,
    RunHandle,
    ExecuteCommand,
    RuntimeRunStatus,
    RuntimeEvent,
    EventFilter,
    RouteBinding,
    RouteRequest,
    RouteDecision,
    InterAgentMessage,
    SpawnCommand,
    RunGraphNode,
    BudgetPolicy,
    PolicyDecision,
    ExecutionPolicyContext,
    SpawnPolicyContext,
    MessageRuntimeConfig,
    ReceiveMessageOptions,
    NackMessageOptions,
    NackMessageResult,
    MessagingRule,
    MessagingPolicy,
    MessagingPolicyContext,
    EventStream,
    StateStore,
    PolicyEngine,
} from './orchestration';
export type {
    AgentConfig,
    AutoDispatchConfig,
    AutoDispatchTrigger,
    OrchestratorKernelOptions,
    OrchestratorKernelRuntimeOptions,
    OrchestratorKernelBootstrapOptions,
} from './orchestration';
