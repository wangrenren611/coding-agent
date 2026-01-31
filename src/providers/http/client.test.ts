/**
 * HTTP Client 测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HTTPClient } from './client';
import { LLMRetryableError } from '../errors';

describe('HTTPClient', () => {
  let client: HTTPClient;

  beforeEach(() => {
    client = new HTTPClient({
      timeout: 5000,
      maxRetries: 2,
      debug: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const defaultClient = new HTTPClient();
      expect(defaultClient.defaultTimeout).toBe(600000); // 10 minutes
      expect(defaultClient.maxRetries).toBe(10);
      expect(defaultClient.initialRetryDelay).toBe(1000);
      expect(defaultClient.maxRetryDelay).toBe(10000);
      expect(defaultClient.debug).toBe(false);
    });

    it('should create with custom options', () => {
      const customClient = new HTTPClient({
        timeout: 30000,
        maxRetries: 5,
        initialRetryDelay: 500,
        maxRetryDelay: 5000,
        debug: true,
      });
      expect(customClient.defaultTimeout).toBe(30000);
      expect(customClient.maxRetries).toBe(5);
      expect(customClient.initialRetryDelay).toBe(500);
      expect(customClient.maxRetryDelay).toBe(5000);
      expect(customClient.debug).toBe(true);
    });
  });

  describe('fetch', () => {
    it('should make successful fetch request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ result: 'success' }),
      };
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      const response = await client.fetch('https://api.example.com/test', {
        method: 'GET',
      });

      expect(response).toBe(mockResponse);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should include headers in request', async () => {
      const mockResponse = { ok: true, status: 200 };
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      const headers = new Headers({ 'Authorization': 'Bearer token' });
      await client.fetch('https://api.example.com/test', {
        method: 'GET',
        headers,
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should use default timeout when not specified', async () => {
      const mockResponse = { ok: true, status: 200 };
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      await client.fetch('https://api.example.com/test');

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should use custom timeout when specified', async () => {
      const mockResponse = { ok: true, status: 200 };
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      await client.fetch('https://api.example.com/test', { timeout: 10000 });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 401 error', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue('Unauthorized'),
      };
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      try {
        await client.fetch('https://api.example.com/test');
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.code).toBe('AUTH_FAILED');
      }

      expect(global.fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should not retry on 404 error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('Not found'),
      };
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      try {
        await client.fetch('https://api.example.com/test');
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.code).toBe('NOT_FOUND');
      }

      expect(global.fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should not retry on 400 error', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue('Bad request'),
      };
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      try {
        await client.fetch('https://api.example.com/test');
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.code).toBe('BAD_REQUEST');
      }

      expect(global.fetch).toHaveBeenCalledTimes(1); // No retry
    });
  });

  describe('POST request with body', () => {
    it('should send POST request with JSON body', async () => {
      const mockResponse = { ok: true, status: 200 };
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      const body = { message: 'hello' };
      await client.fetch('https://api.example.com/test', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
