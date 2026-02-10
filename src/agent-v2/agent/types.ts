/**
 * Agent 核心类型定义
 */

import type { LLMProvider } from '../../providers';
import type { ToolRegistry } from '../tool/registry';
import { AgentMessage } from './stream-types';
import type { ITimeProvider } from './types-internal';
import type { IMemoryManager } from '../memory/types';
import type { CompactionConfig } from '../session';
import type { Message } from '../session/types';

export enum AgentStatus {
  THINKING = 'thinking',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
  IDLE = 'idle',
  ABORTED = 'aborted',
}

export type StreamCallback = <T extends AgentMessage>(message: T) => void;

export type AgentFailureCode =
  | 'AGENT_ABORTED'
  | 'AGENT_MAX_RETRIES_EXCEEDED'
  | 'LLM_TIMEOUT'
  | 'TOOL_EXECUTION_FAILED'
  | 'LLM_REQUEST_FAILED'
  | 'AGENT_RUNTIME_ERROR';

export interface AgentFailure {
  code: AgentFailureCode;
  userMessage: string;
  internalMessage?: string;
}

export interface AgentExecutionResult {
  status: 'completed' | 'failed' | 'aborted';
  finalMessage?: Message;
  failure?: AgentFailure;
  loopCount: number;
  retryCount: number;
  sessionId: string;
}

/**
 * Agent 配置选项
 */
export interface AgentOptions{
    /** LLM Provider */
    provider: LLMProvider;
    /** 系统提示词 */
    systemPrompt?: string;
    /** 工具注册表 */
    toolRegistry?: ToolRegistry;
    /** 最大重试次数（默认 10） */
    maxRetries?: number;
    /** 单次 LLM 请求超时时间（毫秒，默认使用 provider 配置） */
    requestTimeout?: number;
    /** 重试等待时间（毫秒，默认 1000 * 60 * 10） */
    retryDelayMs?: number;
    /** 是否启用流式输出 */
    stream?: boolean;
    /** 流式输出回调函数 - 统一的消息接口 */
    streamCallback?: StreamCallback;
    /** 时间提供者（用于测试） */
    timeProvider?: ITimeProvider;
    /** 流式缓冲区最大大小（字节，默认 100000） */
    maxBufferSize?: number;
    /** MemoryManager 实例（可选，用于持久化存储） */
    memoryManager?: IMemoryManager;
    /** 会话ID（用于恢复已有会话） */
    sessionId?: string;
    /** 是否启用自动上下文压缩 */
    enableCompaction?: boolean;
    /** 压缩配置（可选，未提供字段会使用 provider 默认值） */
    compactionConfig?: Partial<Omit<CompactionConfig, 'llmProvider'>>;
}
