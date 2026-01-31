/**
 * Standard Adapter 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StandardAdapter } from './standard';
import type { LLMRequest, LLMResponse } from '../typing';

describe('StandardAdapter', () => {
  let adapter: StandardAdapter;

  beforeEach(() => {
    adapter = new StandardAdapter();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      expect(adapter.endpointPath).toBe('/chat/completions');
      expect(adapter.defaultModel).toBe('gpt-4o');
    });

    it('should create with custom endpointPath', () => {
      const customAdapter = new StandardAdapter({ endpointPath: '/v1/chat' });
      expect(customAdapter.endpointPath).toBe('/v1/chat');
    });

    it('should create with custom defaultModel', () => {
      const customAdapter = new StandardAdapter({ defaultModel: 'gpt-3.5-turbo' });
      expect(customAdapter.defaultModel).toBe('gpt-3.5-turbo');
    });

    it('should create with both custom options', () => {
      const customAdapter = new StandardAdapter({
        endpointPath: '/api/chat',
        defaultModel: 'custom-model',
      });
      expect(customAdapter.endpointPath).toBe('/api/chat');
      expect(customAdapter.defaultModel).toBe('custom-model');
    });
  });

  describe('transformRequest', () => {
    it('should transform basic request', () => {
      const options: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 1000,
      };

      const result = adapter.transformRequest(options);

      expect(result.model).toBe('gpt-4');
      expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(1000);
      expect(result.stream).toBe(false);
    });

    it('should use default model when not provided', () => {
      const options: LLMRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      } as LLMRequest;

      const result = adapter.transformRequest(options);

      expect(result.model).toBe('gpt-4o');
    });

    it('should set stream to true when specified', () => {
      const options: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const result = adapter.transformRequest(options);

      expect(result.stream).toBe(true);
    });

    it('should include tools when provided', () => {
      const tools = [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather info',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const options: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        tools,
      };

      const result = adapter.transformRequest(options);

      expect(result.tools).toEqual(tools);
    });

    it('should not include tools when not provided', () => {
      const options: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = adapter.transformRequest(options);

      expect(result.tools).toBeUndefined();
    });

    it('should not include tools when empty array', () => {
      const options: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
      };

      const result = adapter.transformRequest(options);

      expect(result.tools).toBeUndefined();
    });

    it('should handle options with empty messages', () => {
      const result = adapter.transformRequest({ messages: [] as unknown as LLMRequest['messages'] });

      expect(result.model).toBe('gpt-4o');
      expect(result.messages).toEqual([]);
      expect(result.stream).toBe(false);
    });

    it('should clean messages in the request', () => {
      const options: LLMRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi', reasoning_content: 'thinking' },
        ] as unknown as LLMRequest['messages'],
      };

      const result = adapter.transformRequest(options);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result.messages[1]).toEqual({
        role: 'assistant',
        content: 'Hi',
        reasoning_content: 'thinking',
      });
    });
  });

  describe('transformResponse', () => {
    it('should transform valid response', () => {
      const response: LLMResponse = {
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

      const result = adapter.transformResponse(response);

      expect(result).toEqual(response);
    });

    it('should throw error for response with empty choices', () => {
      const response = {
        id: 'test-id',
        choices: [],
      } as unknown as Record<string, unknown>;

      expect(() => adapter.transformResponse(response)).toThrow('Empty choices in response');
    });

    it('should throw error for response without choices', () => {
      const response = {
        id: 'test-id',
      } as unknown as Record<string, unknown>;

      expect(() => adapter.transformResponse(response)).toThrow('Empty choices in response');
    });

    it('should handle response with multiple choices', () => {
      const response: LLMResponse = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Response 1' },
            finish_reason: 'stop',
          },
          {
            index: 1,
            message: { role: 'assistant', content: 'Response 2' },
            finish_reason: 'stop',
          },
        ],
      };

      const result = adapter.transformResponse(response);

      expect(result.choices).toHaveLength(2);
    });
  });

  describe('getHeaders', () => {
    it('should return headers with Bearer auth', () => {
      const headers = adapter.getHeaders('test-api-key');

      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Authorization')).toBe('Bearer test-api-key');
    });

    it('should handle empty API key', () => {
      const headers = adapter.getHeaders('');

      expect(headers.get('Authorization')).toBe('Bearer');
    });
  });

  describe('getEndpointPath', () => {
    it('should return the endpoint path', () => {
      expect(adapter.getEndpointPath()).toBe('/chat/completions');
    });

    it('should return custom endpoint path', () => {
      const customAdapter = new StandardAdapter({ endpointPath: '/v1/chat' });
      expect(customAdapter.getEndpointPath()).toBe('/v1/chat');
    });
  });

  describe('enrichRequestBody', () => {
    it('should return body unchanged by default', () => {
      const body: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      // Access protected method through subclass
      class TestAdapter extends StandardAdapter {
        public testEnrich(body: LLMRequest, options?: LLMRequest): LLMRequest {
          return this.enrichRequestBody(body, options);
        }
      }

      const testAdapter = new TestAdapter();
      const result = testAdapter.testEnrich(body);

      expect(result).toEqual(body);
    });
  });
});
