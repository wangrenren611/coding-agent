/**
 * Agent 错误处理器
 * 
 * 负责 Agent 特定的错误分类、消毒和处理
 */

import { LLMError } from '../../providers';
import { AgentError, ToolError } from './errors';
import { ErrorHandler, SafeError, ErrorClassification } from './config';


/**
 * Agent 特定的错误分类码
 */
export type AgentErrorCode = 
    | 'AGENT_ABORTED'
    | 'AGENT_MAX_RETRIES_EXCEEDED'
    | 'LLM_TIMEOUT'
    | 'TOOL_EXECUTION_FAILED'
    | 'LLM_REQUEST_FAILED'
    | 'AGENT_RUNTIME_ERROR';


/**
 * Agent 失败信息
 */
export interface AgentFailureInfo {
    code: AgentErrorCode;
    userMessage: string;
    internalMessage?: string;
}


/**
 * Agent 错误处理器
 * 
 * 继承 config.ts 中的基础 ErrorHandler
 * 添加 Agent 特定的错误分类逻辑
 */
export class AgentErrorHandler {
    /**
     * 错误分类
     */
    static classify(
        error: unknown, 
        agentStatus?: string,
        maxRetries?: number,
        retryCount?: number
    ): AgentErrorCode {
        // 检查中止状态
        if (agentStatus === 'ABORTED' || this.isAbortLikeError(error)) {
            return 'AGENT_ABORTED';
        }

        // 检查最大重试次数
        if (retryCount !== undefined && maxRetries !== undefined && retryCount > maxRetries) {
            return 'AGENT_MAX_RETRIES_EXCEEDED';
        }

        // 检查工具执行错误
        if (error instanceof ToolError) {
            return 'TOOL_EXECUTION_FAILED';
        }

        // 检查超时错误
        if (this.isTimeoutLikeError(error)) {
            return 'LLM_TIMEOUT';
        }

        // 检查 LLM 错误
        if (error instanceof LLMError) {
            return 'LLM_REQUEST_FAILED';
        }

        // 默认运行时错误
        return 'AGENT_RUNTIME_ERROR';
    }


    /**
     * 错误消毒 - 提取安全信息
     * 使用 config.ts 中的基础 ErrorHandler
     */
    static sanitize(error: unknown): SafeError {
        if (error instanceof ToolError) {
            return {
                userMessage: 'Tool execution failed. Please try again.',
                internalMessage: error.message,
            };
        }

        // 使用基础 ErrorHandler 处理其他错误
        return ErrorHandler.sanitize(error);
    }


    /**
     * 构建 Agent 失败信息
     */
    static buildFailure(
        error: unknown,
        agentStatus?: string,
        maxRetries?: number,
        retryCount?: number
    ): AgentFailureInfo {
        const safeError = this.sanitize(error);
        const code = this.classify(error, agentStatus, maxRetries, retryCount);

        return {
            code,
            userMessage: safeError.userMessage,
            internalMessage: safeError.internalMessage,
        };
    }


    /**
     * 判断是否为中止类错误
     */
    private static isAbortLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return message.includes('abort') || message.includes('aborted');
    }


    /**
     * 判断是否为超时类错误
     */
    private static isTimeoutLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return (
            message.includes('timeout') ||
            message.includes('timed out') ||
            message.includes('time out') ||
            message.includes('signal timed out')
        );
    }
}
