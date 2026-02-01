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
import { LLMError, Role } from './types';
import {
    LLMProvider,
    OpenAICompatibleConfig,
    Chunk,
    FinishReason,
    LLMGenerateOptions,
    LLMRequestMessage,
    LLMResponse,
    ToolCall,
    Usage,
} from './types';

/**
 * 流式响应元数据（内部使用）
 */
interface StreamMetadata {
    id: string;
    object: string;
    created: number;
    model: string;
    usage: Usage;
}

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
        this.timeout = config.timeout ?? 1000*60*10;// 10 minutes
        
        // 初始化 HTTP 客户端
        this.httpClient = new HTTPClient({
            timeout: this.timeout,// 10 minutes
            maxRetries: config.maxRetries ?? 10,
            initialRetryDelay: 1000,
            maxRetryDelay: 10000,
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

        // 构建请求体
        const requestBody = this.adapter.transformRequest({
            model: options?.model ?? this.config.model,
            max_tokens: options?.max_tokens,
            temperature: this.config.temperature,
            messages,
            ...(options ?? {}),
        });

        // 构建请求参数
        const requestParams = {
            url: this._resolveEndpoint(),
            body: requestBody,
            headers: this.adapter.getHeaders(this.config.apiKey),
            abortSignal: options?.abortSignal,
        };

        // 根据是否流式选择处理方式
        if (options?.stream) {
            return this._generateStream(requestParams);
        }

        return this._generateNonStream(requestParams);
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
    
}

/**
 * 流式响应累积器
 *
 * 用于聚合 SSE 流中的增量数据，包括：
 * - 文本内容的增量拼接
 * - 工具调用的增量拼接（arguments 可能分多次传输）
 * - 元数据（id、model、usage 等）的更新
 */
class StreamAccumulator {
    private contentMap = new Map<number, string>();
    private roleMap = new Map<number, string>();
    private toolCallsMap = new Map<number, ToolCall>();

    private metadata: StreamMetadata = {
        id: '',
        object: '',
        created: 0,
        model: '',
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            prompt_cache_miss_tokens: 0,
            prompt_cache_hit_tokens: 0,
        },
    };

    private finishReason: FinishReason | null = null;
    private choiceIndex = 0;

    /**
     * 累积单个流式块的数据
     */
    accumulate(chunk: Chunk): void {
        const choice = chunk.choices?.[0];
        if (!choice) {
            return;
        }

        this.choiceIndex = choice.index ?? 0;
        const delta = choice.delta;

        // 更新内容
        if (delta?.content) {
            const existing = this.contentMap.get(this.choiceIndex) ?? '';
            this.contentMap.set(this.choiceIndex, existing + delta.content);

            if (delta.role) {
                this.roleMap.set(this.choiceIndex, delta.role);
            }
        }

        // 更新工具调用
        if (delta?.tool_calls?.length) {
            for (const toolCall of delta.tool_calls) {
                const callIndex = toolCall.index ?? 0;
                const existing = this.toolCallsMap.get(callIndex);

                this.toolCallsMap.set(callIndex, {
                    id: existing?.id ?? (toolCall.id ?? ''),
                    index: callIndex,
                    type: existing?.type ?? (toolCall.type ?? 'function'),
                    function: {
                        name: existing?.function.name ?? (toolCall.function.name ?? ''),
                        arguments: (existing?.function.arguments ?? '') + (toolCall.function.arguments ?? ''),
                    },
                });
            }
        }

        // 更新元数据
        if (chunk.id) this.metadata.id = chunk.id;
        if (chunk.object) this.metadata.object = chunk.object;
        if (chunk.created) this.metadata.created = chunk.created;
        if (chunk.model) this.metadata.model = chunk.model;
        if (chunk.usage) this.metadata.usage = chunk.usage;
        if (choice.finish_reason) this.finishReason = choice.finish_reason;
    }

    /**
     * 验证响应是否有效
     *
     * @throws 当响应为空且无有效完成原因时抛出错误
     */
    validate(): void {
        const hasContent = this.contentMap.size > 0;
        const hasToolCalls = this.toolCallsMap.size > 0;
        const isEmptyResponse = !hasContent && !hasToolCalls;

        // 允许空响应的完成原因：stop（正常结束）、tool_calls（仅工具调用）、length（达到长度限制）
        const validEmptyReasons: FinishReason[] = ['stop', 'tool_calls', 'length', 'content_filter'];

        if (isEmptyResponse && this.finishReason && !validEmptyReasons.includes(this.finishReason)) {
            throw new LLMError(
                `Empty response with unexpected finish reason: ${this.finishReason}`,
                'EMPTY_RESPONSE'
            );
        }
    }

    /**
     * 构建最终的 LLMResponse
     */
    toResponse(): LLMResponse | null {
        const content = this.contentMap.get(this.choiceIndex) ?? '';
        const role = this.roleMap.get(this.choiceIndex) ?? 'assistant';
        const toolCalls = Array.from(this.toolCallsMap.values());

        // 如果完全没有内容也没有工具调用，且没有明确的完成原因，返回 null
        if (!content && toolCalls.length === 0 && !this.finishReason) {
            return null;
        }

        return {
            id: this.metadata.id,
            object: this.metadata.object,
            created: this.metadata.created,
            model: this.metadata.model,
            choices: [
                {
                    index: this.choiceIndex,
                    message: {
                        role:role as Role,
                        content,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    },
                    finish_reason: this.finishReason ?? undefined,
                },
            ],
            usage: this.metadata.usage,
        };
    }
}

// 重新导出配置类型
export type { OpenAICompatibleConfig } from './types';
