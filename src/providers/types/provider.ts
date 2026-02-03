/**
 * Provider 接口类型定义
 *
 * Provider 相关的接口和类型定义
 */

import { BaseProviderConfig } from './config';
import { Chunk, LLMGenerateOptions, LLMRequestMessage, LLMResponse } from './api';

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
     * @param options 可选参数（包括流式等）
     * @returns LLM 响应、null（消息为空时）、或 AsyncGenerator<Chunk>（流式时）
     */
    abstract generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk>;

    abstract getTimeTimeout(): number;
    abstract getLLMMaxTokens(): number;
    abstract getMaxOutputTokens(): number;
}
