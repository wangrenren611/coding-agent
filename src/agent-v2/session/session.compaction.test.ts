import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Session } from './index';
import { createMemoryManager } from '../memory';
import type { IMemoryManager } from '../memory';
import type { Message } from './types';
import {
    LLMProvider,
    type Chunk,
    type LLMGenerateOptions,
    type LLMRequestMessage,
    type LLMResponse,
    type Usage,
} from '../../providers';

interface ToolCallShape {
    id: string;
    type: string;
    index: number;
    function: { name: string; arguments: string };
}

/**
 * Mock Provider 用于测试压缩
 */
class MockSummaryProvider extends LLMProvider {
    public generateCallCount = 0;
    public lastSummaryInput = '';
    public lastOptions?: LLMGenerateOptions;

    constructor() {
        super({
            apiKey: 'mock',
            baseURL: 'https://mock.local',
            model: 'mock-model',
            max_tokens: 200,
            LLMMAX_TOKENS: 600,
            temperature: 0,
        });
    }

    generate(
        _messages: LLMRequestMessage[],
        _options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
        this.generateCallCount++;
        this.lastOptions = _options;
        const first = _messages[0];
        this.lastSummaryInput = typeof first?.content === 'string' ? first.content : JSON.stringify(first?.content);
        return Promise.resolve({
            id: `summary-${this.generateCallCount}`,
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'Summary: conversation compressed with key decisions and pending tasks.',
                    },
                    finish_reason: 'stop',
                },
            ],
        });
    }

    getTimeTimeout(): number {
        return 30000;
    }
    getLLMMaxTokens(): number {
        return 600;
    }
    getMaxOutputTokens(): number {
        return 200;
    }
}

/**
 * 创建合理的 usage 值
 * prompt_tokens 表示当前请求的完整上下文大小（包含 system prompt 和所有历史消息）
 * 最后一条消息的 prompt_tokens 应该是最大的
 */
function createRealisticUsage(promptTokens: number, completionTokens: number): Usage {
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        prompt_cache_miss_tokens: promptTokens,
        prompt_cache_hit_tokens: 0,
    };
}

function seedSession(session: Session, toolCallId = 'call-search-1'): void {
    session.addMessage({
        messageId: 'user-old-1',
        role: 'user',
        content: `需求背景：${'A'.repeat(800)}`,
        type: 'text',
    });

    session.addMessage({
        messageId: 'assistant-tool-1',
        role: 'assistant',
        content: '我将调用工具搜索项目结构。',
        type: 'tool-call',
        tool_calls: [
            {
                id: toolCallId,
                type: 'function',
                index: 0,
                function: { name: 'grep', arguments: JSON.stringify({ pattern: 'agent-v2' }) },
            },
        ],
        finish_reason: 'tool_calls',
        // prompt_tokens ≈ 220（system prompt + user-old-1 ≈ 10 + 210）
        usage: createRealisticUsage(220, 10),
    });

    session.addMessage({
        messageId: 'tool-result-1',
        role: 'tool',
        content: JSON.stringify({ success: true, files: ['src/agent-v2/agent/agent.ts'] }),
        type: 'tool-result',
        tool_call_id: toolCallId,
    });

    session.addMessage({
        messageId: 'user-recent-1',
        role: 'user',
        content: [
            { type: 'text', text: '请结合图片继续分析。' },
            { type: 'image_url', image_url: { url: 'https://example.com/diagram.png', detail: 'high' } },
        ],
        type: 'text',
    });

    session.addMessage({
        messageId: 'assistant-recent-1',
        role: 'assistant',
        content: `这是基于上下文的分析结论：${'B'.repeat(900)}`,
        type: 'text',
        finish_reason: 'stop',
        // prompt_tokens ≈ 500（所有之前消息的总 token 数）
        // 这个值反映了当前请求的完整上下文大小
        usage: createRealisticUsage(500, 50),
    });
}

function assertValidMessage(message: Message): void {
    expect(typeof message.messageId).toBe('string');
    expect(message.messageId.length).toBeGreaterThan(0);
    expect(['system', 'user', 'assistant', 'tool']).toContain(message.role);

    if (message.usage) {
        expect(message.usage.total_tokens).toBeGreaterThan(0);
    }

    if (message.type === 'tool-call') {
        const toolMsg = message as Message & { tool_calls?: ToolCallShape[] };
        expect(Array.isArray(toolMsg.tool_calls)).toBe(true);
    }

    if (message.role === 'tool') {
        const toolMsg = message as Message & { tool_call_id?: string };
        expect(typeof toolMsg.tool_call_id).toBe('string');
    }
}

