/**
 * Agent 错误分类器
 * 
 * 负责错误分类、识别和用户友好的错误消息转换
 */

import { LLMError, isAbortedError } from "../../providers";
import { AgentError, ToolError } from "./errors";
import { AgentFailure, AgentFailureCode, AgentStatus } from "./types";
import { SafeError } from "./types-internal";

/**
 * 错误分类器
 */
export class ErrorClassifier {
    /**
     * 对错误进行分类，返回失败代码
     */
    classifyFailureCode(error: unknown, status?: string): AgentFailureCode {
        if (status === AgentStatus.ABORTED || isAbortedError(error) || this.isAbortLikeError(error)) {
            return 'AGENT_ABORTED';
        }
        if (error instanceof AgentError && /maximum retries/i.test(error.message)) {
            return 'AGENT_MAX_RETRIES_EXCEEDED';
        }
        if (error instanceof ToolError) {
            return 'TOOL_EXECUTION_FAILED';
        }
        if (this.isTimeoutLikeError(error)) {
            return 'LLM_TIMEOUT';
        }
        if (error instanceof LLMError) {
            return 'LLM_REQUEST_FAILED';
        }
        return 'AGENT_RUNTIME_ERROR';
    }

    /**
     * 将错误转换为安全的用户友好格式
     */
    sanitizeError(error: unknown): SafeError {
        if (error instanceof AgentError) {
            return {
                userMessage: error.message,
                internalMessage: error.stack,
            };
        }

        if (error instanceof ToolError) {
            return {
                userMessage: 'Tool execution failed. Please try again.',
                internalMessage: error.message,
            };
        }

        if (error instanceof Error) {
            return {
                userMessage: 'An unexpected error occurred. Please try again.',
                internalMessage: error.message,
            };
        }

        return {
            userMessage: 'An unexpected error occurred. Please try again.',
            internalMessage: String(error),
        };
    }

    /**
     * 构建失败对象
     */
    buildFailure(error: unknown, status?: string): AgentFailure {
        const safeError = this.sanitizeError(error);
        return {
            code: this.classifyFailureCode(error, status),
            userMessage: safeError.userMessage,
            internalMessage: safeError.internalMessage,
        };
    }

    /**
     * 检查是否为中止类错误
     */
    private isAbortLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return message.includes('abort') || message.includes('aborted');
    }

    /**
     * 检查是否为超时类错误
     */
    private isTimeoutLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return (
            message.includes('timeout')
            || message.includes('timed out')
            || message.includes('time out')
            || message.includes('signal timed out')
        );
    }
}

/** 默认错误分类器实例 */
export const defaultErrorClassifier = new ErrorClassifier();
