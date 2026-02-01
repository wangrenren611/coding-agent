/**
 * Stream Parser 测试
 */

import { describe, it, expect } from 'vitest';
import { StreamParser } from './stream-parser';
import type { Chunk } from '../types';

describe('StreamParser', () => {
  describe('parseSseLine', () => {
    it('should extract data from SSE data line', () => {
      const line = 'data: {"id": "test"}';
      const result = StreamParser.parseSseLine(line);
      expect(result).toBe('{"id": "test"}');
    });

    it('should handle SSE data line with extra spaces', () => {
      const line = 'data:    {"id": "test"}   ';
      const result = StreamParser.parseSseLine(line);
      expect(result).toBe('{"id": "test"}');
    });

    it('should return null for empty line', () => {
      const result = StreamParser.parseSseLine('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only line', () => {
      const result = StreamParser.parseSseLine('   ');
      expect(result).toBeNull();
    });

    it('should return null for comment line', () => {
      const result = StreamParser.parseSseLine(': this is a comment');
      expect(result).toBeNull();
    });

    it('should return JSON for raw JSON line (no data prefix)', () => {
      const line = '{"id": "test"}';
      const result = StreamParser.parseSseLine(line);
      expect(result).toBe('{"id": "test"}');
    });

    it('should return null for non-data, non-JSON line', () => {
      const result = StreamParser.parseSseLine('event: message');
      expect(result).toBeNull();
    });
  });

  describe('isStreamEnd', () => {
    it('should return true for [DONE]', () => {
      expect(StreamParser.isStreamEnd('[DONE]')).toBe(true);
    });

    it('should return false for other data', () => {
      expect(StreamParser.isStreamEnd('{"id": "test"}')).toBe(false);
      expect(StreamParser.isStreamEnd('')).toBe(false);
      expect(StreamParser.isStreamEnd('[done]')).toBe(false);
    });
  });

  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      const data = '{"id": "test", "content": "hello", "index": 0}';
      const result = StreamParser.safeJsonParse<Chunk>(data);
      expect(result).toEqual({ id: 'test', content: 'hello', index: 0 });
    });

    it('should return null for invalid JSON', () => {
      const result = StreamParser.safeJsonParse<Chunk>('invalid json');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = StreamParser.safeJsonParse<Chunk>('');
      expect(result).toBeNull();
    });

    it('should parse JSON with arrays', () => {
      const data = '{"choices": [{"index": 0}]}';
      const result = StreamParser.safeJsonParse<Chunk>(data);
      expect(result?.choices).toEqual([{ index: 0 }]);
    });

    it('should parse JSON with nested objects', () => {
      const data = '{"usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30, "prompt_cache_miss_tokens": 0, "prompt_cache_hit_tokens": 0}}';
      const result = StreamParser.safeJsonParse<Chunk>(data);
      expect(result?.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, prompt_cache_miss_tokens: 0, prompt_cache_hit_tokens: 0 });
    });
  });

  describe('parseAsync', () => {
    async function parseFromText(text: string): Promise<Chunk[]> {
      const chunks: Chunk[] = [];
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(text));
          controller.close();
        },
      });

      const reader = stream.getReader();
      for await (const chunk of StreamParser.parseAsync(reader)) {
        chunks.push(chunk);
      }
      return chunks;
    }

    it('should parse single SSE chunk', async () => {
      // Include role in delta to match LLMResponseMessage type
      const mockData = 'data: {"id": "test", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hello"}}]}';
      const chunks = await parseFromText(mockData);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe('test');
      expect(chunks[0].choices?.[0].delta.content).toBe('Hello');
    });

    it('should parse multiple SSE chunks', async () => {
      const mockData = `data: {"id": "test1", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hello"}}]}
data: {"id": "test2", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": " World"}}]}`;
      const chunks = await parseFromText(mockData);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].id).toBe('test1');
      expect(chunks[1].id).toBe('test2');
    });

    it('should stop parsing at [DONE]', async () => {
      const mockData = `data: {"id": "test1", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hello"}}]}
data: [DONE]
data: {"id": "test2", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "World"}}]}`;
      const chunks = await parseFromText(mockData);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe('test1');
    });

    it('should ignore empty lines', async () => {
      const mockData = `data: {"id": "test1", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hello"}}]}

data: {"id": "test2", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "World"}}]}`;
      const chunks = await parseFromText(mockData);

      expect(chunks).toHaveLength(2);
    });

    it('should ignore comment lines', async () => {
      const mockData = `: this is a comment
data: {"id": "test", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hello"}}]}`;
      const chunks = await parseFromText(mockData);

      expect(chunks).toHaveLength(1);
    });

    it('should handle split data across reads', async () => {
      const chunks: Chunk[] = [];
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('data: {"id": "test", "index": 0, "choices":'));
          await new Promise(r => setTimeout(r, 10));
          controller.enqueue(encoder.encode(' [{"index": 0, "delta": {"role": "assistant", "content": "hi"}}]}'));
          controller.close();
        },
      });

      const reader = stream.getReader();
      for await (const chunk of StreamParser.parseAsync(reader)) {
        chunks.push(chunk);
      }

      // Incomplete JSON in first read should be buffered and parsed when complete
      expect(chunks).toHaveLength(1);
    });

    it('should yield all valid chunks', async () => {
      const mockData = `data: {"id": "test1", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "A"}}]}
data: {"id": "test2", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "B"}}]}`;

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(mockData));
          controller.close();
        },
      });

      const reader = stream.getReader();
      const chunks: Chunk[] = [];
      for await (const chunk of StreamParser.parseAsync(reader)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
    });

    it('should handle CRLF line endings', async () => {
      const mockData = 'data: {"id": "test", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant"}}]}\r\ndata: {"id": "test2", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant"}}]}';
      const chunks = await parseFromText(mockData);

      expect(chunks).toHaveLength(2);
    });

    it('should handle mixed line endings', async () => {
      const mockData = 'data: {"id": "test1", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant"}}]}\n\rdata: {"id": "test2", "index": 0, "choices": [{"index": 0, "delta": {"role": "assistant"}}]}';
      const chunks = await parseFromText(mockData);

      expect(chunks).toHaveLength(2);
    });
  });
});
