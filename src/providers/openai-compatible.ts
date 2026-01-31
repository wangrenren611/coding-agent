/**
 * 通用 OpenAI 兼容 Provider 基类
 * 复用统一的请求/流处理逻辑，配合不同 Adapter 与元数据即可支持多家兼容服务。
 */

import { BaseAPIAdapter } from "./adapters/base";
import { StandardAdapter } from "./adapters/standard";
import { LLMError } from "./errors";
import { HTTPClient } from "./http/client";
import { StreamParser } from "./http/stream-parser";
import { BaseProviderConfig, LLMProvider } from "./provider";
import { FinishReason, LLMRequest, LLMRequestMessage, LLMResponse, LLMResponseMessage, StreamCallback,ToolCall } from "./typing";



export interface OpenAICompatibleConfig extends BaseProviderConfig {
    organization?: string;

    [key: string]: unknown;
}

export class OpenAICompatibleProvider extends LLMProvider {
    readonly httpClient: HTTPClient;
    readonly baseURL: string;
    apiKey: string;
    temperature: number;
    model: string;
    max_tokens: number;
    adapter: BaseAPIAdapter;
    LLMMAX_TOKENS: number;

    constructor(config: OpenAICompatibleConfig, adapter?: BaseAPIAdapter) {
        super(config);
        this.apiKey = config.apiKey;
        this.baseURL = config.baseURL;
        this.temperature = config.temperature;
        this.model = config.model;
        this.max_tokens = config.max_tokens;
        this.LLMMAX_TOKENS = config.LLMMAX_TOKENS;
        this.adapter = adapter ?? new StandardAdapter({
            defaultModel: config.model,
            endpointPath: config.chatCompletionsPath as string,
        });

        this.config = {
            ...config,
            baseURL: (config.baseURL).replace(/\/$/, ''),
        };

        this.baseURL = this.config.baseURL as string;

        this.httpClient = new HTTPClient({
            timeout: config.timeout,
            maxRetries: config.maxRetries,
            debug: config.debug,
        });
    }

    async generate(
        messages: LLMRequestMessage[],
        options?: LLMRequest
    ): Promise<LLMResponse | null> {

        if (messages.length === 0) return null;

        const requestBody = this.adapter.transformRequest({
            model: options?.model || this.config.model,
            max_tokens: options?.max_tokens,
            temperature: this.config.temperature,
            messages: messages,
            ...(options || {}),
        });

        const url = this.resolveEndpoint();

        const headers = this.adapter.getHeaders(this.config.apiKey || '');

        if (options?.stream) {
            return await this.generateStream({
                url,
                body: requestBody,
                headers,
                streamCallback: options.streamCallback,
                abortSignal: options?.abortSignal,
            });
        }

        return await this.generateNonStream({
            url,
            body: requestBody,
            headers,
            abortSignal: options?.abortSignal,
        });
    }

    private resolveEndpoint(): string {
        const base = this.baseURL;
        return `${base}${this.adapter.getEndpointPath()}`;
    }

    private async generateNonStream(
        {
            url,
            body,
            headers,
            abortSignal
        }: {
            url: string,
            body: Record<string, unknown>,
            headers: Headers,
            abortSignal?: AbortSignal
        }
    ): Promise<LLMResponse> {


        const response = await this.httpClient.fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortSignal,
        });

        const data = await response.json() as Record<string, unknown>;

        return this.adapter.transformResponse(data);
    }

    private async generateStream(
        {
            url,
            body,
            headers,
            streamCallback,
            abortSignal
        }: {
            url: string,
            body: Record<string, unknown>,
            headers: Headers,
            streamCallback?: StreamCallback,
            abortSignal?: AbortSignal
        }
    ): Promise<LLMResponse | null> {
        const response = await this.httpClient.fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortSignal,
        });

        if (!response.body) {
            throw new LLMError('Response body is not readable', 'NO_BODY');
        }

        const reader = response.body.getReader();
        const toolCallsMap = new Map<number, ToolCall>();
        const messagesMap = new Map<number, LLMResponseMessage>();
        const contentMap = new Map<number, string>();

        let finishReason: FinishReason | null = null;
        let choiceIndex = 0;

        const result: LLMResponse = {
            id: '',
            object: '',
            created: 0,
            model: '',
            choices: [],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                prompt_cache_miss_tokens: 0,
                prompt_cache_hit_tokens: 0,
            },
        };

        try {
            await StreamParser.parse(reader, (chunk) => {
                streamCallback?.(chunk);

                const choice = chunk.choices?.[0];
                if (!choice) return;

                choiceIndex = choice.index ?? 0;
                const delta = choice.delta;

                // Update content
                if (delta?.content) {
                    const existing = contentMap.get(choiceIndex) || '';
                    contentMap.set(choiceIndex, existing + delta.content);

                    messagesMap.set(choiceIndex, {
                        role: delta.role || 'assistant',
                        content: contentMap.get(choiceIndex)!,
                    });
                }

                // Update tool calls
                if (delta?.tool_calls?.length) {
                    delta.tool_calls.forEach((toolCall) => {
                        const callIndex = toolCall.index ?? 0;
                        const existing = toolCallsMap.get(callIndex);
                        toolCallsMap.set(callIndex, {
                            id: existing?.id || toolCall.id || '',
                            index: callIndex,
                            type: existing?.type || toolCall.type || 'function',
                            function: {
                                name: existing?.function.name || toolCall.function.name || '',
                                arguments: (existing?.function.arguments || '') + (toolCall.function.arguments || ''),
                            },
                        });
                    });
                }

                // Update metadata
                if (chunk.id) result.id = chunk.id;
                if (chunk.object) result.object = chunk.object;
                if (chunk.created) result.created = chunk.created;
                if (chunk.model) result.model = chunk.model;
                if (chunk.usage) result.usage = chunk.usage;
                if (choice.finish_reason) finishReason = choice.finish_reason;
            });
        } catch (error) {
            throw error;
        }

        const hasContent = contentMap.size > 0;
        const hasToolCalls = toolCallsMap.size > 0;
        const isEmptyResponse = !hasContent && !hasToolCalls;

        if (isEmptyResponse && finishReason !== 'stop') {
            throw new Error('Empty content in response without tool calls or stop reason');
        }

        return {
            ...result,
            choices: [
                {
                    index: choiceIndex,
                    message: {
                        role: messagesMap.get(choiceIndex)?.role || 'assistant',
                        content: messagesMap.get(choiceIndex)?.content || '',
                        tool_calls: Array.from(toolCallsMap.values()),
                    },
                    finish_reason: finishReason,
                },
            ],
        };
    }
}

