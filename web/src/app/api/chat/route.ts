/**
 * Chat API Route
 *
 * Integrates with agent-v2 to provide streaming chat responses
 */

import { NextRequest } from 'next/server';
import { Agent } from 'agent-v2';
import { ProviderRegistry } from 'providers';
import { StreamAdapter } from 'cli-v2/agent/stream-adapter';
import type { UIEvent } from 'cli-v2/state/types';

// Agent 实例缓存（生产环境应使用更复杂的会话管理）
interface CachedAgent {
  agent: Agent;
  streamAdapter: StreamAdapter;
}

const agentCache = new Map<string, CachedAgent>();

/**
 * 创建或获取 Agent 实例
 */
function getOrCreateAgent(sessionId: string, eventHandler: (event: UIEvent) => void): CachedAgent {
  if (agentCache.has(sessionId)) {
    return agentCache.get(sessionId)!;
  }

  // 从环境变量创建 Provider
  const provider = ProviderRegistry.createFromEnv('glm-4.7', {
    temperature: 0.7,
  });

  // 创建 StreamAdapter 来转换消息
  const streamAdapter = new StreamAdapter(
    eventHandler,
    33 // 刷新间隔（毫秒）
  );

  // 创建 Agent 实例，传入流式回调
  const agent = new Agent({
    provider,
    systemPrompt: '你是一个智能助手，可以帮助用户完成各种任务。',
    stream: true,
    streamCallback: (agentMessage) => {
      streamAdapter.handleAgentMessage(agentMessage);
    },
    maxRetries: 10,
  });

  const cached = { agent, streamAdapter };
  agentCache.set(sessionId, cached);
  return cached;
}

/**
 * POST /api/chat
 *
 * 处理聊天请求并返回流式响应
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId = 'default' } = body;

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 创建流式响应
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 创建事件处理器
          const eventHandler = (event: UIEvent) => {
            // 发送 SSE 格式的事件
            const data = JSON.stringify(event);
            controller.enqueue(`data: ${data}\n\n`);
          };

          // 获取或创建 Agent 实例
          const { agent } = getOrCreateAgent(sessionId, eventHandler);

          // 执行 Agent 查询
          await agent.execute(message);

          // 发送完成事件
          controller.enqueue(`data: ${JSON.stringify({ type: 'done' })}\n\n`);

        } catch (error) {
          // 发送错误事件
          const errorEvent: UIEvent = {
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          };
          controller.enqueue(`data: ${JSON.stringify(errorEvent)}\n\n`);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * DELETE /api/chat
 *
 * 清除指定会话的 Agent 实例
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId = 'default' } = body;

    agentCache.delete(sessionId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to clear session',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
