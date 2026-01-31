export type ToolCall = {
    id: string;
    type: string;
    index: number;
    function: {
        name: string;
        arguments?: string;
    };
}
export type role= 'system' | 'assistant' | 'user' | 'tool'
export type LLMResponseMessage = {
    content: string;
    role: string;
    reasoning_content?: string;
    tool_calls?: ToolCall[];
};



export type LLMRequestMessage={
    content: string;
    role: string;
    reasoning_content?: string;
    tool_call_id?: string;
}

export type LLMOptions = {
   baseUrl:string;
   apiKey: string;
   params: LLMRequest;
};

export type Usage ={
        prompt_tokens: number;//用户 prompt 所包含的 token 数。该值等于 prompt_cache_hit_tokens + prompt_cache_miss_tokens
        completion_tokens: number;//模型 completion 产生的 token 数。
        total_tokens: number;//该请求中，所有 token 的数量（prompt + completion）。
        prompt_cache_miss_tokens: number;//用户 prompt 中未命中缓存的 token 数。该值等于 prompt_tokens - prompt_cache_miss_tokens
        prompt_cache_hit_tokens: number;//用户 prompt 中命中缓存的 token 数。该值等于 prompt_tokens - prompt_cache_miss_tokens
}

export type LLMResponse = {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: LLMResponseMessage;
        finish_reason?: FinishReason;
    }>;
    usage?:Usage;
};

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;


export type Chunk = {
    id?: string;
    index: number;
    choices?: Array<{
        index: number;
        delta: LLMResponseMessage;
        finish_reason?: FinishReason;
    }>;
    usage?: Usage;
    model?: string;
    object?: string;
    created?: number;
 
}

export type StreamCallback = (chunk:Chunk) => void

export type LLMRequest = {
    model: string;
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    messages: LLMRequestMessage[];
    abortSignal?: AbortSignal;
    tools?: Array<{
        type: string;
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>;
//   [key: string]: unknown;
  streamCallback?: StreamCallback
};


