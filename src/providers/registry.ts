/**
 * Provider Registry
 * 
 * 模型级别的 Provider 工厂和注册表
 * 支持从环境变量创建 Provider，以具体模型为单位
 */

import { BaseAPIAdapter } from './adapters/base';
import { OpenAIAdapter } from './adapters/openai';
import { OpenAICompatibleConfig, OpenAICompatibleProvider } from './openai-compatible';
import { BaseProviderConfig } from './provider';

export type ProviderType = 'kimi' | 'deepseek' | 'glm' | 'minimax' | 'openai';

/** 模型唯一标识 */
export type ModelId =
  // GLM 系列
  | 'glm-4.7'
  // MiniMax 系列  
  | 'minimax-2.1'
  // Kimi 系列
  | 'kimi-k2.5'
  // DeepSeek 系列
  | 'deepseek-chat'

/** 模型配置 */
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
  apiKey?: string;
  temperature?: number;
}


// =============================================================================
// 模型配置表（以模型 ID 为键）
// =============================================================================

export const MODEL_CONFIGS: Record<ModelId, ModelConfig> = {
  // GLM 系列
  'glm-4.7': {
    id: 'glm-4.7',
    provider: 'glm',
    name: 'GLM-4.7',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    endpointPath: '/chat/completions',
    envApiKey: 'GLM_API_KEY',
    envBaseURL: 'GLM_API_BASE',
    model: 'glm-4.7',
    max_tokens: 8000,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling', 'vision'],
  },
  // MiniMax 系列
  'minimax-2.1': {
    id: 'minimax-2.1',
    provider: 'minimax',
    name: 'MiniMax-2.1',
    baseURL: 'https://api.minimaxi.chat/v1',
    endpointPath: '/text/chatcompletion_v2',
    envApiKey: 'MINIMAX_API_KEY',
    envBaseURL: 'MINIMAX_API_BASE',
    model: 'MiniMax-Text-01',
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

// =============================================================================
// Provider Registry
// =============================================================================

export class ProviderRegistry {
  /**
   * 从环境变量创建 Provider（以模型为单位）
   * 
   * @param modelId 模型唯一标识，如 'glm-4.7', 'minimax-2.1'
   * @param config 可选的配置覆盖
   * 
   * @example
   * ```ts
   * // 创建 GLM-4.7 实例
   * const provider = ProviderRegistry.createFromEnv('glm-4.7');
   * 
   * // 创建 MiniMax-2.1 实例，并覆盖温度
   * const provider = ProviderRegistry.createFromEnv('minimax-2.1', { temperature: 0.5 });
   * ```
   */
  static createFromEnv(
    modelId: ModelId,
    config?: Partial<ModelConfig>
  ): OpenAICompatibleProvider {
    if (!modelId) {
      throw new Error('ModelId is required. Available models: ' + this.getModelIds().join(', '));
    }

    const modelConfig = MODEL_CONFIGS[modelId];
    if (!modelConfig) {
      throw new Error(
        `Unknown model: ${modelId}. Available models: ${this.getModelIds().join(', ')}`
      );
    }

    const apiKey = process.env[modelConfig.envApiKey] || '';
    const baseURL = process.env[modelConfig.envBaseURL] || modelConfig.baseURL;

    const baseConfig: Record<string, unknown> = {
      baseURL,
      model: modelConfig.model,
      temperature: 0.3,
      max_tokens: modelConfig.max_tokens,
      maxOutputTokens: modelConfig.LLMMAX_TOKENS,
    };

    // Config overrides take precedence over env vars
    const finalConfig = {
      ...baseConfig,
      ...(config || {}),
      apiKey: config?.apiKey ?? apiKey,
      baseURL: config?.baseURL ?? baseURL,
      max_tokens: modelConfig.max_tokens,
      maxOutputTokens: modelConfig.LLMMAX_TOKENS,
    };
    const adapter = this.createAdapter(modelConfig.provider);

    return new OpenAICompatibleProvider(finalConfig as OpenAICompatibleConfig, adapter);
  }

  /**
   * 创建指定类型的 Provider
   */
  static create(modelId: ModelId, config: BaseProviderConfig): OpenAICompatibleProvider {
    const modelConfig = MODEL_CONFIGS[modelId];
    if (!modelConfig) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const adapter = this.createAdapter(modelConfig.provider);
    return new OpenAICompatibleProvider(config, adapter);
  }

  /**
   * 创建适配器
   */
  private static createAdapter(provider: ProviderType): BaseAPIAdapter {
    switch (provider) {
      case 'glm':
      case 'minimax':
      case 'kimi':
      case 'deepseek':
      case 'openai':
      default:
        return new OpenAIAdapter();
    }
  }

  /**
   * 获取所有模型配置
   */
  static listModels(): ModelConfig[] {
    return Object.values(MODEL_CONFIGS);
  }

  /**
   * 获取指定厂商的所有模型
   */
  static listModelsByProvider(provider: ProviderType): ModelConfig[] {
    return Object.values(MODEL_CONFIGS).filter(m => m.provider === provider);
  }

  /**
   * 获取所有模型 ID
   */
  static getModelIds(): ModelId[] {
    return Object.keys(MODEL_CONFIGS) as ModelId[];
  }

  /**
   * 获取指定模型的配置
   */
  static getModelConfig(modelId: ModelId): ModelConfig {
    const config = MODEL_CONFIGS[modelId];
    if (!config) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    return config;
  }

  /**
   * 获取模型显示名称
   */
  static getModelName(modelId: ModelId): string {
    return MODEL_CONFIGS[modelId]?.name || modelId;
  }

  /**
   * 获取所有支持的厂商类型
   */
  static getProviders(): ProviderType[] {
    const providers = new Set<ProviderType>();
    Object.values(MODEL_CONFIGS).forEach(m => providers.add(m.provider));
    return Array.from(providers);
  }

  // =============================================================================
  // 向后兼容方法
  // =============================================================================

  /**
   * @deprecated 使用 getModelIds() 替代
   */
  static getTypes(): ModelId[] {
    return this.getModelIds();
  }

  /**
   * @deprecated 使用 getModelIds() 替代
   */
  static getModels(): ModelId[] {
    return this.getModelIds();
  }

  /**
   * @deprecated 使用 listModels() 替代
   */
  static listProviders(): ModelConfig[] {
    return this.listModels();
  }

  /**
   * @deprecated 使用 getModelConfig() 替代
   */
  static getMetadata(modelId: ModelId): ModelConfig {
    return this.getModelConfig(modelId);
  }
}

// =============================================================================
// 便捷的模型访问器
// =============================================================================

export const Models = {
  // GLM
  get glm47(): ModelConfig { return MODEL_CONFIGS['glm-4.7']; },


  // MiniMax
  get minimax21(): ModelConfig { return MODEL_CONFIGS['minimax-2.1']; },

  // Kimi
  get kimiK25(): ModelConfig { return MODEL_CONFIGS['kimi-k2.5']; },

  // DeepSeek
  get deepseekChat(): ModelConfig { return MODEL_CONFIGS['deepseek-chat']; },


};
