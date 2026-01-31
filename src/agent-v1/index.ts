/**
 * Agent 模块统一导出
 */

// 主类
export { CodingAgent } from './agent';

// 类型定义
export type {
    AgentConfig,
    AgentOptions,
    AgentResult,
    AgentEvent,
    ExecutionOptions,
} from './types';

export type {
    ToolDefinition,
    ToolResult,
    ToolCallRecord,
} from './types';

export type {
    Task,
    TaskPlan,
    TaskStats,
} from './types';

export type {
    ExecutionContext,
    Thought,
    FileChangeRecord,
} from './types';

export type {
    ReActContext,
} from './types';

export type {
    ConfirmationRequest,
    ConfirmationResponse,
} from './types';

export type {
    TokenUsage,
    BackupInfo,
    JSONSchema7,
} from './types';

// 枚举值（既是类型也是值）
export {
    AgentStatus,
    AgentEventType,
    ToolCategory,
    PermissionLevel,
    TaskStatus,
    ReActState,
} from './types';

// 工具相关
export { ToolRegistry } from './tools/registry';
export type { ToolRegistryConfig } from './tools/registry';

export { ToolExecutor } from './tools/executor';
export type { ToolExecutorConfig } from './tools/executor';

export { ToolCache } from './tools/cache';
export type { ToolCacheConfig } from './tools/cache';

// 内置工具
export { fileTools } from './tools/builtin/file';
export { searchTools } from './tools/builtin/search';
export { executeTools } from './tools/builtin/execute';

// 核心引擎
export { ReActEngine } from './core/engine';
export type { ReActEngineConfig, ReActExecuteOptions } from './core/engine';

export { Planner } from './core/planner';
export type { PlannerConfig } from './core/planner';

// 记忆管理
export { MemoryManager } from './memory/manager';
export type { MemoryManagerConfig } from './memory/manager';

// 任务管理
export { TaskManager } from './tasks/manager';
export type { TaskManagerConfig } from './tasks/manager';

// 工具函数
export { BackupManager } from './utils/backup';
export type { BackupManagerConfig } from './utils/backup';

// 提示词
export {
    getDefaultSystemPrompt,
    getPlannerPrompt,
    getReflectionPrompt,
    getToolUsagePrompt,
    getErrorRecoveryPrompt,
} from './prompts/system';
