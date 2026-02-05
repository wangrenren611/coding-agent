/**
 * Agent API Client Hook
 *
 * Handles communication with the agent API
 */

import { useCallback, useRef } from 'react';
import type { UIEvent } from '@/lib/types';

interface UseAgentApiOptions {
  onEvent?: (event: UIEvent) => void;
  onError?: (error: string) => void;
  onComplete?: () => void;
}

export function useAgentApi(options?: UseAgentApiOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (message: string, sessionId?: string) => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 创建新的 AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          sessionId: sessionId || 'default',
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          options?.onComplete?.();
          break;
        }

        // 解码收到的数据
        buffer += decoder.decode(value, { stream: true });

        // 处理 SSE 格式的事件
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event = JSON.parse(data) as UIEvent;

              if (event.type === 'done') {
                options?.onComplete?.();
                break;
              }

              options?.onEvent?.(event);
            } catch (error) {
              console.error('Failed to parse event:', data, error);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request aborted');
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      options?.onError?.(errorMessage);
    } finally {
      abortControllerRef.current = null;
    }
  }, [options]);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const clearSession = useCallback(async (sessionId = 'default') => {
    try {
      await fetch('/api/chat', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  }, []);

  return {
    sendMessage,
    abort,
    clearSession,
  };
}
