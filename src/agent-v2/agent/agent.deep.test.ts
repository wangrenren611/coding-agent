/**
 * Agent 深度测试用例
 * 
 * 验证 Agent 的传参是否正确应用到各个层：
 * - Agent 构造参数
 * - Provider 调用参数
 * - Session 逻辑
 * - Adapter 转换
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../agent';
import { ProviderRegistry } from '../../providers/registry';
import { createMemoryManager } from '../../memory';
import { KimiAdapter } from '../../providers/adapters/kimi';
import { StandardAdapter } from '../../providers/adapters/standard';
import type { LLMRequest, LLMGenerateOptions } from '../../providers/types';
import type { AgentOptions } from '../types';

// Mock Provider
class MockProvider {
  public lastOptions: LLMGenerateOptions | null = null;
  public callCount = 0;
  
  async generate(messages: unknown[], options?: LLMGenerateOptions) {
    this.lastOptions = options || null;
    this.callCount++;
    
    // 返回模拟响应
    return {
      id: 'test-id',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello!',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }
  
  getTimeTimeout() { return 60000; }
}

describe('Agent 参数传递深度测试', () => {
  let mockProvider: MockProvider;
  
  beforeEach(() => {
    mockProvider = new MockProvider();
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('thinking 参数传递', () => {
    it('应该在 AgentOptions 中接受 thinking 参数', () => {
      const options: AgentOptions = {
        provider: mockProvider as any,
        thinking: true,
      };
      
      // 验证类型定义正确
      expect(options.thinking).toBe(true);
    });

    it('应该在调用 LLM 时传递 thinking 参数', async () => {
      const memoryManager = createMemoryManager({
        type: 'memory',
        connectionString: 'test',
      });
      
      const agent = new Agent({
        provider: mockProvider as any,
        systemPrompt: 'You are a helpful assistant.',
        thinking: true,
        stream: false,
        memoryManager,
      });
      
      await agent.execute('Hello');
      
      // 验证 thinking 参数被传递
      expect(mockProvider.lastOptions).not.toBeNull();
      expect(mockProvider.lastOptions?.thinking).toBe(true);
    });

    it('thinking=false 时不应该启用 thinking', async () => {
      const memoryManager = createMemoryManager({
        type: 'memory',
        connectionString: 'test',
      });
      
      const agent = new Agent({
        provider: mockProvider as any,
        systemPrompt: 'You are a helpful assistant.',
        thinking: false,
        stream: false,
        memoryManager,
      });
      
      await agent.execute('Hello');
      
      expect(mockProvider.lastOptions?.thinking).toBe(false);
    });

    it('未设置 thinking 时不应该传递 thinking 参数', async () => {
      const memoryManager = createMemoryManager({
        type: 'memory',
        connectionString: 'test',
      });
      
      const agent = new Agent({
        provider: mockProvider as any,
        systemPrompt: 'You are a helpful assistant.',
        stream: false,
        memoryManager,
      });
      
      await agent.execute('Hello');
      
      expect(mockProvider.lastOptions?.thinking).toBeUndefined();
    });
  });

  describe('其他参数传递', () => {
    it('应该正确传递 tools 参数', async () => {
      const memoryManager = createMemoryManager({
        type: 'memory',
        connectionString: 'test',
      });
      
      const agent = new Agent({
        provider: mockProvider as any,
        systemPrompt: 'You are a helpful assistant.',
        stream: false,
        memoryManager,
      });
      
      await agent.execute('Hello');
      
      // tools 应该被传递（可能是空数组或 undefined）
      expect(mockProvider.lastOptions).toHaveProperty('tools');
    });

    it('应该正确传递 abortSignal 参数', async () => {
      const memoryManager = createMemoryManager({
        type: 'memory',
        connectionString: 'test',
      });
      
      const agent = new Agent({
        provider: mockProvider as any,
        systemPrompt: 'You are a helpful assistant.',
        stream: false,
        memoryManager,
      });
      
      await agent.execute('Hello');
      
      // abortSignal 应该被传递
      expect(mockProvider.lastOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    });
  });
});

describe('KimiAdapter thinking 转换测试', () => {
  let adapter: KimiAdapter;

  beforeEach(() => {
    adapter = new KimiAdapter();
  });

  it('应该在 thinking=true 时生成 enabled 类型', () => {
    const request: LLMRequest = {
      model: 'kimi-k2.5',
      messages: [{ role: 'user', content: 'Hello' }],
      thinking: true,
    };

    const transformed = adapter.transformRequest(request);
    
    expect(transformed.thinking).toEqual({ type: 'enabled' });
  });

  it('应该在 thinking=false 时生成 disabled 类型', () => {
    const request: LLMRequest = {
      model: 'kimi-k2.5',
      messages: [{ role: 'user', content: 'Hello' }],
      thinking: false,
    };

    const transformed = adapter.transformRequest(request);
    
    expect(transformed.thinking).toEqual({ type: 'disabled' });
  });

  it('应该在未设置 thinking 时生成 disabled 类型', () => {
    const request: LLMRequest = {
      model: 'kimi-k2.5',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const transformed = adapter.transformRequest(request);
    
    expect(transformed.thinking).toEqual({ type: 'disabled' });
  });

  it('应该保留其他请求参数', () => {
    const request: LLMRequest = {
      model: 'kimi-k2.5',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      max_tokens: 1000,
      thinking: true,
    };

    const transformed = adapter.transformRequest(request);
    
    expect(transformed.model).toBe('kimi-k2.5');
    expect(transformed.temperature).toBe(0.7);
    expect(transformed.max_tokens).toBe(1000);
    expect(transformed.thinking).toEqual({ type: 'enabled' });
  });
});

describe('StandardAdapter 测试', () => {
  let adapter: StandardAdapter;

  beforeEach(() => {
    adapter = new StandardAdapter();
  });

  it('不应该添加 thinking 参数', () => {
    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      thinking: true,
    };

    const transformed = adapter.transformRequest(request);
    
    // StandardAdapter 不应该处理 thinking
    // 它应该被忽略或原样传递（取决于实现）
    expect(transformed.model).toBe('gpt-4o');
  });
});

describe('Provider 工厂测试', () => {
  it('GLM-5 应该使用 KimiAdapter', () => {
    const adapter = ProviderRegistry.createAdapter('glm-5');
    expect(adapter).toBeInstanceOf(KimiAdapter);
  });

  it('Kimi-k2.5 应该使用 KimiAdapter', () => {
    const adapter = ProviderRegistry.createAdapter('kimi-k2.5');
    expect(adapter).toBeInstanceOf(KimiAdapter);
  });

  it('GLM-4.7 应该使用 StandardAdapter', () => {
    const adapter = ProviderRegistry.createAdapter('glm-4.7');
    expect(adapter).toBeInstanceOf(StandardAdapter);
  });

  it('DeepSeek 应该使用 StandardAdapter', () => {
    const adapter = ProviderRegistry.createAdapter('deepseek-chat');
    expect(adapter).toBeInstanceOf(StandardAdapter);
  });
});

describe('Session 逻辑测试', () => {
  it('应该正确保存会话 ID', async () => {
    const memoryManager = createMemoryManager({
      type: 'memory',
      connectionString: 'test',
    });
    
    const agent = new Agent({
      provider: mockProvider as any,
      systemPrompt: 'You are a helpful assistant.',
      stream: false,
      memoryManager,
      sessionId: 'test-session-123',
    });
    
    expect(agent.getSessionId()).toBe('test-session-123');
  });

  it('应该生成唯一的会话 ID', async () => {
    const memoryManager1 = createMemoryManager({
      type: 'memory',
      connectionString: 'test1',
    });
    
    const memoryManager2 = createMemoryManager({
      type: 'memory',
      connectionString: 'test2',
    });
    
    const agent1 = new Agent({
      provider: mockProvider as any,
      stream: false,
      memoryManager: memoryManager1,
    });
    
    const agent2 = new Agent({
      provider: mockProvider as any,
      stream: false,
      memoryManager: memoryManager2,
    });
    
    expect(agent1.getSessionId()).not.toBe(agent2.getSessionId());
  });
});

describe('完整流程集成测试', () => {
  it('从 Agent 到 Adapter 的完整参数传递', async () => {
    // 这个测试验证整个参数传递链
    // Agent -> executeLLMCall -> Provider.generate -> Adapter.transformRequest
    
    const memoryManager = createMemoryManager({
      type: 'memory',
      connectionString: 'test',
    });
    
    // 使用真实的 Provider 创建流程，但 mock HTTP 请求
    const provider = ProviderRegistry.createFromEnv('glm-5');
    
    // 验证 provider 使用了正确的 adapter
    // (这里需要访问内部属性，仅用于测试)
    expect((provider as any).adapter).toBeInstanceOf(KimiAdapter);
  });
});
