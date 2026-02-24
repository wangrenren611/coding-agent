import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTPClient } from './client';
import { LLMRetryableError } from '../types';

describe('HTTPClient timeout behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should abort around configured timeout and throw TIMEOUT retryable error', async () => {
    const timeoutMs = 80;
    const simulatedSlowFetchMs = 1000;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, simulatedSlowFetchMs);
          if (signal) {
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }

            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          }
        });
        throw new Error('should not reach successful fetch path');
      }
    );

    const client = new HTTPClient({ timeout: timeoutMs });

    const startedAt = Date.now();
    const error = await client.fetch('https://example.test/slow').then(
      () => null,
      (err) => err
    );
    const elapsedMs = Date.now() - startedAt;

    expect(error).toBeInstanceOf(LLMRetryableError);
    expect((error as LLMRetryableError).code).toBe('TIMEOUT');
    expect(elapsedMs).toBeGreaterThanOrEqual(40);
    expect(elapsedMs).toBeLessThan(simulatedSlowFetchMs);
  });
});
