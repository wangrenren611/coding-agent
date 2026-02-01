/**
 * Agent 核心类型定义
 */

import type { LLMProvider } from '../../providers';
import type { ToolRegistry } from '../tool/registry';
import { AgentMessage } from './stream-types';


/**
 * Agent 状态枚举
 */
export enum AgentStatus {
    /** 空闲 */
    IDLE = 'IDLE',
    /** 运行中 */
    RUNNING = 'RUNNING',
    /** 已完成 */
    COMPLETED = 'COMPLETED',
    /** 失败 */
    FAILED = 'FAILED',
}


export type StreamCallback = <T extends AgentMessage>(message: T) => void;

/**
 * Agent 配置选项
 */
export interface AgentOptions{
    /** LLM Provider */
    provider: LLMProvider;
    /** 系统提示词 */
    systemPrompt: string;
    /** 工具注册表 */
    toolRegistry: ToolRegistry;
    /** 最大重试次数（默认 10） */
    maxRetries?: number;
    /** 单次 LLM 请求超时时间（毫秒，默认 60000） */
    requestTimeout?: number;
    /** 是否启用流式输出 */
    stream?: boolean;
    /** 流式输出回调函数 - 统一的消息接口 */
    streamCallback?: StreamCallback;
}
