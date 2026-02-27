/**
 * Agent Plan Mode 测试
 *
 * 测试 Plan Mode 的提示词构建功能
 * 注意：Plan Mode 指令现在由 operatorPrompt 处理，不再由 Agent 内部处理
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../agent';
import { operatorPrompt } from '../../prompts/operator';
import type { LLMGenerateOptions, LLMResponse, LLMProvider } from '../../../providers/types';

// ==================== Mock Provider ====================

class MockProvider {
    public callCount = 0;

    async generate(_messages: unknown[], _options?: LLMGenerateOptions) {
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

    describe('operatorPrompt Plan Mode', () => {
        it('应该在 planMode=true 时添加 Plan Mode 指令', () => {
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                planMode: true,
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');

            expect(systemMessage).toBeDefined();
            expect(systemMessage?.content).toContain('Plan Mode');
        });

        it('应该在 planMode=false 时不添加 Plan Mode 指令', () => {
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                planMode: false,
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
                planMode: false,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');

            expect(systemMessage).toBeDefined();
            expect(systemMessage?.content).not.toContain('Plan Mode');
        });

        it('应该在未设置 planMode 时不添加 Plan Mode 指令', () => {
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                // planMode 默认为 false
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');

            expect(systemMessage).toBeDefined();
            expect(systemMessage?.content).not.toContain('Plan Mode');
        });

        it('Plan Mode 指令应该强调必须创建计划', () => {
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                planMode: true,
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');

            // 检查关键指令
            expect(systemMessage?.content).toContain('MUST');
            expect(systemMessage?.content).toContain('plan_create');
        });

        it('Plan Mode 指令应该包含禁止的工具', () => {
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                planMode: true,
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');

            expect(systemMessage?.content).toContain('write_file');
            expect(systemMessage?.content).toContain('FORBIDDEN');
        });

        it('Plan Mode 指令应该包含 plan_create 使用示例', () => {
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                planMode: true,
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find(m => m.role === 'system');

            expect(systemMessage?.content).toContain('plan_create');
            expect(systemMessage?.content).toContain('Implementation Steps');
        });
    });
});
