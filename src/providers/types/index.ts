/**
 * Types 统一导出
 *
 * 统一导出所有类型定义，提供单一的导入入口
 */

// API 相关类型
export type {
    ToolCall,
    Role,
    TextContentPart,
    ImageUrlContentPart,
    InputAudioContentPart,
    InputVideoContentPart,
    FileContentPart,
    InputContentPart,
    MessageContent,
    Usage,
    StreamOptions,
    BaseLLMMessage,
    LLMResponseMessage,
    LLMRequestMessage,
    FinishReason,
    LLMResponse,
    Chunk,
    StreamCallback,
    Tool,
    LLMGenerateOptions,
    LLMRequest,
} from './api';

// 配置相关类型
export type {
    BaseAPIConfig,
    BaseProviderConfig,
    OpenAICompatibleConfig,
} from './config';

// Provider 相关类型
export { LLMProvider } from './provider';

// 错误类型
export {
    LLMError,
    LLMRetryableError,
    LLMRateLimitError,
    LLMPermanentError,
    LLMAuthError,
    LLMNotFoundError,
    LLMBadRequestError,
    LLMAbortedError,
    createErrorFromStatus,
    isRetryableError,
    isPermanentError,
    isAbortedError,
} from './errors';

// Registry 相关类型
export type {
    ProviderType,
    ModelId,
    ModelConfig,
} from './registry';
