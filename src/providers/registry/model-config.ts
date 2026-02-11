/**
 * 模型配置存储
 *
 * 集中管理所有模型的配置信息，可从外部加载
 */

import type { ModelConfig, ModelId } from '../types';

/**
 * 模型配置表（以模型 ID 为键，不包含 apiKey 的配置）
 */
export const MODEL_DEFINITIONS: Record<ModelId, Omit<ModelConfig, 'apiKey'>> = {
    // GLM 系列
    'glm-4.7': {
        id: 'glm-4.7',
        provider: 'glm',
        name: 'GLM-4.7',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        endpointPath: '/chat/completions',
        envApiKey: 'GLM_API_KEY',
        envBaseURL: 'GLM_API_BASE',
        model: 'GLM-4.7',
        max_tokens: 8000,
        LLMMAX_TOKENS: 200 * 1000,
        features: ['streaming', 'function-calling', 'vision'],
    },
     // GLM 系列
    'glm-5.0': {
        id: 'glm-5.0',
        provider: 'glm',
        name: 'GLM-5.0',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        endpointPath: '/chat/completions',
        envApiKey: 'GLM_API_KEY',
        envBaseURL: 'GLM_API_BASE',
        model: 'GLM-4.7',
        max_tokens: 8000,
        LLMMAX_TOKENS: 200 * 1000,
        features: ['streaming', 'function-calling', 'vision'],
    },
    // MiniMax 系列
    'minimax-2.1': {
        id: 'minimax-2.1',
        provider: 'minimax',
        name: 'MiniMax-2.1',
        baseURL: 'https://api.minimaxi.com/v1',
        endpointPath: '/chat/completions',
        envApiKey: 'MINIMAX_API_KEY',
        envBaseURL: 'MINIMAX_API_BASE',
        model: 'MiniMax-M2.1',
        max_tokens: 8000,
        LLMMAX_TOKENS: 200 * 1000,
        features: ['streaming', 'function-calling'],
    },
    // Kimi 系列
    'kimi-k2.5': {
        id: 'kimi-k2.5',
        provider: 'kimi',
        name: 'Kimi K2.5',
        baseURL: 'https://api.moonshot.cn/v1',
        endpointPath: '/chat/completions',
        envApiKey: 'KIMI_API_KEY',
        envBaseURL: 'KIMI_API_BASE',
        model: 'kimi-k2.5',
        max_tokens: 8000,
        LLMMAX_TOKENS: 200 * 1000,
        features: ['streaming', 'function-calling', 'reasoning'],
        temperature: 0.6,
        thinking: false,
    },
    // DeepSeek 系列
    'deepseek-chat': {
        id: 'deepseek-chat',
        provider: 'deepseek',
        name: 'DeepSeek Chat',
        baseURL: 'https://api.deepseek.com/v1',
        endpointPath: '/chat/completions',
        envApiKey: 'DEEPSEEK_API_KEY',
        envBaseURL: 'DEEPSEEK_API_BASE',
        model: 'deepseek-chat',
        max_tokens: 8000,
        LLMMAX_TOKENS: 128 * 1000,
        features: ['streaming', 'function-calling'],
    },
};
