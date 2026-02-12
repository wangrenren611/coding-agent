/**
 * Agent 参数传递验证脚本
 */

import { Agent } from './src/agent-v2/agent/agent.js';
import { ProviderFactory } from './src/providers/registry/provider-factory.js';
import { createMemoryManager } from './src/agent-v2/memory/index.js';
import { KimiAdapter } from './src/providers/adapters/kimi.js';
import { StandardAdapter } from './src/providers/adapters/standard.js';

console.log('='.repeat(60));
console.log('Agent 参数传递验证测试');
console.log('='.repeat(60));

// 测试 1: 验证 Adapter 类型
console.log('\n📋 测试 1: Adapter 类型验证');
console.log('-'.repeat(40));

const glm5Adapter = ProviderFactory.createAdapter('glm-5');
const kimiAdapter = ProviderFactory.createAdapter('kimi-k2.5');
const glm47Adapter = ProviderFactory.createAdapter('glm-4.7');

console.log(`GLM-5 Adapter: ${glm5Adapter.constructor.name}`);
console.log(`  ✓ 是否为 KimiAdapter: ${glm5Adapter instanceof KimiAdapter}`);

console.log(`Kimi-k2.5 Adapter: ${kimiAdapter.constructor.name}`);
console.log(`  ✓ 是否为 KimiAdapter: ${kimiAdapter instanceof KimiAdapter}`);

console.log(`GLM-4.7 Adapter: ${glm47Adapter.constructor.name}`);
console.log(`  ✓ 是否为 StandardAdapter: ${glm47Adapter instanceof StandardAdapter}`);

// 测试 2: KimiAdapter thinking 转换
console.log('\n📋 测试 2: KimiAdapter thinking 转换');
console.log('-'.repeat(40));

const adapter = new KimiAdapter();

const requestWithThinking = { model: 'test', messages: [], thinking: true };
const transformed1 = adapter.transformRequest(requestWithThinking as any);
console.log(`thinking=true 时:`);
console.log(`  结果: ${JSON.stringify(transformed1.thinking)}`);
console.log(`  ✓ 期望 { type: 'enabled' }: ${JSON.stringify(transformed1.thinking) === JSON.stringify({ type: 'enabled' })}`);

const requestWithoutThinking = { model: 'test', messages: [], thinking: false };
const transformed2 = adapter.transformRequest(requestWithoutThinking as any);
console.log(`thinking=false 时:`);
console.log(`  结果: ${JSON.stringify(transformed2.thinking)}`);
console.log(`  ✓ 期望 { type: 'disabled' }: ${JSON.stringify(transformed2.thinking) === JSON.stringify({ type: 'disabled' })}`);

const requestNoThinking = { model: 'test', messages: [] };
const transformed3 = adapter.transformRequest(requestNoThinking as any);
console.log(`无 thinking 参数时:`);
console.log(`  结果: ${JSON.stringify(transformed3.thinking)}`);
console.log(`  ✓ 期望 { type: 'disabled' }: ${JSON.stringify(transformed3.thinking) === JSON.stringify({ type: 'disabled' })}`);

// 测试 3: Agent thinking 参数传递 (不需要 memory manager)
console.log('\n📋 测试 3: Agent thinking 参数传递');
console.log('-'.repeat(40));

// 创建一个简单的 Mock Provider 来捕获参数
class MockProvider {
  lastOptions: any = null;
  
  async generate(messages: any[], options?: any) {
    this.lastOptions = options;
    return {
      id: 'test-id',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }
  
  getTimeTimeout() { return 60000; }
}

async function testThinkingPassing() {
  const memoryManager = createMemoryManager({
    type: 'file',
    connectionString: './data/test-session',
  });
  
  await memoryManager.initialize();
  
  const mockProvider = new MockProvider();
  
  // 测试 thinking: true
  const agent1 = new Agent({
    provider: mockProvider as any,
    systemPrompt: 'Test',
    thinking: true,
    stream: false,
    memoryManager,
  });
  
  await agent1.execute('Hello');
  console.log(`Agent thinking=true:`);
  console.log(`  Provider 收到的 thinking: ${mockProvider.lastOptions?.thinking}`);
  console.log(`  ✓ thinking 是否为 true: ${mockProvider.lastOptions?.thinking === true}`);
  
  // 测试 thinking: false
  mockProvider.lastOptions = null;
  const agent2 = new Agent({
    provider: mockProvider as any,
    systemPrompt: 'Test',
    thinking: false,
    stream: false,
    memoryManager,
  });
  
  await agent2.execute('Hello');
  console.log(`Agent thinking=false:`);
  console.log(`  Provider 收到的 thinking: ${mockProvider.lastOptions?.thinking}`);
  console.log(`  ✓ thinking 是否为 false: ${mockProvider.lastOptions?.thinking === false}`);
  
  // 测试无 thinking
  mockProvider.lastOptions = null;
  const agent3 = new Agent({
    provider: mockProvider as any,
    systemPrompt: 'Test',
    stream: false,
    memoryManager,
  });
  
  await agent3.execute('Hello');
  console.log(`Agent 无 thinking:`);
  console.log(`  Provider 收到的 thinking: ${mockProvider.lastOptions?.thinking}`);
  console.log(`  ✓ thinking 是否为 undefined: ${mockProvider.lastOptions?.thinking === undefined}`);
}

await testThinkingPassing();

// 测试 4: 完整链路测试
console.log('\n📋 测试 4: 完整链路测试');
console.log('-'.repeat(40));

try {
  const kimiProvider = ProviderFactory.createFromEnv('kimi-k2.5');
  const adapterType = (kimiProvider as any).adapter?.constructor?.name;
  console.log(`Kimi Provider 的 Adapter 类型: ${adapterType}`);
  console.log(`  ✓ 正确: ${adapterType === 'KimiAdapter'}`);
  
  const glm5Provider = ProviderFactory.createFromEnv('glm-5');
  const glm5AdapterType = (glm5Provider as any).adapter?.constructor?.name;
  console.log(`GLM-5 Provider 的 Adapter 类型: ${glm5AdapterType}`);
  console.log(`  ✓ 正确: ${glm5AdapterType === 'KimiAdapter'}`);
  
  const glm47Provider = ProviderFactory.createFromEnv('glm-4.7');
  const glm47AdapterType = (glm47Provider as any).adapter?.constructor?.name;
  console.log(`GLM-4.7 Provider 的 Adapter 类型: ${glm47AdapterType}`);
  console.log(`  ✓ 正确: ${glm47AdapterType === 'StandardAdapter'}`);
} catch (e: any) {
  console.log(`  跳过 (需要环境变量): ${e.message}`);
}

// 总结
console.log('\n' + '='.repeat(60));
console.log('✅ 测试完成');
console.log('='.repeat(60));
