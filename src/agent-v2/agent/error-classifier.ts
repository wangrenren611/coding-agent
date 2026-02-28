/**
 * Agent 错误分类器
 *
 * 负责错误分类、识别和用户友好的错误消息转换
 */

import { LLMError, isAbortedError, isTimeoutReasonText } from '../../providers';
import {
    AgentError,
    ToolError,
    AgentAbortedError,
    AgentBusyError,
    AgentMaxRetriesExceededError,
    AgentLoopExceededError,
    AgentConfigurationError,
    AgentValidationError,
    LLMRequestError,
    LLMResponseInvalidError,
    hasValidFailureCode,
} from './errors';
import { AgentFailure, AgentFailureCode, AgentStatus, AGENT_FAILURE_CODES } from './types';
import { SafeError } from './types-internal';

/**
 * 错误分类器
 */
export class ErrorClassifier {
    /**
     * 对错误进行分类，返回失败代码
     *
     * 分类优先级：
     * 1. 检查 Agent 状态（ABORTED）
     * 2. 检查专用错误子类（instanceof）
     * 3. 检查 AgentError.code 属性
     * 4. 检查 Provider 层错误类型
     * 5. 消息内容匹配（后备方案）
     * 6. 默认返回 AGENT_RUNTIME_ERROR
     */
    classifyFailureCode(error: unknown, status?: string): AgentFailureCode {
        // 1. 检查 Agent 状态
        if (status === AgentStatus.ABORTED) {
            return 'AGENT_ABORTED';
        }

        // 2. 检查专用错误子类（优先级最高，类型安全）
        if (error instanceof AgentAbortedError) {
            return 'AGENT_ABORTED';
        }
        if (error instanceof AgentBusyError) {
            return 'AGENT_BUSY';
        }
        if (error instanceof AgentMaxRetriesExceededError) {
            return 'AGENT_MAX_RETRIES_EXCEEDED';
        }
        if (error instanceof AgentLoopExceededError) {
            return 'AGENT_LOOP_EXCEEDED';
        }
        if (error instanceof AgentConfigurationError) {
            return 'AGENT_CONFIGURATION_ERROR';
        }
        if (error instanceof AgentValidationError) {
            return 'AGENT_VALIDATION_ERROR';
        }
        if (error instanceof LLMRequestError) {
            return 'LLM_REQUEST_FAILED';
        }
        if (error instanceof LLMResponseInvalidError) {
            return 'LLM_RESPONSE_INVALID';
        }
        if (error instanceof ToolError) {
            return 'TOOL_EXECUTION_FAILED';
        }

        // 3. 检查 AgentError.code 属性（后备方案）
        if (hasValidFailureCode(error)) {
            return error.code;
        }

        // 4. 检查 Provider 层错误类型
        if (isAbortedError(error)) {
            return 'AGENT_ABORTED';
        }
        if (this.isTimeoutLikeError(error)) {
            return 'LLM_TIMEOUT';
        }
        if (error instanceof LLMError) {
            return 'LLM_REQUEST_FAILED';
        }

        // 5. 消息内容匹配（兼容旧代码的后备方案）
        if (error instanceof AgentError && error.message) {
            const message = error.message.toLowerCase();
            if (message.includes('abort')) {
                return 'AGENT_ABORTED';
            }
            if (message.includes('maximum retries') && !message.includes('compensation')) {
                return 'AGENT_MAX_RETRIES_EXCEEDED';
            }
            if (message.includes('not idle') || message.includes('current status')) {
                return 'AGENT_BUSY';
            }
        }

        // 6. 默认返回运行时错误
        return 'AGENT_RUNTIME_ERROR';
    }

    /**
     * 将错误转换为安全的用户友好格式
     */
    sanitizeError(error: unknown): SafeError {
        // Agent 层错误 - 直接返回消息
        if (error instanceof AgentError) {
            return {
                userMessage: error.message,
                internalMessage: error.stack,
            };
        }

        // 工具错误 - 用户友好的提示
        if (error instanceof ToolError) {
            return {
                userMessage: 'Tool execution failed. Please try again.',
                internalMessage: error.message,
            };
        }

        // 通用错误
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
     * 检查是否为超时类错误
     */
    private isTimeoutLikeError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = `${error.name} ${error.message}`.toLowerCase();
        return isTimeoutReasonText(message) || message.includes('body timeout') || message.includes('terminated');
    }

    /**
     * 检查错误码是否有效
     */
    isValidFailureCode(code: string): code is AgentFailureCode {
        return (AGENT_FAILURE_CODES as readonly string[]).includes(code);
    }
}

/** 默认错误分类器实例 */
export const defaultErrorClassifier = new ErrorClassifier();
