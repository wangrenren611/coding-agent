/**
 * Base Adapter 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BaseAPIAdapter } from './base';
import type { LLMRequest, LLMResponse } from '../typing';

// Concrete implementation for testing
class TestAdapter extends BaseAPIAdapter {
  transformRequest(options?: LLMRequest): LLMRequest {
    return options || ({} as LLMRequest);
  }

  transformResponse(response: unknown): LLMResponse {
    return response as LLMResponse;
  }

  getHeaders(apiKey: string, config?: Record<string, unknown>): Headers {
    return new Headers({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });
  }

  getEndpointPath(): string {
    return '/test';
  }

  // Expose protected methods for testing
  testIsMessageUsable(msg: Parameters<BaseAPIAdapter['isMessageUsable']>[0]): boolean {
    return this.isMessageUsable(msg);
  }

  testCleanMessage(msg: Parameters<BaseAPIAdapter['cleanMessage']>[0]): ReturnType<BaseAPIAdapter['cleanMessage']> {
    return this.cleanMessage(msg);
  }
}

describe('BaseAPIAdapter', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
  });

  describe('isMessageUsable', () => {
    it('should return false for null/undefined message', () => {
      expect(adapter.testIsMessageUsable(null as unknown as { role: string })).toBe(false);
      expect(adapter.testIsMessageUsable(undefined as unknown as { role: string })).toBe(false);
    });

    it('should return true for message with string content', () => {
      const msg = { role: 'user', content: 'Hello' };
      expect(adapter.testIsMessageUsable(msg)).toBe(true);
    });

    it('should return true for message with array content', () => {
      const msg = { role: 'user', content: [{ type: 'text', text: 'Hello' }] };
      expect(adapter.testIsMessageUsable(msg)).toBe(true);
    });

    it('should return false for message with empty string content', () => {
      const msg = { role: 'user', content: '' };
      expect(adapter.testIsMessageUsable(msg)).toBe(false);
    });

    it('should return false for message with empty array content', () => {
      const msg = { role: 'user', content: [] };
      expect(adapter.testIsMessageUsable(msg)).toBe(false);
    });

    it('should return true for message with tool_calls', () => {
      const msg = {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: '1', type: 'function', function: { name: 'test', arguments: '{}' } },
        ],
      };
      expect(adapter.testIsMessageUsable(msg)).toBe(true);
    });

    it('should return true for message with tool_call_id', () => {
      const msg = { role: 'tool', content: '', tool_call_id: 'call_123' };
      expect(adapter.testIsMessageUsable(msg)).toBe(true);
    });

    it('should return false for message without content, tool_calls, or tool_call_id', () => {
      const msg = { role: 'user' };
      expect(adapter.testIsMessageUsable(msg)).toBe(false);
    });

    it('should handle content as undefined', () => {
      const msg = { role: 'user', content: undefined };
      expect(adapter.testIsMessageUsable(msg)).toBe(false);
    });

    it('should handle content as null', () => {
      const msg = { role: 'user', content: null };
      expect(adapter.testIsMessageUsable(msg)).toBe(false);
    });
  });

  describe('cleanMessage', () => {
    it('should clean basic messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      expect(cleaned).toHaveLength(2);
      expect(cleaned[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(cleaned[1]).toEqual({ role: 'assistant', content: 'Hi there' });
    });

    it('should convert content to string', () => {
      const messages = [
        { role: 'user', content: 123 as unknown },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      expect(cleaned[0].content).toBe('123');
    });

    it('should include reasoning_content when present', () => {
      const messages = [
        { role: 'assistant', content: 'Thinking...', reasoning_content: 'My reasoning' },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      expect(cleaned[0].reasoning_content).toBe('My reasoning');
    });

    it('should not include reasoning_content when undefined', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      expect('reasoning_content' in cleaned[0]).toBe(false);
    });

    it('should include tool_call_id when present', () => {
      const messages = [
        { role: 'tool', content: 'Result', tool_call_id: 'call_123' },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      expect(cleaned[0].tool_call_id).toBe('call_123');
    });

    it('should not include tool_call_id when undefined', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      expect('tool_call_id' in cleaned[0]).toBe(false);
    });

    it('should handle empty array', () => {
      const messages = [] as Array<Record<string, unknown>>;
      const cleaned = adapter.testCleanMessage(messages);
      expect(cleaned).toEqual([]);
    });

    it('should skip null reasoning_content (not include in output)', () => {
      const messages = [
        { role: 'assistant', content: 'Hi', reasoning_content: null },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      // null values are not included in the cleaned message
      expect('reasoning_content' in cleaned[0]).toBe(false);
    });

    it('should skip null tool_call_id (not include in output)', () => {
      const messages = [
        { role: 'tool', content: 'Result', tool_call_id: null },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      // null values are not included in the cleaned message
      expect('tool_call_id' in cleaned[0]).toBe(false);
    });

    it('should handle multiple messages with different types', () => {
      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi', reasoning_content: 'I said hi' },
        { role: 'tool', content: 'Result', tool_call_id: 'call_123' },
      ] as Array<Record<string, unknown>>;

      const cleaned = adapter.testCleanMessage(messages);

      expect(cleaned).toHaveLength(4);
      expect(cleaned[0].role).toBe('system');
      expect(cleaned[1].role).toBe('user');
      expect(cleaned[2].reasoning_content).toBe('I said hi');
      expect(cleaned[3].tool_call_id).toBe('call_123');
    });
  });

  describe('abstract methods', () => {
    it('should have transformRequest method', () => {
      expect(adapter.transformRequest).toBeDefined();
      expect(typeof adapter.transformRequest).toBe('function');
    });

    it('should have transformResponse method', () => {
      expect(adapter.transformResponse).toBeDefined();
      expect(typeof adapter.transformResponse).toBe('function');
    });

    it('should have getHeaders method', () => {
      expect(adapter.getHeaders).toBeDefined();
      expect(typeof adapter.getHeaders).toBe('function');
    });

    it('should have getEndpointPath method', () => {
      expect(adapter.getEndpointPath).toBeDefined();
      expect(typeof adapter.getEndpointPath).toBe('function');
    });
  });
});
