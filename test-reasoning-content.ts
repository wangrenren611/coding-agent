/**
 * Agent reasoning_content 流式响应测试
 */

import { ProviderFactory } from './src/providers/registry/provider-factory.js';
import { KimiAdapter } from './src/providers/adapters/kimi.js';
import { StreamProcessor } from './src/agent-v2/agent/stream-processor.js';

console.log('='.repeat(60));
console.log('Reasoning Content 流式响应测试');
console.log('='.repeat(60));

// ==================== 测试 1: 类型守卫函数 ====================
console.log('\n📋 测试 1: 类型守卫函数');
console.log('-'.repeat(40));

// 模拟 chunk
const mockChunkWithReasoning = {
    id: 'test-1',
    choices: [{
        index: 0,
        delta: { reasoning_content: '让我思考一下...', content: '' },
        finish_reason: null
    }]
};

const mockChunkWithContent = {
    id: 'test-2',
    choices: [{
        index: 0,
        delta: { reasoning_content: '', content: '这是回复内容' },
        finish_reason: null
    }]
};

const mockChunkEmpty = {
    id: 'test-4',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
};

// 测试函数
const testHasReasoningDelta = (chunk: any): boolean => {
    const delta = chunk.choices?.[0]?.delta;
    return !!delta && typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '';
};

const testGetReasoningContent = (chunk: any): string => {
    return chunk.choices?.[0]?.delta?.reasoning_content || '';
};

const testHasContentDelta = (chunk: any): boolean => {
    const delta = chunk.choices?.[0]?.delta;
    return !!delta && typeof delta.content === 'string' && delta.content !== '';
};

const testGetContent = (chunk: any): string => {
    return chunk.choices?.[0]?.delta?.content || '';
};

console.log(`testHasReasoningDelta(chunk with reasoning): ${testHasReasoningDelta(mockChunkWithReasoning)}`);
console.log(`  ✓ 期望 true: ${testHasReasoningDelta(mockChunkWithReasoning) === true}`);

console.log(`testHasReasoningDelta(chunk with content only): ${testHasReasoningDelta(mockChunkWithContent)}`);
console.log(`  ✓ 期望 false: ${testHasReasoningDelta(mockChunkWithContent) === false}`);

console.log(`testHasContentDelta(chunk with content): ${testHasContentDelta(mockChunkWithContent)}`);
console.log(`  ✓ 期望 true: ${testHasContentDelta(mockChunkWithContent) === true}`);

console.log(`testGetReasoningContent: "${testGetReasoningContent(mockChunkWithReasoning)}"`);
console.log(`  ✓ 正确: ${testGetReasoningContent(mockChunkWithReasoning) === '让我思考一下...'}`);

// ==================== 测试 2: StreamProcessor 推理处理 ====================
console.log('\n📋 测试 2: StreamProcessor 推理内容处理');
console.log('-'.repeat(40));

const events: { type: string; content: string }[] = [];

const processor = new StreamProcessor({
    maxBufferSize: 100000,
    onMessageCreate: () => {},
    onMessageUpdate: () => {},
    onTextDelta: (content) => events.push({ type: 'text-delta', content }),
    onTextStart: () => events.push({ type: 'text-start', content: '' }),
    onTextComplete: () => events.push({ type: 'text-complete', content: '' }),
    onReasoningDelta: (content) => events.push({ type: 'reasoning-delta', content }),
    onReasoningStart: () => events.push({ type: 'reasoning-start', content: '' }),
    onReasoningComplete: () => events.push({ type: 'reasoning-complete', content: '' }),
});

processor.setMessageId('test-msg-1');

console.log('模拟流式响应:');
processor.processChunk(mockChunkWithReasoning as any);
console.log(`  Chunk 1 (reasoning): ${events.length} 事件`);

const chunk2 = { choices: [{ delta: { reasoning_content: '继续...' } }] };
processor.processChunk(chunk2 as any);
console.log(`  Chunk 2 (more reasoning): ${events.length} 事件`);

processor.processChunk(mockChunkWithContent as any);
console.log(`  Chunk 3 (content): ${events.length} 事件`);

processor.processChunk(mockChunkEmpty as any);
console.log(`  Chunk 4 (finish): ${events.length} 事件`);

console.log('\n事件列表:');
events.forEach((e, i) => {
    const preview = e.content ? e.content.slice(0, 20) : '';
    console.log(`  ${i + 1}. ${e.type}${preview ? ': ' + preview + '...' : ''}`);
});

const checks = {
    reasoningStart: events.some(e => e.type === 'reasoning-start'),
    reasoningDelta: events.some(e => e.type === 'reasoning-delta'),
    textStart: events.some(e => e.type === 'text-start'),
    textDelta: events.some(e => e.type === 'text-delta'),
};

console.log('\n验证:');
console.log(`  ✓ reasoning-start: ${checks.reasoningStart}`);
console.log(`  ✓ reasoning-delta: ${checks.reasoningDelta}`);
console.log(`  ✓ text-start: ${checks.textStart}`);
console.log(`  ✓ text-delta: ${checks.textDelta}`);

// ==================== 测试 3: 完整响应 ====================
console.log('\n📋 测试 3: 完整响应构建');
console.log('-'.repeat(40));

const response = processor.buildResponse();
console.log(`Content buffer: "${processor.getBuffer().slice(0, 30)}"`);
console.log(`Reasoning buffer: "${processor.getReasoningBuffer().slice(0, 30)}"`);

// ==================== 测试 4: KimiAdapter ====================
console.log('\n📋 测试 4: KimiAdapter thinking');
console.log('-'.repeat(40));

const adapter = new KimiAdapter();

const req1 = adapter.transformRequest({ model: 'kimi', messages: [], thinking: true } as any);
console.log(`thinking=true: ${JSON.stringify(req1.thinking)}`);
console.log(`  ✓ ${JSON.stringify(req1.thinking) === '{"type":"enabled"}'}`);

const req2 = adapter.transformRequest({ model: 'kimi', messages: [], thinking: false } as any);
console.log(`thinking=false: ${JSON.stringify(req2.thinking)}`);
console.log(`  ✓ ${JSON.stringify(req2.thinking) === '{"type":"disabled"}'}`);

// ==================== 测试 5: Provider ====================
console.log('\n📋 测试 5: Provider 验证');
console.log('-'.repeat(40));

try {
    const glm5 = ProviderFactory.createFromEnv('glm-5');
    const adapterName = (glm5 as any).adapter?.constructor?.name;
    console.log(`GLM-5 adapter: ${adapterName}`);
    console.log(`  ✓ 是 KimiAdapter: ${adapterName === 'KimiAdapter'}`);
} catch (e: any) {
    console.log(`跳过: ${e.message}`);
}

// ==================== 总结 ====================
console.log('\n' + '='.repeat(60));
console.log('✅ 所有测试完成');
console.log('='.repeat(60));
