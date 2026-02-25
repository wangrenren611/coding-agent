import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTPClient } from './client';
import { LLMRetryableError, LLMAbortedError } from '../types';

describe('HTTPClient timeout behavior', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should handle external timeout signal from upstream (Agent layer controls timeout)', async () => {
        const timeoutMs = 80;
        const simulatedSlowFetchMs = 1000;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
        });

        const client = new HTTPClient({ timeout: 10000 }); // 客户端默认超时 10 秒，但不会使用

        // 模拟 Agent 层创建的超时信号
        const timeoutSignal = AbortSignal.timeout(timeoutMs);

        const startedAt = Date.now();
        const error = await client
            .fetch('https://example.test/slow', {
                signal: timeoutSignal,
            })
            .then(
                () => null,
                (err) => err
            );
        const elapsedMs = Date.now() - startedAt;

        // HTTPClient 应该正确处理外部超时信号
        expect(error).toBeInstanceOf(LLMRetryableError);
        expect((error as LLMRetryableError).code).toBe('TIMEOUT');
        expect(elapsedMs).toBeGreaterThanOrEqual(40);
        expect(elapsedMs).toBeLessThan(simulatedSlowFetchMs);
    });

    it('should handle user abort signal (not timeout)', async () => {
        const simulatedSlowFetchMs = 1000;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
        });

        const client = new HTTPClient({ timeout: 10000 });
        const abortController = new AbortController();

        // 在 50ms 后中止（用户主动取消，不是超时）
        setTimeout(() => abortController.abort(), 50);

        const error = await client
            .fetch('https://example.test/slow', {
                signal: abortController.signal,
            })
            .then(
                () => null,
                (err) => err
            );

        // 用户中止应该返回 AbortedError，而不是 TimeoutError
        expect(error).toBeInstanceOf(LLMAbortedError);
    });

    it('should pass through LLMError from upstream', async () => {
        const llmError = new LLMRetryableError('Custom error', 1000, 'CUSTOM');

        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            throw llmError;
        });

        const client = new HTTPClient({ timeout: 10000 });

        const error = await client.fetch('https://example.test/error').then(
            () => null,
            (err) => err
        );

        // LLMError 应该直接传递
        expect(error).toBe(llmError);
    });

    it('should work without any signal (no timeout at HTTP layer)', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify({ data: 'ok' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        const client = new HTTPClient({ timeout: 10000 });

        const response = await client.fetch('https://example.test/ok');

        expect(response.ok).toBe(true);
    });
});
