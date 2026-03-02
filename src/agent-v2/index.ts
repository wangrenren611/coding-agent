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
    AgentCapabilities,
    AgentProfile,
    RunRecord,
    RunHandle,
    ExecuteCommand,
    RuntimeRunStatus,
    RuntimeEvent,
    EventFilter,
    RouteBinding,
    RouteRequest,
    SemanticRoutingConfig,
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

// 多智能体编排内核 V2（简化内核 + LLM 规划驱动）
export {
    OrchestratorKernelV2,
    LocalAgentRuntimeV2,
    parsePlan,
    planSchemaText,
    buildControllerPrompt,
    buildWorkerPrompt,
    buildDynamicRolePrompt,
    AgentSendMessageToolV2,
    AgentReceiveMessagesToolV2,
    AgentAckMessagesToolV2,
    AgentNackMessageToolV2,
    AgentListDeadLettersToolV2,
} from './orchestration-v2';
export type {
    AgentProfileV2,
    ExecuteCommandV2,
    RunHandleV2,
    RunRecordV2,
    RuntimeEventV2,
    RuntimeRunStatus as RuntimeRunStatusV2,
    InterAgentMessageV2,
    ReceiveMessageOptionsV2,
    NackMessageOptionsV2,
    NackMessageResultV2,
    AgentRuntimeV2,
    MessagingPortV2,
    PlanTaskV2,
    GoalPlanV2,
    TaskExecutionResultV2,
    GoalExecutionResultV2,
    AgentTemplateV2,
    OrchestratorV2Options,
} from './orchestration-v2';

// 多智能体编排内核 V3（controller 监督循环 + agentsConfigs）
export {
    OrchestratorKernelV3,
    AgentGetStatusToolV3,
    AgentDispatchTaskToolV3,
    AgentSendMessageToolV3,
    AgentReceiveMessagesToolV3,
    AgentWaitForMessagesToolV3,
    AgentAckMessagesToolV3,
    AgentNackMessageToolV3,
    AgentListDeadLettersToolV3,
} from './orchestration-v3';
export type {
    AgentRuntimeV3,
    RuntimeEventV3,
    AgentConfigV3,
    OrchestratorV3Options,
    DispatchCommandV3,
    TrackedRunV3,
    RunStatusSnapshotV3,
    RunStatusQueryV3,
    StatusPortV3,
    DispatchPortV3,
    InterAgentMessageV3,
    ReceiveMessageOptionsV3,
    WaitForMessagesOptionsV3,
    WaitForMessagesResultV3,
    NackMessageOptionsV3,
    NackMessageResultV3,
    MessagingPortV3,
    RunHandleV2 as RunHandleV3,
    RunRecordV2 as RunRecordV3,
    RuntimeRunStatus as RuntimeRunStatusV3,
} from './orchestration-v3';
