/**
 * 核心类型定义
 *
 * 这个文件包含 agent-v2 模块共享的基础类型，避免类型重复定义。
 * 设计原则：
 * 1. 单一职责：每个类型只在一个地方定义
 * 2. 清晰的导出路径
 * 3. 类型安全
 */

import type { FinishReason, MessageContent, Usage, InputContentPart } from '../../providers';
import type { ToolResult } from '../tool/base';

// 从 providers 重导出共享类型，避免重复定义
export type { ToolCall } from '../../providers';

// ==================== 工具调用扩展类型 ====================

/**
 * 流式工具调用（扩展 ToolCall）
 * index 字段在流式处理中是必需的
 */
export interface StreamToolCall {
    /** 工具调用 ID */
    id: string;
    /** 调用类型，通常为 'function' */
    type: string;
    /** 工具索引（流式处理必需） */
    index: number;
    /** 函数调用详情 */
    function: {
        name: string;
        arguments: string;
    };
}

// ==================== 时间提供者 ====================

/**
 * 时间提供者接口
 * 用于提升可测试性，允许注入模拟时间
 */
export interface ITimeProvider {
    /** 获取当前时间戳（毫秒） */
    getCurrentTime(): number;
    /** 异步睡眠 */
    sleep(ms: number): Promise<void>;
}

// ==================== 验证类型 ====================

/**
 * 验证结果
 */
export interface ValidationResult {
    /** 是否验证通过 */
    valid: boolean;
    /** 错误信息（验证失败时） */
    error?: string;
}

// ==================== 错误处理类型 ====================

/**
 * 安全错误信息
 * 用于向用户展示错误时不泄露敏感信息
 */
export interface SafeError {
    /** 用户可见的错误消息 */
    userMessage: string;
    /** 内部错误消息（用于日志） */
    internalMessage?: string;
}

// ==================== 执行结果类型 ====================

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
    /** 工具调用 ID */
    tool_call_id: string;
    /** 工具名称 */
    name: string;
    /** 原始参数 */
    arguments: string;
    /** 执行结果 */
    result: ToolResult;
}

// ==================== 事件类型 ====================

/**
 * 任务失败事件数据
 */
export interface TaskFailedEvent {
    /** 事件时间戳 */
    timestamp: number;
    /** 错误信息 */
    error: string;
    /** 总循环次数 */
    totalLoops: number;
    /** 总重试次数 */
    totalRetries: number;
}

// ==================== 流式处理元数据 ====================

/**
 * 流式 chunk 元数据
 */
export interface StreamChunkMetadata {
    /** 响应 ID */
    id?: string;
    /** 模型名称 */
    model?: string;
    /** 创建时间戳 */
    created?: number;
    /** 完成原因 */
    finish_reason?: FinishReason;
    /** Token 使用量 */
    usage?: Usage;
}

// ==================== 辅助函数 ====================

/**
 * 内容转文本
 * 将 MessageContent 转换为纯文本字符串
 */
export function contentToText(content: MessageContent): string {
    if (typeof content === 'string') {
        return content;
    }
    return content
        .map((part) => stringifyContentPart(part))
        .filter(Boolean)
        .join('\n');
}

/**
 * 内容部分转字符串
 */
export function stringifyContentPart(part: InputContentPart): string {
    switch (part.type) {
        case 'text':
            return part.text || '';
        case 'image_url':
            return `[image] ${part.image_url?.url || ''}`.trim();
        case 'file':
            return `[file] ${part.file?.filename || part.file?.file_id || ''}`.trim();
        case 'input_audio':
            return '[audio]';
        case 'input_video':
            return `[video] ${part.input_video?.url || part.input_video?.file_id || ''}`.trim();
        default:
            return '';
    }
}

/**
 * 检查内容是否有实际值
 */
export function hasContent(content: MessageContent): boolean {
    if (typeof content === 'string') {
        return content?.length > 0;
    }
    return content?.length > 0;
}
