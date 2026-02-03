/**
 * Registry 相关类型定义
 *
 * Provider Registry 相关的类型定义
 */

/**
 * Provider 厂商类型
 */
export type ProviderType = 'kimi' | 'deepseek' | 'glm' | 'minimax' | 'openai';

/**
 * 模型唯一标识
 */
export type ModelId =
    // GLM 系列
    | 'glm-4.7'
    // MiniMax 系列
    | 'minimax-2.1'
    // Kimi 系列
    | 'kimi-k2.5'
    // DeepSeek 系列
    | 'deepseek-chat';

/**
 * 模型配置
 */
export interface ModelConfig {
    /** 模型唯一标识 */
    id: ModelId;
    /** 所属厂商 */
    provider: ProviderType;
    /** 显示名称 */
    name: string;
    /** API 端点路径 */
    endpointPath: string;
    /** API Key 环境变量名 */
    envApiKey: string;
    /** Base URL 环境变量名 */
    envBaseURL: string;
    /** API 基础 URL */
    baseURL: string;
    /** API 模型名称 */
    model: string;
    /** 最大上下文 token 数 */
    max_tokens: number;
    /** 最大输出 token 数 */
    LLMMAX_TOKENS: number;
    /** 支持的特性 */
    features: string[];
    /** API 密钥（可选） */
    apiKey?: string;
    /** 温度（可选） */
    temperature?: number;
    thinking?: boolean;
}
