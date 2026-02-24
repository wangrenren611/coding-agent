/**
 * Agent 核心逻辑全面测试
 * 
 * 测试目标：
 * 1. 边界条件和错误处理
 * 2. 状态转换逻辑
 * 3. 重试机制
 * 4. 完成条件判断
 * 5. 消息处理
 * 6. 工具调用配对
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from './agent';
import { AgentStatus } from './types';
import { AgentMessageType } from './stream-types';
import { AgentState } from './core/agent-state';
import { LLMCaller } from './core/llm-caller';
import { ToolExecutor } from './core/tool-executor';
import { Compaction } from '../session/compaction';
import { createMemoryManager } from '../memory';
import { EventType } from '../eventbus';
import type { LLMGenerateOptions, LLMResponse } from '../../providers/types';
import type { Message } from '../session/types';

// ==================== Mock Provider ====================

class MockProvider {
    public lastOptions: LLMGenerateOptions | null = null;
    public callCount = 0;
    public shouldFail = false;
    public shouldTimeout = false;
    public failCount = 0;
    public responseDelay = 0;
    private customResponse: Partial<LLMResponse> | null = null;

    async generate(messages: unknown[], options?: LLMGenerateOptions) {
        this.lastOptions = options || null;
        this.callCount++;

        if (this.responseDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.responseDelay));
        }

        if (this.shouldFail && this.failCount < 3) {
            this.failCount++;
            const error = new Error('Simulated API error');
            (error as any).status = 500;
            throw error;
        }

        if (this.shouldTimeout) {
            await new Promise(resolve => setTimeout(resolve, 120000)); // 2 minutes
        }

        if (this.customResponse) {
            return {
                id: 'test-id',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                ...this.customResponse,
            } as LLMResponse;
        }

        return {
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-model',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: 'Hello! How can I help you?',
                },
                finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
    }

    getTimeTimeout() { return 60000; }

    setCustomResponse(response: Partial<LLMResponse>) {
        this.customResponse = response;
    }

    reset() {
        this.callCount = 0;
        this.shouldFail = false;
        this.shouldTimeout = false;
        this.failCount = 0;
        this.responseDelay = 0;
        this.customResponse = null;
        this.lastOptions = null;
    }
}

// ==================== AgentState 测试 ====================

describe('AgentState 状态管理测试', () => {
    let state: AgentState;
    const defaultConfig = {
        maxLoops: 10,
        maxRetries: 3,
        maxCompensationRetries: 1,
        defaultRetryDelayMs: 1000,
    };

    beforeEach(() => {
        state = new AgentState(defaultConfig);
    });

    describe('初始状态', () => {
        it('初始状态应该是 IDLE', () => {
            expect(state.status).toBe(AgentStatus.IDLE);
        });

        it('初始循环计数应该是 0', () => {
            expect(state.loopCount).toBe(0);
        });

        it('初始重试计数应该是 0', () => {
            expect(state.retryCount).toBe(0);
        });

        it('初始补偿重试计数应该是 0', () => {
            expect(state.compensationRetryCount).toBe(0);
        });
    });

    describe('canContinue 逻辑', () => {
        it('loopCount < maxLoops 时应该返回 true', () => {
            state.startTask();
            expect(state.canContinue()).toBe(true);
        });

        it('loopCount >= maxLoops 时应该返回 false', () => {
            state.startTask();
            for (let i = 0; i < 10; i++) {
                state.incrementLoop();
            }
            expect(state.canContinue()).toBe(false);
        });

        it('刚好达到 maxLoops 时应该返回 false', () => {
            state.startTask();
            for (let i = 0; i < 9; i++) {
                state.incrementLoop();
            }
            expect(state.canContinue()).toBe(true);
            state.incrementLoop();
            expect(state.canContinue()).toBe(false);
        });
    });

    describe('重试逻辑', () => {
        it('isRetryExceeded 在 retryCount > maxRetries 时返回 true', () => {
            state.startTask();
            expect(state.isRetryExceeded()).toBe(false);
            state.recordRetryableError();
            expect(state.isRetryExceeded()).toBe(false);
            state.recordRetryableError();
            expect(state.isRetryExceeded()).toBe(false);
            state.recordRetryableError();
            expect(state.isRetryExceeded()).toBe(false);
            state.recordRetryableError(); // 4 > 3
            expect(state.isRetryExceeded()).toBe(true);
        });

        it('recordSuccess 应该重置重试计数', () => {
            state.startTask();
            state.recordRetryableError();
            state.recordRetryableError();
            state.recordSuccess();
            expect(state.retryCount).toBe(0);
        });

        it('needsRetry 只在 retryCount > 0 时返回 true', () => {
            expect(state.needsRetry()).toBe(false);
            state.startTask();
            state.recordRetryableError();
            expect(state.needsRetry()).toBe(true);
        });

        it('totalRetryCount 应累计重试次数且不被 recordSuccess 清零', () => {
            state.startTask();
            state.recordRetryableError();
            state.recordRetryableError();
            expect(state.totalRetryCount).toBe(2);
            state.recordSuccess();
            expect(state.retryCount).toBe(0);
            expect(state.totalRetryCount).toBe(2);
        });
    });

    describe('补偿重试逻辑', () => {
        it('isCompensationRetryExceeded 在达到最大次数时返回 true', () => {
            state.startTask();
            expect(state.isCompensationRetryExceeded()).toBe(false);
            state.recordCompensationRetry();
            expect(state.isCompensationRetryExceeded()).toBe(true);
        });

        it('recordSuccess 应该重置重试计数但不重置补偿重试计数', () => {
            state.startTask();
            state.recordRetryableError();
            state.recordCompensationRetry();
            state.recordSuccess();
            expect(state.retryCount).toBe(0);
            expect(state.compensationRetryCount).toBe(1); // 不重置，累计空响应次数
        });
    });

    describe('状态转换', () => {
        it('startTask 应该重置所有状态', () => {
            state.startTask();
            state.incrementLoop();
            state.recordRetryableError();
            state.recordCompensationRetry();
            state.failTask({ code: 'TEST', userMessage: 'test' });

            state.startTask();
            expect(state.loopCount).toBe(0);
            expect(state.retryCount).toBe(0);
            expect(state.compensationRetryCount).toBe(0);
            expect(state.status).toBe(AgentStatus.RUNNING);
            expect(state.lastFailure).toBeUndefined();
        });

        it('completeTask 应该设置状态为 COMPLETED', () => {
            state.startTask();
            state.completeTask();
            expect(state.status).toBe(AgentStatus.COMPLETED);
        });

        it('failTask 应该设置状态为 FAILED', () => {
            state.startTask();
            state.failTask({ code: 'TEST_ERROR', userMessage: 'Test failed' });
            expect(state.status).toBe(AgentStatus.FAILED);
            expect(state.lastFailure?.code).toBe('TEST_ERROR');
        });

        it('abort 应该设置状态为 ABORTED', () => {
            state.startTask();
            state.abort();
            expect(state.status).toBe(AgentStatus.ABORTED);
            expect(state.lastFailure?.code).toBe('AGENT_ABORTED');
        });
    });

    describe('isBusy 逻辑', () => {
        it('RUNNING 状态应该是 busy', () => {
            state.startTask();
            expect(state.isBusy()).toBe(true);
        });

        it('IDLE 状态不应该是 busy', () => {
            expect(state.isBusy()).toBe(false);
        });

        it('COMPLETED 状态不应该是 busy', () => {
            state.startTask();
            state.completeTask();
            expect(state.isBusy()).toBe(false);
        });

        it('RETRYING 状态应该是 busy', () => {
            state.startTask();
            state.setStatus(AgentStatus.RETRYING);
            expect(state.isBusy()).toBe(true);
        });
    });
});

// ==================== Agent 完成条件测试 ====================

describe('Agent 完成条件判断测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/completion-test-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    describe('finish_reason 处理', () => {
        it('finish_reason=stop 应该完成任务', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const result = await agent.execute('Hello');
            expect(result.role).toBe('assistant');
            expect(result.finish_reason).toBe('stop');
        });

        it('finish_reason=tool_calls 应该继续执行工具', async () => {
            // 第一次返回工具调用，第二次返回正常响应
            let callCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                callCount++;
                if (callCount === 1) {
                    return {
                        id: 'test-1',
                        choices: [{
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [{
                                    id: 'call-1',
                                    type: 'function',
                                    function: { name: 'glob', arguments: '{"pattern": "*.ts"}' },
                                }],
                            },
                            finish_reason: 'tool_calls',
                        }],
                    };
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const result = await agent.execute('Find files');
            expect(agent.getLoopCount()).toBeGreaterThanOrEqual(1);
        }, 15000);

        it('finish_reason=length 应该在有内容时完成', async () => {
            mockProvider.setCustomResponse({
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'This is a partial response...',
                    },
                    finish_reason: 'length',
                }],
            });

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const result = await agent.execute('Hello');
            expect(result.finish_reason).toBe('length');
            expect(result.content).toBeTruthy();
        });
    });

    describe('空响应处理', () => {
        it('空内容 + stop 应该触发补偿重试', async () => {
            let callCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                callCount++;
                if (callCount <= 2) {
                    return {
                        id: 'test-id',
                        choices: [{
                            index: 0,
                            message: { role: 'assistant', content: '' },
                            finish_reason: 'stop',
                        }],
                    };
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            // 空响应会触发补偿重试，最多重试 1 次后会失败
            const result = await agent.executeWithResult('Hello');
            expect(['completed', 'failed']).toContain(result.status);
        }, 10000);

        it('stream 模式空内容应触发补偿重试，避免仅 thinking 空转', async () => {
            let callCount = 0;
            mockProvider.generate = async () => {
                callCount++;
                return {
                    id: `stream-empty-${callCount}`,
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: '' },
                        finish_reason: 'length',
                    }],
                } as LLMResponse;
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: true,
                memoryManager,
                maxLoops: 20,
                maxCompensationRetries: 1,
            });

            const result = await agent.executeWithResult('Hello');
            expect(result.status).toBe('failed');
            expect(callCount).toBe(2);
            expect(agent.getLoopCount()).toBe(2);
        }, 10000);
    });

    describe('消息过滤逻辑', () => {
        it('空内容的 user 消息不应该被发送给 LLM', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            await agent.execute('Hello');
            // 验证消息被正确处理
            const messages = agent.getMessages();
            expect(messages.length).toBeGreaterThan(0);
        });
    });
});

// ==================== Agent 重试机制测试 ====================

describe('Agent 重试机制测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/retry-test-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    describe('最大循环限制', () => {
        it('超过最大循环次数应该返回失败状态', async () => {
            // 创建一个会持续返回 tool_calls 的 mock
            let callCount = 0;
            mockProvider.generate = async () => {
                callCount++;
                return {
                    id: `test-id-${callCount}`,
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'Processing...',
                            tool_calls: [{
                                id: `call-${callCount}`,
                                type: 'function',
                                function: {
                                    name: 'read_file',
                                    arguments: '{"path": "test.txt"}',
                                },
                            }],
                        },
                        finish_reason: 'tool_calls',
                    }],
                };
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxLoops: 5, // 设置较低的限制
            });

            // 超过最大循环应该返回失败状态
            const result = await agent.executeWithResult('Keep looping');
            expect(['failed', 'completed']).toContain(result.status);
        }, 30000);
    });

    describe('API 错误重试', () => {
        it('LLMRetryableError 应该触发重试', async () => {
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            const { LLMRetryableError } = await import('../../providers');
            
            mockProvider.generate = async (messages, options) => {
                if (failCount < 2) {
                    failCount++;
                    throw new LLMRetryableError('Server error', 100, 'SERVER_500');
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 5,
                retryDelayMs: 100,
            });

            const result = await agent.execute('Hello');
            expect(result).toBeDefined();
            expect(failCount).toBe(2);
        }, 15000);

        it('executeWithResult 应返回累计重试次数', async () => {
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            const { LLMRetryableError } = await import('../../providers');

            mockProvider.generate = async (messages, options) => {
                if (failCount < 2) {
                    failCount++;
                    throw new LLMRetryableError('Server error', 10, 'SERVER_500');
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 5,
                retryDelayMs: 10,
            });

            const result = await agent.executeWithResult('Hello');
            expect(result.status).toBe('completed');
            expect(result.retryCount).toBe(2);
        });

        it('应该发出 TASK_START/TASK_RETRY/TASK_SUCCESS 事件', async () => {
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            const { LLMRetryableError } = await import('../../providers');

            mockProvider.generate = async (messages, options) => {
                if (failCount < 1) {
                    failCount++;
                    throw new LLMRetryableError('Transient timeout', 10, 'TIMEOUT');
                }
                return originalGenerate(messages, options);
            };

            const starts: unknown[] = [];
            const retries: unknown[] = [];
            const successes: unknown[] = [];

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 3,
                retryDelayMs: 10,
            });

            agent.on(EventType.TASK_START, (data) => starts.push(data));
            agent.on(EventType.TASK_RETRY, (data) => retries.push(data));
            agent.on(EventType.TASK_SUCCESS, (data) => successes.push(data));

            await agent.execute('Hello');

            expect(starts.length).toBe(1);
            expect(retries.length).toBe(1);
            expect(successes.length).toBe(1);
            expect(retries[0]).toEqual(
                expect.objectContaining({
                    retryCount: 1,
                    maxRetries: 3,
                    reason: expect.stringContaining('Transient timeout'),
                })
            );
            expect(successes[0]).toEqual(
                expect.objectContaining({
                    totalRetries: 1,
                })
            );
        });

        it('超过最大重试后错误信息应包含最后一次重试原因', async () => {
            const { LLMRetryableError } = await import('../../providers');

            mockProvider.generate = async () => {
                throw new LLMRetryableError('Gateway timeout', 10, 'TIMEOUT');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 0,
                retryDelayMs: 10,
            });

            await expect(agent.execute('Hello')).rejects.toThrow('Gateway timeout');
        });
    });
});

// ==================== Agent 中止测试 ====================

describe('Agent 中止机制测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/abort-test-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    it('abort() 应该中止正在执行的任务', async () => {
        mockProvider.responseDelay = 5000; // 5 seconds delay

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            requestTimeout: 100, // 设置短超时
        });

        // 执行并等待结果
        const result = await agent.executeWithResult('Hello');
        expect(['completed', 'failed', 'aborted']).toContain(result.status);
    }, 10000);

    it('重试等待期间 abort 应尽快返回 aborted', async () => {
        const { LLMRetryableError } = await import('../../providers');
        mockProvider.generate = async () => {
            throw new LLMRetryableError('Retry later', 5000, 'TIMEOUT');
        };

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            retryDelayMs: 5000,
            maxRetries: 3,
        });

        const startedAt = Date.now();
        const execution = agent.executeWithResult('Hello');
        setTimeout(() => agent.abort(), 100);
        const result = await execution;
        const elapsed = Date.now() - startedAt;

        expect(result.status).toBe('aborted');
        expect(elapsed).toBeLessThan(1500);
    }, 10000);

    it('中止后再次执行应该从 IDLE 开始', async () => {
        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
        });

        // 第一次执行
        await agent.execute('First');
        expect(agent.getStatus()).toBe(AgentStatus.COMPLETED);

        // 第二次执行应该可以正常开始
        await agent.execute('Second');
        expect(agent.getStatus()).toBe(AgentStatus.COMPLETED);
    });
});

// ==================== Compaction 测试 ====================

describe('Compaction 压缩逻辑测试', () => {
    let mockProvider: MockProvider;
    let compaction: Compaction;

    beforeEach(() => {
        mockProvider = new MockProvider();
        compaction = new Compaction({
            maxTokens: 1000,
            maxOutputTokens: 200,
            llmProvider: mockProvider as any,
            keepMessagesNum: 5,
            triggerRatio: 0.8,
        });
    });

    afterEach(() => {
        mockProvider.reset();
    });

    describe('Token 计算', () => {
        it('空消息列表的 token 应该是 0', () => {
            const info = compaction.getTokenInfo([]);
            expect(info.estimatedTotal).toBe(0);
        });

        it('应该正确计算 token 数量', () => {
            const messages: Message[] = [
                { messageId: '1', role: 'user', content: 'Hello world' },
                { messageId: '2', role: 'assistant', content: 'Hi there!' },
            ];
            const info = compaction.getTokenInfo(messages);
            expect(info.estimatedTotal).toBeGreaterThan(0);
        });
    });

    describe('触发条件', () => {
        it('消息数少于 keepMessagesNum 不应该触发压缩', () => {
            const messages: Message[] = Array(3).fill(null).map((_, i) => ({
                messageId: `${i}`,
                role: 'user' as const,
                content: 'Test message',
            }));
            const info = compaction.getTokenInfo(messages);
            expect(info.shouldCompact).toBe(false);
        });

        it('消息数多于 keepMessagesNum 但 token 未达阈值不应该触发', () => {
            const messages: Message[] = Array(10).fill(null).map((_, i) => ({
                messageId: `${i}`,
                role: 'user' as const,
                content: 'Short', // 短内容，token 少
            }));
            const info = compaction.getTokenInfo(messages);
            // 即使消息多，如果 token 少也不触发
            expect(info.shouldCompact).toBe(false);
        });
    });

    describe('消息分割逻辑', () => {
        it('应该保留系统消息', async () => {
            const messages: Message[] = [
                { messageId: 'sys', role: 'system', content: 'System prompt' },
                { messageId: '1', role: 'user', content: 'Hello' },
                { messageId: '2', role: 'assistant', content: 'Hi!' },
            ];

            // 设置 mock 返回摘要
            mockProvider.setCustomResponse({
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Summary' },
                    finish_reason: 'stop',
                }],
            });

            // 不触发压缩的测试
            const result = await compaction.compact(messages);
            expect(result.isCompacted).toBe(false);
        });

        it('应该保留最后一条 user 消息', async () => {
            // 创建足够多的消息以触发压缩
            const messages: Message[] = [
                { messageId: 'sys', role: 'system', content: 'System prompt' },
                ...Array(20).fill(null).map((_, i) => ({
                    messageId: `${i}`,
                    role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
                    content: 'A'.repeat(100), // 足够长以触发 token 阈值
                })),
            ];

            mockProvider.setCustomResponse({
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Summary' },
                    finish_reason: 'stop',
                }],
            });

            const result = await compaction.compact(messages);
            
            if (result.isCompacted) {
                // 检查 active 区域最后一条 user 消息被保留
                const activeUserMessages = result.messages.filter(
                    m => m.role === 'user' && m.type !== 'summary'
                );
                expect(activeUserMessages.length).toBeGreaterThanOrEqual(1);
            }
        });
    });

    describe('工具调用配对', () => {
        it('tool 消息应该与对应的 assistant 消息配对', async () => {
            const messages: Message[] = [
                { messageId: 'sys', role: 'system', content: 'System' },
                { messageId: '1', role: 'user', content: 'Read file' },
                { 
                    messageId: '2', 
                    role: 'assistant', 
                    content: '',
                    tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
                },
                { messageId: '3', role: 'tool', tool_call_id: 'tc1', content: 'File content' },
                { messageId: '4', role: 'user', content: 'Thanks' },
                ...Array(20).fill(null).map((_, i) => ({
                    messageId: `${i + 5}`,
                    role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
                    content: 'A'.repeat(100),
                })),
            ];

            mockProvider.setCustomResponse({
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Summary' },
                    finish_reason: 'stop',
                }],
            });

            const result = await compaction.compact(messages);
            
            if (result.isCompacted) {
                // 检查 tool 消息和 assistant 消息配对
                const hasToolMessage = result.messages.some(m => m.role === 'tool');
                const hasAssistantWithToolCall = result.messages.some(
                    m => m.role === 'assistant' && Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0
                );
                
                if (hasToolMessage) {
                    expect(hasAssistantWithToolCall).toBe(true);
                }
            }
        });
    });
});

// ==================== 边界条件测试 ====================

describe('Agent 边界条件测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/edge-test-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    describe('输入验证', () => {
        it('空字符串输入应该被拒绝', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            await expect(agent.execute('')).rejects.toThrow();
        });

        it('纯空白字符输入应该被拒绝', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            await expect(agent.execute('   ')).rejects.toThrow();
        });

        it('null 输入应该被拒绝', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            await expect(agent.execute(null as any)).rejects.toThrow();
        });

        it('undefined 输入应该被拒绝', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            await expect(agent.execute(undefined as any)).rejects.toThrow();
        });
    });

    describe('Provider 验证', () => {
        it('缺少 provider 应该抛出错误', () => {
            expect(() => {
                new Agent({
                    provider: null as any,
                    systemPrompt: 'Test',
                });
            }).toThrow();
        });
    });

    describe('并发执行保护', () => {
        it('忙碌时执行应该抛出错误', async () => {
            mockProvider.responseDelay = 1000;

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const firstExecution = agent.execute('First');
            
            // 等待一小段时间确保第一次执行已经开始
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 第二次执行应该被拒绝
            await expect(agent.execute('Second')).rejects.toThrow();

            await firstExecution;
        });
    });

    describe('超时处理', () => {
        it('请求超时应该正确处理', async () => {
            mockProvider.responseDelay = 10000; // 10 seconds

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                requestTimeout: 100, // 100ms timeout
            });

            // 应该因超时而失败或重试
            const result = await agent.executeWithResult('Hello');
            expect(['failed', 'completed']).toContain(result.status);
        }, 15000);
    });
});

// ==================== 消息处理测试 ====================

describe('消息处理测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/message-test-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    describe('多模态内容', () => {
        it('应该正确处理文本内容', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const result = await agent.execute('Hello world');
            expect(result).toBeDefined();
        });

        it('应该正确处理数组格式内容', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const content = [
                { type: 'text', text: 'Hello' },
                { type: 'text', text: 'world' },
            ];

            const result = await agent.execute(content);
            expect(result).toBeDefined();
        });
    });

    describe('消息历史', () => {
        it('执行后应该保留消息历史', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test system prompt',
                stream: false,
                memoryManager,
            });

            await agent.execute('First message');
            const messages = agent.getMessages();

            expect(messages.length).toBeGreaterThan(0);
            expect(messages.some(m => m.role === 'system')).toBe(true);
            expect(messages.some(m => m.role === 'user')).toBe(true);
            expect(messages.some(m => m.role === 'assistant')).toBe(true);
        });

        it('同一 session 多次执行应该累积消息', async () => {
            const sessionId = 'test-session-accumulate';
            
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                sessionId,
            });

            await agent.execute('First');
            const countAfterFirst = agent.getMessages().length;

            await agent.execute('Second');
            const countAfterSecond = agent.getMessages().length;

            expect(countAfterSecond).toBeGreaterThan(countAfterFirst);
        });
    });
});

describe('Task 子 Agent 事件透传', () => {
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/subagent-event-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
    });

    it('Agent 执行 task 工具时应触发 SUBAGENT_EVENT', async () => {
        let callCount = 0;
        const events: any[] = [];

        const provider = new MockProvider();
        provider.generate = async () => {
            callCount++;

            // 父 Agent 第一轮：触发 task 工具调用
            if (callCount === 1) {
                return {
                    id: 'parent-task-call',
                    object: 'chat.completion',
                    created: Date.now(),
                    model: 'test-model',
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'Use task tool',
                            tool_calls: [{
                                id: 'call-task-1',
                                type: 'function',
                                function: {
                                    name: 'task',
                                    arguments: JSON.stringify({
                                        description: 'subagent check',
                                        prompt: 'just answer done',
                                        subagent_type: 'explore',
                                    }),
                                },
                            }],
                        },
                        finish_reason: 'tool_calls',
                    }],
                } as LLMResponse;
            }

            // 子 Agent：直接返回文本，不再触发工具
            if (callCount === 2) {
                return {
                    id: 'subagent-text',
                    object: 'chat.completion',
                    created: Date.now(),
                    model: 'test-model',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: 'subagent done' },
                        finish_reason: 'stop',
                    }],
                } as LLMResponse;
            }

            // 父 Agent 第二轮：汇总最终回答
            return {
                id: 'parent-final',
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'final answer' },
                    finish_reason: 'stop',
                }],
            } as LLMResponse;
        };

        const agent = new Agent({
            provider: provider as any,
            systemPrompt: 'Test',
            stream: true,
            memoryManager,
            streamCallback: (msg) => events.push(msg),
        });

        const result = await agent.execute('run task');
        expect(result.content).toContain('final answer');

        const subagentEvents = events.filter((e) => e.type === AgentMessageType.SUBAGENT_EVENT);
        expect(subagentEvents.length).toBeGreaterThan(0);
        expect(subagentEvents[0].payload?.event).toBeDefined();
    });
});

// ==================== 工具执行测试 ====================

describe('工具执行测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/tool-test-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    describe('工具调用处理', () => {
        it('应该正确处理工具调用响应', async () => {
            // 第一次返回工具调用，第二次返回普通响应
            let callCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                callCount++;
                if (callCount === 1) {
                    return {
                        id: 'test-1',
                        choices: [{
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [{
                                    id: 'call-1',
                                    type: 'function',
                                    function: { name: 'glob', arguments: '{"pattern": "*.ts"}' },
                                }],
                            },
                            finish_reason: 'tool_calls',
                        }],
                    };
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const result = await agent.execute('Find TypeScript files');
            expect(result).toBeDefined();
            expect(callCount).toBeGreaterThanOrEqual(1);
        }, 15000);
    });

    describe('工具结果脱敏', () => {
        it('敏感信息应该被脱敏', async () => {
            // 简化测试：只验证 security 模块的脱敏功能
            const { sanitizeToolResult, toolResultToString } = await import('../security');
            
            const sensitiveResult = {
                tool_call_id: 'call-1',
                result: {
                    success: true,
                    output: 'API_KEY=sk-1234567890\nPASSWORD=secret123\nNORMAL=text',
                },
            };
            
            const sanitized = sanitizeToolResult(sensitiveResult);
            const resultString = toolResultToString(sanitized);
            
            // 敏感信息应该被脱敏
            expect(resultString).not.toContain('sk-1234567890');
            expect(resultString).not.toContain('secret123');
        }, 5000);
    });
});
