/**
 * Agent Plan Mode 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../agent';
import type { LLMGenerateOptions, LLMResponse } from '../../../providers/types';

// ==================== Mock Provider ====================

class MockProvider {
    public callCount = 0;

    async generate(messages: unknown[], options?: LLMGenerateOptions) {
        this.callCount++;
        const response: LLMResponse = {
            messages: [{
                messageId: 'msg-1',
                role: 'assistant',
                content: 'Hello',
            }],
            usage: { inputTokens: 10, outputTokens: 5 },
            finishReason: 'stop',
        };
        return response;
    }

    generateStream = async function* (): AsyncGenerator<unknown> {
        yield { type: 'text', content: 'Hello' };
    };

    getLLMMaxTokens() {
        return 128000;
    }

    getMaxOutputTokens() {
        return 4096;
    }

    getTimeTimeout() {
        return 300000;
    }
}

// ==================== 测试 ====================

describe('Agent Plan Mode', () => {
    let provider: MockProvider;

    beforeEach(() => {
        provider = new MockProvider();
    });

    describe('buildSystemPrompt', () => {
        it('应该在 planMode=true 时添加 Plan Mode 指令', () => {
            const basePrompt = 'You are a helpful assistant.';
            
            const agent = new Agent({
                provider: provider as any,
                systemPrompt: basePrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');
            
            expect(systemMessage).toBeDefined();
            expect(systemMessage?.content).toContain('You are a helpful assistant.');
            expect(systemMessage?.content).toContain('Plan Mode');
        });

        it('应该在 planMode=false 时不添加 Plan Mode 指令', () => {
            const basePrompt = 'You are a helpful assistant.';
            
            const agent = new Agent({
                provider: provider as any,
                systemPrompt: basePrompt,
                planMode: false,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');
            
            expect(systemMessage).toBeDefined();
            expect(systemMessage?.content).toBe(basePrompt);
            expect(systemMessage?.content).not.toContain('Plan Mode');
        });

        it('应该在未设置 planMode 时不添加 Plan Mode 指令', () => {
            const basePrompt = 'You are a helpful assistant.';
            
            const agent = new Agent({
                provider: provider as any,
                systemPrompt: basePrompt,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');
            
            expect(systemMessage).toBeDefined();
            expect(systemMessage?.content).toBe(basePrompt);
        });

        it('Plan Mode 指令应该强调必须创建计划', () => {
            const basePrompt = 'You are a helpful assistant.';
            
            const agent = new Agent({
                provider: provider as any,
                systemPrompt: basePrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');
            
            // 检查关键指令
            expect(systemMessage?.content).toContain('MUST');
            expect(systemMessage?.content).toContain('plan_create');
            expect(systemMessage?.content).toContain('CANNOT');
        });

        it('Plan Mode 指令应该包含禁止的工具', () => {
            const basePrompt = 'You are a helpful assistant.';
            
            const agent = new Agent({
                provider: provider as any,
                systemPrompt: basePrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');
            
            expect(systemMessage?.content).toContain('write_file');
            expect(systemMessage?.content).toContain('FORBIDDEN');
        });

        it('Plan Mode 指令应该包含 plan_create 使用示例', () => {
            const basePrompt = 'You are a helpful assistant.';
            
            const agent = new Agent({
                provider: provider as any,
                systemPrompt: basePrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');
            
            expect(systemMessage?.content).toContain('plan_create');
            expect(systemMessage?.content).toContain('Implementation Steps');
        });
    });
});