describe('Session Compaction', () => {
    let tempDir: string;
    let memoryManager: IMemoryManager;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-compaction-'));
        memoryManager = createMemoryManager({ type: 'file', connectionString: tempDir });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('消息结构', () => {
        it('压缩后消息结构有效', async () => {
            const provider = new MockSummaryProvider();
            const session = new Session({
                systemPrompt: '你是测试助手',
                enableCompaction: true,
                provider,
                compactionConfig: {
                    maxTokens: 260,
                    maxOutputTokens: 120,
                    keepMessagesNum: 3,
                    triggerRatio: 0.9,
                },
            });

            seedSession(session);

            const compacted = await session.compactBeforeLLMCall();
            expect(compacted).toBe(true);
            expect(provider.generateCallCount).toBe(1);

            const messages = session.getMessages();

            // 验证消息结构
            for (const msg of messages) {
                assertValidMessage(msg);
            }

            // 验证系统消息
            expect(messages[0].role).toBe('system');
            expect(messages[0].messageId).toBe('system');

            // 验证摘要消息
            const summary = messages.find((m) => m.type === 'summary');
            expect(summary).toBeDefined();
            expect(summary?.role).toBe('assistant');
            expect(typeof summary?.content).toBe('string');

            // 验证工具调用配对
            const assistantTool = messages.find((m) => m.messageId === 'assistant-tool-1');
            const toolResult = messages.find((m) => m.messageId === 'tool-result-1');
            expect(assistantTool).toBeDefined();
            expect(toolResult).toBeDefined();
            expect(messages.findIndex((m) => m.messageId === 'assistant-tool-1')).toBeLessThan(
                messages.findIndex((m) => m.messageId === 'tool-result-1')
            );
        });

        it('压缩摘要请求应携带 abortSignal', async () => {
            const provider = new MockSummaryProvider();
            const session = new Session({
                systemPrompt: '你是测试助手',
                enableCompaction: true,
                provider,
                compactionConfig: {
                    maxTokens: 260,
                    maxOutputTokens: 120,
                    keepMessagesNum: 3,
                    triggerRatio: 0.9,
                },
            });

            seedSession(session);
            const compacted = await session.compactBeforeLLMCall();

            expect(compacted).toBe(true);
            expect(provider.generateCallCount).toBe(1);
            expect(provider.lastOptions?.abortSignal).toBeInstanceOf(AbortSignal);
        });

        it('持久化后的消息结构有效', async () => {
            const provider = new MockSummaryProvider();
            const session = new Session({
                sessionId: 'test-persist-session',
                systemPrompt: '你是测试助手',
                memoryManager,
                enableCompaction: true,
                provider,
                compactionConfig: {
                    maxTokens: 260,
                    maxOutputTokens: 120,
                    keepMessagesNum: 3,
                    triggerRatio: 0.9,
                },
            });

            await session.initialize();
            seedSession(session);

            const compacted = await session.compactBeforeLLMCall();
            expect(compacted).toBe(true);
            await session.sync();

            const sessionId = session.getSessionId();

            // 验证当前上下文
            const context = await memoryManager.getCurrentContext(sessionId);
            expect(context).toBeTruthy();
            expect(context!.messages[0].role).toBe('system');

            // 验证完整历史
            const history = await memoryManager.getFullHistory({ sessionId });
            expect(history.length).toBeGreaterThan(0);

            const summaryInHistory = history.find((m) => m.isSummary);
            expect(summaryInHistory).toBeDefined();

            // 验证压缩记录
            const records = await memoryManager.getCompactionRecords(sessionId);
            expect(records.length).toBe(1);
            expect(records[0].reason).toBe('token_limit');
            expect(records[0].archivedMessageIds.length).toBeGreaterThan(0);
        });

        it('should include reasoning_content in summary source when content is empty', async () => {
            const provider = new MockSummaryProvider();
            const session = new Session({
                systemPrompt: '你是测试助手',
                enableCompaction: true,
                provider,
                compactionConfig: {
                    maxTokens: 260,
                    maxOutputTokens: 120,
                    keepMessagesNum: 3,
                    triggerRatio: 0.9,
                },
            });

            seedSession(session);
            session.addMessage({
                messageId: 'assistant-reasoning-only',
                role: 'assistant',
                content: '',
                reasoning_content: '仅推理内容也应进入压缩摘要',
                type: 'text',
                finish_reason: 'stop',
            });
            session.addMessage({
                messageId: 'user-after-1',
                role: 'user',
                content: '后续消息 1',
                type: 'text',
            });
            session.addMessage({
                messageId: 'assistant-after-1',
                role: 'assistant',
                content: '后续回复 1',
                type: 'text',
                finish_reason: 'stop',
            });
            session.addMessage({
                messageId: 'user-after-2',
                role: 'user',
                content: '后续消息 2',
                type: 'text',
            });
            session.addMessage({
                messageId: 'assistant-after-2',
                role: 'assistant',
                content: '后续回复 2',
                type: 'text',
                finish_reason: 'stop',
            });

            const compacted = await session.compactBeforeLLMCall();
            expect(compacted).toBe(true);
            expect(provider.generateCallCount).toBe(1);
            expect(provider.lastSummaryInput).toContain('仅推理内容也应进入压缩摘要');
        });
    });

    describe('压缩时机', () => {
        it('addMessage 不会自动触发压缩', async () => {
            const provider = new MockSummaryProvider();
            const session = new Session({
                systemPrompt: 'system',
                enableCompaction: true,
                provider,
                compactionConfig: {
                    maxTokens: 120,
                    maxOutputTokens: 60,
                    keepMessagesNum: 1,
                    triggerRatio: 0.9,
                },
            });

            session.addMessage({
                messageId: 'u1',
                role: 'user',
                content: 'x'.repeat(1200),
                type: 'text',
            });
            session.addMessage({
                messageId: 'u2',
                role: 'user',
                content: 'y'.repeat(1200),
                type: 'text',
            });

            await new Promise((r) => setTimeout(r, 10));
            expect(provider.generateCallCount).toBe(0);
        });

        it('compactBeforeLLMCall 在达到阈值时触发压缩', async () => {
            const provider = new MockSummaryProvider();
            const session = new Session({
                systemPrompt: 'system',
                enableCompaction: true,
                provider,
                compactionConfig: {
                    maxTokens: 120,
                    maxOutputTokens: 60,
                    keepMessagesNum: 1,
                    triggerRatio: 0.9,
                },
            });

            session.addMessage({
                messageId: 'u1',
                role: 'user',
                content: 'x'.repeat(1200),
                type: 'text',
            });
            session.addMessage({
                messageId: 'u2',
                role: 'user',
                content: 'y'.repeat(1200),
                type: 'text',
            });

            const compacted = await session.compactBeforeLLMCall();

            expect(compacted).toBe(true);
            expect(provider.generateCallCount).toBe(1);
            expect(session.getMessages().some((m) => m.type === 'summary')).toBe(true);
        });

        it('未达到阈值时不压缩', async () => {
            const provider = new MockSummaryProvider();
            const session = new Session({
                systemPrompt: 'system',
                enableCompaction: true,
                provider,
                compactionConfig: {
                    maxTokens: 10000,
                    maxOutputTokens: 2000,
                    keepMessagesNum: 40,
                    triggerRatio: 0.9,
                },
            });

            session.addMessage({
                messageId: 'u1',
                role: 'user',
                content: 'hello',
                type: 'text',
            });

            const compacted = await session.compactBeforeLLMCall();

            expect(compacted).toBe(false);
            expect(provider.generateCallCount).toBe(0);
        });
    });

    describe('Token 信息', () => {
        it('getTokenInfo 返回正确的信息', async () => {
            const provider = new MockSummaryProvider();
            const session = new Session({
                systemPrompt: 'system',
                enableCompaction: true,
                provider,
                compactionConfig: {
                    maxTokens: 1000,
                    maxOutputTokens: 200,
                    keepMessagesNum: 10,
                    triggerRatio: 0.8,
                },
            });

            const tokenInfo = session.getTokenInfo();

            expect(tokenInfo.usableLimit).toBe(800);
            expect(tokenInfo.threshold).toBe(640);
            expect(tokenInfo.messageCount).toBe(1); // 只有 system 消息
            expect(typeof tokenInfo.estimatedTotal).toBe('number');
        });

        it('未启用压缩时 getTokenInfo 返回默认值', async () => {
            const session = new Session({
                systemPrompt: 'system',
            });

            const tokenInfo = session.getTokenInfo();

            expect(tokenInfo.estimatedTotal).toBe(0);
            expect(tokenInfo.shouldCompact).toBe(false);
        });
    });
});
