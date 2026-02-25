/**
 * 通用 OpenAI 兼容 Provider 基类
 *
 * 提供统一的请求/流处理逻辑，配合不同 Adapter 与元数据即可支持多家兼容服务。
 *
 * @example
 * ```typescript
 * const provider = new OpenAICompatibleProvider({
 *     apiKey: 'sk-xxx',
 *     baseURL: 'https://api.example.com',
 *     model: 'gpt-4',
 *     temperature: 0.7,
 *     max_tokens: 4096,
 *     LLMMAX_TOKENS: 128000,
 *     chatCompletionsPath: '/v1/chat/completions',
 * });
 *
 * const response = await provider.generate(messages, { stream: true });
 * ```
 */

import { BaseAPIAdapter } from './adapters/base';
import { StandardAdapter } from './adapters/standard';
import { HTTPClient } from './http/client';
import { StreamParser } from './http/stream-parser';
import { LLMError } from './types';
import {
    LLMProvider,
    OpenAICompatibleConfig,
    Chunk,
    LLMGenerateOptions,
    LLMRequestMessage,
    LLMResponse,
} from './types';



/**
 * OpenAI 兼容 Provider 基类
 *
 * 支持所有兼容 OpenAI API 格式的服务，包括：
 * - OpenAI 官方 API
 * - Azure OpenAI
 * - 各种兼容第三方服务（如 DeepSeek、Qwen、通义千问等）
 */
export class OpenAICompatibleProvider extends LLMProvider {



  
    readonly httpClient: HTTPClient;
    readonly adapter: BaseAPIAdapter;
    private timeout: number;

    constructor(config: OpenAICompatibleConfig, adapter?: BaseAPIAdapter) {
        super(config);

        // 规范化 baseURL（移除末尾斜杠）
        const normalizedBaseURL = config.baseURL.replace(/\/$/, '');
        this.config = { ...config, baseURL: normalizedBaseURL };
        this.timeout = config.timeout ?? 1000 * 60 * 3; // 3 minutes (Agent 层控制实际超时)
        
        // 初始化 HTTP 客户端
        this.httpClient = new HTTPClient({
            timeout: this.timeout,
            debug: config.debug ?? false,
        });

        // 初始化 Adapter（未提供则使用标准适配器）
        this.adapter = adapter ?? new StandardAdapter({
            defaultModel: config.model,
            endpointPath: config.chatCompletionsPath ?? '/chat/completions',
        });
    }

    /**
     * 生成 LLM 响应
     *
     * @param messages - 对话消息列表
     * @param options - 可选参数（模型、温度、流式等）
     * @returns LLM 响应或 AsyncGenerator<Chunk>（流式时）
     */
    generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
        if (messages.length === 0) {
            return Promise.resolve(null);
        }

        const resolvedOptions = this.resolveGenerateOptions(options);

        // 构建请求体
        const requestBody = this.adapter.transformRequest({
            model: resolvedOptions?.model ?? this.config.model,
            max_tokens: resolvedOptions?.max_tokens,
            temperature: this.config.temperature,
            messages,
            thinking: resolvedOptions?.thinking ?? this.config.thinking,
            ...(resolvedOptions ?? {}),
        });

        // 构建请求参数
        const requestParams = {
            url: this._resolveEndpoint(),
            body: requestBody,
            headers: this.adapter.getHeaders(this.config.apiKey),
            abortSignal: resolvedOptions?.abortSignal,
        };

        // 根据是否流式选择处理方式
        if (options?.stream) {
            return this._generateStream(requestParams);
        }

        return this._generateNonStream(requestParams);
    }

    /**
     * 统一处理生成选项，补齐流式 usage 配置
     */
    private resolveGenerateOptions(options?: LLMGenerateOptions): LLMGenerateOptions {
        if (!options) return {};

        const resolved: LLMGenerateOptions = { ...options };

        if (resolved.stream && this.shouldIncludeStreamUsage(resolved)) {
            resolved.stream_options = {
                ...(resolved.stream_options || {}),
                include_usage: true,
            };
        }

        return resolved;
    }

    private shouldIncludeStreamUsage(options: LLMGenerateOptions): boolean {
        if (!options.stream) return false;
        if (options.stream_options?.include_usage === false) return false;
        return this.config.enableStreamUsage !== false;
    }

    /**
     * 解析完整的端点 URL
     */
    private _resolveEndpoint(): string {
        return `${this.config.baseURL}${this.adapter.getEndpointPath()}`;
    }

    /**
     * 处理非流式请求
     */
    private async _generateNonStream(params: {
        url: string;
        body: Record<string, unknown>;
        headers: Headers;
        abortSignal?: AbortSignal;
    }): Promise<LLMResponse> {
        const response = await this.httpClient.fetch(params.url, {
            method: 'POST',
            headers: params.headers,
            body: JSON.stringify(params.body),
            signal: params.abortSignal,
        });

        let data: unknown;
        try {
            data = await response.json();
        } catch (error) {
            throw new LLMError(
                `Failed to parse response as JSON: ${error instanceof Error ? error.message : String(error)}`,
                'INVALID_JSON'
            );
        }

        return this.adapter.transformResponse(data);
    }

    /**
     * 处理流式请求
     *
     * 直接返回 AsyncGenerator<Chunk>，由调用者消费流式数据。
     */
    private async *_generateStream(params: {
        url: string;
        body: Record<string, unknown>;
        headers: Headers;
        abortSignal?: AbortSignal;
    }): AsyncGenerator<Chunk> {
        const response = await this.httpClient.fetch(params.url, {
            method: 'POST',
            headers: params.headers,
            body: JSON.stringify(params.body),
            signal: params.abortSignal,
        });

        if (!response.body) {
            throw new LLMError('Response body is not readable', 'NO_BODY');
        }

        // 直接 yield 每个 chunk，不累积
        yield* StreamParser.parseAsync(response.body.getReader());
    }

    getTimeTimeout(): number {
        return this.timeout;
    }

    getLLMMaxTokens(): number {
        return this.config.LLMMAX_TOKENS;
    }
    
    getMaxOutputTokens(): number {
      return this.config.max_tokens;
    }
}



// 重新导出配置类型
export type { OpenAICompatibleConfig } from './types';
