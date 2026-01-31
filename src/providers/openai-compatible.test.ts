/**
 * OpenAI Compatible Provider 测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible';
import { StandardAdapter } from './adapters/standard';
import type { LLMRequestMessage, LLMRequest } from './typing';

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    const config = {
      apiKey: 'test-api-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
      timeout: 30000,
      maxRetries: 3,
      debug: false,
    };

    provider = new OpenAICompatibleProvider(config);
  });

  describe('constructor', () => {
    it('should create provider with required config', () => {
      expect(provider.apiKey).toBe('test-api-key');
      expect(provider.baseURL).toBe('https://api.example.com');
      expect(provider.model).toBe('gpt-4');
      expect(provider.temperature).toBe(0.7);
      expect(provider.max_tokens).toBe(2000);
      expect(provider.LLMMAX_TOKENS).toBe(8000);
    });

    it('should create default adapter when none provided', () => {
      expect(provider.adapter).toBeInstanceOf(StandardAdapter);
    });

    it('should create with custom adapter', () => {
      const customAdapter = new StandardAdapter();
      const customProvider = new OpenAICompatibleProvider(
        {
          apiKey: 'test-key',
          baseURL: 'https://api.test.com',
          model: 'gpt-4',
          temperature: 0.5,
          max_tokens: 1000,
          LLMMAX_TOKENS: 4000,
        },
        customAdapter
      );

      expect(customProvider.adapter).toBe(customAdapter);
    });

    it('should normalize baseURL (remove trailing slash)', () => {
      const providerWithSlash = new OpenAICompatibleProvider({
        apiKey: 'test-key',
        baseURL: 'https://api.example.com/',
        model: 'gpt-4',
        temperature: 0.5,
        max_tokens: 1000,
        LLMMAX_TOKENS: 4000,
      });

      expect(providerWithSlash.baseURL).toBe('https://api.example.com');
    });

    it('should create HTTPClient with config options', () => {
      expect(provider.httpClient).toBeDefined();
    });
  });

  describe('generate', () => {
    const mockMessages: LLMRequestMessage[] = [
      { role: 'user', content: 'Hello' },
    ];

    it('should return null for empty messages', async () => {
      const result = await provider.generate([]);
      expect(result).toBeNull();
    });

    it('should make non-stream request when stream is false/undefined', async () => {
      const mockResponse = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_cache_miss_tokens: 10,
          prompt_cache_hit_tokens: 0,
        },
      };

      // Mock the httpClient.fetch method
      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const result = await provider.generate(mockMessages);

      expect(result).toEqual(mockResponse);
    });

    it('should make streaming request when stream is true', async () => {
      const mockChunks = [
        'data: {"id": "chunk1", "index": 0, "choices": [{"index": 0, "delta": {"content": "Hello"}}]}\n\n',
        'data: {"id": "chunk2", "index": 0, "choices": [{"index": 0, "delta": {"content": " World"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      // Create a mock ReadableStream
      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as Response);

      const streamCallback = vi.fn();
      const result = await provider.generate(mockMessages, { stream: true, streamCallback });

      expect(result).toBeDefined();
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.content).toBe('Hello World');
      expect(streamCallback).toHaveBeenCalled();
    });

    it('should pass options to adapter transformRequest', async () => {
      const mockResponse = {
        id: 'test-id',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' } }],
      };

      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const options: LLMRequest = {
        model: 'gpt-3.5-turbo',
        temperature: 0.5,
        max_tokens: 1000,
        stream: false,
      };

      await provider.generate(mockMessages, options);

      expect(provider.httpClient['fetch']).toHaveBeenCalled();
    });

    it('should include tools in request when provided', async () => {
      const mockResponse = {
        id: 'test-id',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' } }],
      };

      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const tools = [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      await provider.generate(mockMessages, { tools });

      expect(provider.httpClient['fetch']).toHaveBeenCalled();
    });
  });

  describe('resolveEndpoint', () => {
    it('should combine baseURL and endpoint path', () => {
      expect(provider.baseURL).toBe('https://api.example.com');
    });
  });

  describe('error handling', () => {
    it('should throw error when fetch fails', async () => {
      vi.spyOn(provider.httpClient, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      await expect(
        provider.generate([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow();
    });

    it('should handle HTTP errors', async () => {
      vi.spyOn(provider.httpClient, 'fetch').mockRejectedValueOnce(new Error('500 Internal Server Error'));

      await expect(
        provider.generate([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow();
    });
  });

  describe('stream response handling', () => {
    it('should accumulate content across chunks', async () => {
      const mockChunks = [
        'data: {"id": "c1", "index": 0, "choices": [{"index": 0, "delta": {"content": "A"}}]}\n\n',
        'data: {"id": "c2", "index": 0, "choices": [{"index": 0, "delta": {"content": "B"}}]}\n\n',
        'data: {"id": "c3", "index": 0, "choices": [{"index": 0, "delta": {"content": "C"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as Response);

      const result = await provider.generate([{ role: 'user', content: 'Hi' }], {
        stream: true,
      });

      expect(result.choices[0].message.content).toBe('ABC');
    });

    it('should handle tool calls in stream', async () => {
      const mockChunks = [
        'data: {"id": "c1", "index": 0, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "test", "arguments": ""}}]}}]}\n\n',
        'data: {"id": "c2", "index": 0, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as Response);

      const result = await provider.generate([{ role: 'user', content: 'Hi' }], {
        stream: true,
      });

      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls?.[0].function.name).toBe('test');
      expect(result.choices[0].message.tool_calls?.[0].function.arguments).toBe('{}');
    });

    it('should throw error for empty stream without stop reason', async () => {
      const mockChunks = [
        'data: {"id": "c1", "index": 0, "choices": [{"index": 0, "finish_reason": "length"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as Response);

      await expect(
        provider.generate([{ role: 'user', content: 'Hi' }], { stream: true })
      ).rejects.toThrow('Empty content in response');
    });

    it('should handle empty stream with stop reason', async () => {
      const mockChunks = [
        'data: {"id": "c1", "index": 0, "choices": [{"index": 0, "finish_reason": "stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as Response);

      const result = await provider.generate([{ role: 'user', content: 'Hi' }], {
        stream: true,
      });

      expect(result.choices[0].message.content).toBe('');
      expect(result.choices[0].finish_reason).toBe('stop');
    });

    it('should update metadata from stream chunks', async () => {
      const mockChunks = [
        'data: {"id": "test-id", "object": "chat.completion.chunk", "created": 1234567890, "model": "gpt-4", "index": 0, "choices": [{"index": 0, "delta": {"content": "Hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as Response);

      const result = await provider.generate([{ role: 'user', content: 'Hello' }], {
        stream: true,
      });

      expect(result.id).toBe('test-id');
      expect(result.object).toBe('chat.completion.chunk');
      expect(result.created).toBe(1234567890);
      expect(result.model).toBe('gpt-4');
    });
  });

  describe('abort signal', () => {
    it('should support abort signal in non-streaming mode', async () => {
      const controller = new AbortController();
      controller.abort();

      // Mock fetch to reject with AbortError when signal is aborted
      vi.spyOn(provider.httpClient, 'fetch').mockRejectedValueOnce(
        new DOMException('Aborted', 'AbortError')
      );

      await expect(
        provider.generate([{ role: 'user', content: 'Hello' }], {
          abortSignal: controller.signal,
        })
      ).rejects.toThrow();
    }, 10000);
  });
});
