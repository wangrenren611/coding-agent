/**
 * Provider 接口类型定义
 *
 * Provider 相关的接口和类型定义
 */

import { BaseProviderConfig } from './config';
import { LLMGenerateOptions, LLMRequestMessage, LLMResponse } from './api';

/**
 * Provider 抽象基类
 */
export abstract class LLMProvider {
    config: BaseProviderConfig;

    protected constructor(config: BaseProviderConfig) {
        this.config = config;
    }

    /**
     * 从提供商生成响应
     * @param messages 对话消息列表
     * @param options 可选参数（包括流式回调等）
     * @returns LLM 响应或 null（消息为空时）
     */
    abstract generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null>;
}
