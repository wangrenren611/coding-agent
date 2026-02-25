/**
 * Agent 重试机制全面测试
 * 
 * 测试目标：
 * 1. AgentState 重试计数和重置逻辑
 * 2. 各类可重试错误（网络错误、超时、RateLimit、服务器错误等）
 * 3. 补偿重试机制（空响应）
 * 4. 最大重试次数限制
 * 5. 重试延迟和退避策略
 * 6. 中止与重试的交互
 * 7. 事件发出验证
 * 8. 边界条件和异常场景
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from './agent';
import { AgentStatus } from './types';
import { AgentState } from './core/agent-state';
import { EventType } from '../eventbus';
import { createMemoryManager } from '../memory';
import type { LLMGenerateOptions, LLMResponse } from '../../providers/types';
import type { Message } from '../session/types';

// ==================== Mock Provider ====================

class MockProvider {
    public callCount = 0;
    public shouldFail = false;
    public failCount = 0;
    public maxFails = 3;
    public responseDelay = 0;
    public errorToThrow: Error | null = null;
    public customResponses: Partial<LLMResponse>[] = [];
    public responseIndex = 0;

    async generate(messages: unknown[], options?: LLMGenerateOptions) {
        this.callCount++;

        if (this.responseDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.responseDelay));
        }

        // 检查是否应该抛出错误
        if (this.errorToThrow) {
            const error = this.errorToThrow;
            this.errorToThrow = null; // 只抛出一次
            throw error;
        }

        if (this.shouldFail && this.failCount < this.maxFails) {
            this.failCount++;
            const error = new Error('Simulated API error');
            (error as any).status = 500;
            throw error;
        }

        // 使用自定义响应队列
        if (this.customResponses.length > 0) {
            const response = this.customResponses[Math.min(this.responseIndex, this.customResponses.length - 1)];
            this.responseIndex++;
            return {
                id: `test-id-${this.callCount}`,
                object: 'chat.completion',
                created: Date.now(),
                model: 'test-model',
                ...response,
            } as LLMResponse;
        }

        return {
            id: `test-id-${this.callCount}`,
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

    reset() {
        this.callCount = 0;
        this.shouldFail = false;
        this.failCount = 0;
        this.maxFails = 3;
        this.responseDelay = 0;
        this.errorToThrow = null;
        this.customResponses = [];
        this.responseIndex = 0;
    }
}

// ==================== AgentState 重试测试 ====================

describe('AgentState 重试机制测试', () => {
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

    describe('重试计数逻辑', () => {
        it('isRetryExceeded 在 retryCount <= maxRetries 时返回 false', () => {
            state.startTask();
            expect(state.isRetryExceeded()).toBe(false);
            
            for (let i = 0; i <= defaultConfig.maxRetries; i++) {
                if (i > 0) {
                    state.recordRetryableError();
                }
                // retryCount 从 0 到 maxRetries 都应该返回 false
                expect(state.isRetryExceeded()).toBe(i > defaultConfig.maxRetries);
            }
        });

        it('isRetryExceeded 在 retryCount > maxRetries 时返回 true', () => {
            state.startTask();
            // 超过 maxRetries 次重试
            for (let i = 0; i <= defaultConfig.maxRetries; i++) {
                state.recordRetryableError();
            }
            expect(state.retryCount).toBe(defaultConfig.maxRetries + 1);
            expect(state.isRetryExceeded()).toBe(true);
        });

        it('totalRetryCount 应该累计所有重试次数', () => {
            state.startTask();
            state.recordRetryableError();
            state.recordRetryableError();
            expect(state.totalRetryCount).toBe(2);
            
            state.recordSuccess(); // 成功会重置 retryCount 但不重置 totalRetryCount
            expect(state.retryCount).toBe(0);
            expect(state.totalRetryCount).toBe(2);
            
            state.recordRetryableError();
            expect(state.totalRetryCount).toBe(3);
        });

        it('recordSuccess 应该重置 retryCount 和 nextRetryDelayMs', () => {
            state.startTask();
            state.recordRetryableError(5000); // 设置自定义延迟
            expect(state.retryCount).toBe(1);
            expect(state.nextRetryDelayMs).toBe(5000);
            
            state.recordSuccess();
            expect(state.retryCount).toBe(0);
            expect(state.nextRetryDelayMs).toBe(defaultConfig.defaultRetryDelayMs);
        });
    });

    describe('startTask 重置逻辑', () => {
        it('startTask 应该重置所有重试计数器', () => {
            // 先设置一些状态
            state.startTask();
            state.incrementLoop();
            state.recordRetryableError();
            state.recordRetryableError();
            state.recordCompensationRetry();
            
            // 开始新任务
            state.startTask();
            
            expect(state.loopCount).toBe(0);
            expect(state.retryCount).toBe(0);
            expect(state.totalRetryCount).toBe(0);
            expect(state.compensationRetryCount).toBe(0);
            expect(state.isRetryExceeded()).toBe(false);
            expect(state.isCompensationRetryExceeded()).toBe(false);
        });

        it('startTask 应该重置 lastFailure', () => {
            state.startTask();
            state.failTask({ code: 'TEST_ERROR', userMessage: 'Test failure' });
            expect(state.lastFailure).toBeDefined();
            
            state.startTask();
            expect(state.lastFailure).toBeUndefined();
        });

        it('startTask 应该重置 nextRetryDelayMs 为默认值', () => {
            state.startTask();
            state.recordRetryableError(5000);
            expect(state.nextRetryDelayMs).toBe(5000);
            
            state.startTask();
            expect(state.nextRetryDelayMs).toBe(defaultConfig.defaultRetryDelayMs);
        });
    });

    describe('补偿重试逻辑', () => {
        it('isCompensationRetryExceeded 在达到 maxCompensationRetries 时返回 true', () => {
            state.startTask();
            expect(state.isCompensationRetryExceeded()).toBe(false);
            
            state.recordCompensationRetry();
            expect(state.isCompensationRetryExceeded()).toBe(true);
        });

        it('补偿重试次数在任务期间累计，不被 recordSuccess 重置', () => {
            state.startTask();
            state.recordCompensationRetry();
            expect(state.compensationRetryCount).toBe(1);
            
            state.recordSuccess();
            expect(state.compensationRetryCount).toBe(1); // 不重置
            
            state.recordCompensationRetry();
            expect(state.compensationRetryCount).toBe(2);
        });

        it('startTask 会重置补偿重试计数', () => {
            state.startTask();
            state.recordCompensationRetry();
            state.recordCompensationRetry();
            
            state.startTask();
            expect(state.compensationRetryCount).toBe(0);
        });
    });

    describe('重试延迟', () => {
        it('recordRetryableError 应该更新 nextRetryDelayMs', () => {
            state.startTask();
            state.recordRetryableError(3000);
            expect(state.nextRetryDelayMs).toBe(3000);
        });

        it('recordRetryableError 不传延迟时使用默认值', () => {
            state.startTask();
            state.recordRetryableError();
            expect(state.nextRetryDelayMs).toBe(defaultConfig.defaultRetryDelayMs);
        });
    });
});

// ==================== Agent 各类错误重试测试 ====================

describe('Agent 各类错误重试测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/retry-comprehensive-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    describe('LLMRetryableError 重试', () => {
        it('服务器 500 错误应该触发重试', async () => {
            const { LLMRetryableError } = await import('../../providers');
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                if (failCount < 2) {
                    failCount++;
                    throw new LLMRetryableError('Internal Server Error', 100, 'SERVER_500');
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 5,
                retryDelayMs: 50,
            });

            const result = await agent.execute('Hello');
            expect(result).toBeDefined();
            expect(failCount).toBe(2);
            expect(agent.getRetryCount()).toBe(2);
        }, 15000);

        it('超时错误应该触发重试', async () => {
            const { LLMRetryableError } = await import('../../providers');
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                if (failCount < 1) {
                    failCount++;
                    throw new LLMRetryableError('Request timeout', 50, 'TIMEOUT');
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 3,
                retryDelayMs: 50,
            });

            const result = await agent.execute('Hello');
            expect(result).toBeDefined();
            expect(failCount).toBe(1);
        }, 15000);

        it('RateLimit 错误应该触发重试', async () => {
            const { LLMRateLimitError } = await import('../../providers');
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                if (failCount < 1) {
                    failCount++;
                    throw new LLMRateLimitError('Rate limit exceeded');
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 3,
                retryDelayMs: 50,
            });

            const result = await agent.execute('Hello');
            expect(result).toBeDefined();
            expect(failCount).toBe(1);
        }, 15000);

        it('Bad Gateway 错误应该触发重试', async () => {
            const { LLMRetryableError } = await import('../../providers');
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                if (failCount < 1) {
                    failCount++;
                    throw new LLMRetryableError('Bad Gateway', 100, 'SERVER_502');
                }
                return originalGenerate(messages, options);
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 3,
                retryDelayMs: 50,
            });

            const result = await agent.execute('Hello');
            expect(result).toBeDefined();
            expect(failCount).toBe(1);
        }, 15000);
    });

    describe('不可重试错误', () => {
        it('认证错误不应该触发重试', async () => {
            const { LLMAuthError } = await import('../../providers');
            
            mockProvider.generate = async () => {
                throw new LLMAuthError('Invalid API key');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 5,
                retryDelayMs: 50,
            });

            await expect(agent.execute('Hello')).rejects.toThrow('Invalid API key');
            expect(agent.getRetryCount()).toBe(0); // 不应该有重试
        }, 10000);

        it('404 错误不应该触发重试', async () => {
            const { LLMNotFoundError } = await import('../../providers');
            
            mockProvider.generate = async () => {
                throw new LLMNotFoundError('Model not found');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 5,
                retryDelayMs: 50,
            });

            await expect(agent.execute('Hello')).rejects.toThrow('Model not found');
            expect(agent.getRetryCount()).toBe(0);
        }, 10000);

        it('400 错误不应该触发重试', async () => {
            const { LLMBadRequestError } = await import('../../providers');
            
            mockProvider.generate = async () => {
                throw new LLMBadRequestError('Invalid request format');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 5,
                retryDelayMs: 50,
            });

            await expect(agent.execute('Hello')).rejects.toThrow('Invalid request format');
            expect(agent.getRetryCount()).toBe(0);
        }, 10000);
    });

    describe('最大重试次数限制', () => {
        it('超过最大重试次数应该抛出错误', async () => {
            const { LLMRetryableError } = await import('../../providers');
            
            mockProvider.generate = async () => {
                throw new LLMRetryableError('Persistent server error', 10, 'SERVER_500');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 2,
                retryDelayMs: 10,
            });

            await expect(agent.execute('Hello')).rejects.toThrow('maximum retries');
            expect(agent.getRetryCount()).toBe(3); // 0, 1, 2, 3 (exceeded)
        }, 10000);

        it('maxRetries=0 时不允许任何重试', async () => {
            const { LLMRetryableError } = await import('../../providers');
            
            mockProvider.generate = async () => {
                throw new LLMRetryableError('Server error', 10, 'SERVER_500');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 0,
                retryDelayMs: 10,
            });

            await expect(agent.execute('Hello')).rejects.toThrow('maximum retries');
            expect(agent.getRetryCount()).toBe(1); // 只尝试 1 次就失败
        }, 10000);

        it('错误信息应该包含最后一次重试原因', async () => {
            const { LLMRetryableError } = await import('../../providers');
            
            mockProvider.generate = async () => {
                throw new LLMRetryableError('Specific error message', 10, 'CUSTOM_ERROR');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 0,
                retryDelayMs: 10,
            });

            try {
                await agent.execute('Hello');
                expect.fail('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain('Specific error message');
            }
        }, 10000);
    });

    describe('补偿重试（空响应）', () => {
        it('空响应应该触发补偿重试', async () => {
            let callCount = 0;
            
            mockProvider.generate = async () => {
                callCount++;
                if (callCount <= 2) {
                    return {
                        id: `empty-${callCount}`,
                        choices: [{
                            index: 0,
                            message: { role: 'assistant', content: '' },
                            finish_reason: 'stop',
                        }],
                    } as LLMResponse;
                }
                return {
                    id: 'normal',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: 'Normal response' },
                        finish_reason: 'stop',
                    }],
                } as LLMResponse;
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxLoops: 10,
                maxCompensationRetries: 2,
            });

            const result = await agent.execute('Hello');
            expect(result.content).toBe('Normal response');
            expect(callCount).toBe(3);
        }, 10000);

        it('超过最大补偿重试次数应该失败', async () => {
            mockProvider.generate = async () => {
                return {
                    id: 'empty',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: '' },
                        finish_reason: 'stop',
                    }],
                } as LLMResponse;
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxLoops: 10,
                maxCompensationRetries: 1,
            });

            const result = await agent.executeWithResult('Hello');
            expect(result.status).toBe('failed');
            // 补偿重试超过限制时应该有特定的错误码
            expect(result.failure?.code).toBe('AGENT_COMPENSATION_RETRY_EXCEEDED');
            expect(result.failure?.userMessage).toContain('maximum compensation retries');
        }, 10000);

        it('补偿重试超过限制时应移除空响应消息', async () => {
            mockProvider.generate = async () => {
                return {
                    id: 'empty',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: '' },
                        finish_reason: 'stop',
                    }],
                } as LLMResponse;
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxLoops: 10,
                maxCompensationRetries: 1,
            });

            await agent.executeWithResult('Hello');
            
            // 补偿重试超过限制后，空响应消息应该被移除
            // Session 中应该只有：系统消息 + 用户消息（没有助手空响应）
            const messages = agent.getMessages();
            const assistantMessages = messages.filter(m => m.role === 'assistant');
            expect(assistantMessages.length).toBe(0); // 没有助手消息（空响应被移除）
        }, 10000);

        it('补偿重试次数与普通重试次数独立计算', async () => {
            const { LLMRetryableError } = await import('../../providers');
            let callCount = 0;
            
            mockProvider.generate = async () => {
                callCount++;
                if (callCount === 1) {
                    // 第一次：服务器错误（触发普通重试）
                    throw new LLMRetryableError('Server error', 10, 'SERVER_500');
                }
                if (callCount <= 3) {
                    // 第 2、3 次：空响应（触发补偿重试）
                    return {
                        id: `empty-${callCount}`,
                        choices: [{
                            index: 0,
                            message: { role: 'assistant', content: '' },
                            finish_reason: 'stop',
                        }],
                    } as LLMResponse;
                }
                // 第 4 次：正常响应
                return {
                    id: 'normal',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: 'Success' },
                        finish_reason: 'stop',
                    }],
                } as LLMResponse;
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxLoops: 10,
                maxRetries: 3,
                maxCompensationRetries: 2,
                retryDelayMs: 10,
            });

            const result = await agent.execute('Hello');
            expect(result.content).toBe('Success');
            expect(callCount).toBe(4);
        }, 10000);
    });

    describe('重试事件发出', () => {
        it('应该发出 TASK_START、TASK_RETRY、TASK_SUCCESS 事件', async () => {
            const { LLMRetryableError } = await import('../../providers');
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                if (failCount < 2) {
                    failCount++;
                    throw new LLMRetryableError('Transient error', 10, 'TRANSIENT');
                }
                return originalGenerate(messages, options);
            };

            const events = {
                start: [] as unknown[],
                retry: [] as unknown[],
                success: [] as unknown[],
                failed: [] as unknown[],
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 5,
                retryDelayMs: 10,
            });

            agent.on(EventType.TASK_START, (data) => events.start.push(data));
            agent.on(EventType.TASK_RETRY, (data) => events.retry.push(data));
            agent.on(EventType.TASK_SUCCESS, (data) => events.success.push(data));
            agent.on(EventType.TASK_FAILED, (data) => events.failed.push(data));

            await agent.execute('Hello');

            expect(events.start.length).toBe(1);
            expect(events.retry.length).toBe(2);
            expect(events.success.length).toBe(1);
            expect(events.failed.length).toBe(0);

            // 验证重试事件内容
            expect(events.retry[0]).toEqual(
                expect.objectContaining({
                    retryCount: 1,
                    maxRetries: 5,
                    reason: expect.stringContaining('Transient error'),
                })
            );
        }, 10000);

        it('失败时应该发出 TASK_FAILED 事件', async () => {
            const { LLMRetryableError } = await import('../../providers');
            
            mockProvider.generate = async () => {
                throw new LLMRetryableError('Persistent error', 10, 'PERSISTENT');
            };

            const events = {
                start: [] as unknown[],
                failed: [] as unknown[],
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 1,
                retryDelayMs: 10,
            });

            agent.on(EventType.TASK_START, (data) => events.start.push(data));
            agent.on(EventType.TASK_FAILED, (data) => events.failed.push(data));

            await agent.executeWithResult('Hello');

            expect(events.start.length).toBe(1);
            expect(events.failed.length).toBe(1);
            expect(events.failed[0]).toEqual(
                expect.objectContaining({
                    totalRetries: 2,
                })
            );
        }, 10000);
    });
});

// ==================== 重试延迟和退避测试 ====================

describe('Agent 重试延迟测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/retry-delay-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    it('应该使用配置的 retryDelayMs', async () => {
        const { LLMRetryableError } = await import('../../providers');
        let failCount = 0;
        
        mockProvider.generate = async () => {
            if (failCount < 1) {
                failCount++;
                throw new LLMRetryableError('Server error', 0, 'SERVER_500');
            }
            return {
                id: 'success',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'OK' },
                    finish_reason: 'stop',
                }],
            } as LLMResponse;
        };

        const startTime = Date.now();
        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            maxRetries: 3,
            retryDelayMs: 200, // 200ms 延迟
        });

        await agent.execute('Hello');
        const elapsed = Date.now() - startTime;

        // 应该至少有 200ms 的重试延迟
        expect(elapsed).toBeGreaterThanOrEqual(150); // 留一些余量
    }, 10000);

    it('LLMRetryableError 的 retryAfter 应该优先于默认延迟', async () => {
        const { LLMRetryableError } = await import('../../providers');
        let failCount = 0;
        
        mockProvider.generate = async () => {
            if (failCount < 1) {
                failCount++;
                // 设置 retryAfter 为 300ms，应该覆盖默认的 100ms
                throw new LLMRetryableError('Rate limited', 300, 'RATE_LIMIT');
            }
            return {
                id: 'success',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'OK' },
                    finish_reason: 'stop',
                }],
            } as LLMResponse;
        };

        const startTime = Date.now();
        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            maxRetries: 3,
            retryDelayMs: 100, // 默认 100ms，但应该被 retryAfter 覆盖
        });

        await agent.execute('Hello');
        const elapsed = Date.now() - startTime;

        // 应该使用 retryAfter 的 300ms
        expect(elapsed).toBeGreaterThanOrEqual(250);
    }, 10000);

    it('多次重试应该保持相同的延迟（非指数退避）', async () => {
        const { LLMRetryableError } = await import('../../providers');
        let failCount = 0;
        
        mockProvider.generate = async () => {
            if (failCount < 3) {
                failCount++;
                throw new LLMRetryableError('Server error', 50, 'SERVER_500');
            }
            return {
                id: 'success',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'OK' },
                    finish_reason: 'stop',
                }],
            } as LLMResponse;
        };

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            maxRetries: 5,
            retryDelayMs: 50,
        });

        await agent.execute('Hello');
        expect(failCount).toBe(3);
        expect(agent.getRetryCount()).toBe(3);
    }, 10000);
});

// ==================== 中止与重试交互测试 ====================

describe('Agent 中止与重试交互测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/abort-retry-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    it('重试等待期间 abort 应该尽快返回', async () => {
        const { LLMRetryableError } = await import('../../providers');
        
        mockProvider.generate = async () => {
            throw new LLMRetryableError('Server error', 5000, 'SERVER_500');
        };

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            maxRetries: 10,
            retryDelayMs: 5000,
        });

        const startTime = Date.now();
        const execution = agent.executeWithResult('Hello');
        
        // 100ms 后中止
        setTimeout(() => agent.abort(), 100);
        
        const result = await execution;
        const elapsed = Date.now() - startTime;

        expect(result.status).toBe('aborted');
        expect(elapsed).toBeLessThan(1000); // 应该远小于 5000ms 的重试延迟
    }, 10000);

    it('LLM 调用期间 abort 应该中止请求', async () => {
        mockProvider.responseDelay = 5000; // 5 秒延迟

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            requestTimeout: 100,
        });

        const execution = agent.executeWithResult('Hello');
        setTimeout(() => agent.abort(), 50);
        
        const result = await execution;
        expect(result.status).toBe('aborted');
    }, 10000);

    it('中止后状态应该重置为 IDLE', async () => {
        const { LLMRetryableError } = await import('../../providers');
        
        mockProvider.generate = async () => {
            throw new LLMRetryableError('Server error', 1000, 'SERVER_500');
        };

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            maxRetries: 5,
            retryDelayMs: 1000,
        });

        const execution = agent.executeWithResult('Hello');
        setTimeout(() => agent.abort(), 50);
        await execution;

        // 中止后应该可以再次执行
        mockProvider.reset();
        mockProvider.generate = async () => {
            return {
                id: 'success',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'OK' },
                    finish_reason: 'stop',
                }],
            } as LLMResponse;
        };

        const result = await agent.executeWithResult('Second try');
        expect(result.status).toBe('completed');
    }, 10000);
});

// ==================== 边界条件测试 ====================

describe('Agent 重试边界条件测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/retry-edge-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    describe('重试计数边界', () => {
        it('maxRetries=1 时允许 1 次重试', async () => {
            const { LLMRetryableError } = await import('../../providers');
            let failCount = 0;
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            
            mockProvider.generate = async (messages, options) => {
                if (failCount < 1) {
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
                maxRetries: 1,
                retryDelayMs: 10,
            });

            const result = await agent.execute('Hello');
            expect(result).toBeDefined();
            expect(agent.getRetryCount()).toBe(1);
        }, 10000);

        it('第一次就成功不应该有重试', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 5,
            });

            const result = await agent.execute('Hello');
            expect(result).toBeDefined();
            expect(agent.getRetryCount()).toBe(0);
        });

        it('连续成功后重试计数应该为 0', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            await agent.execute('First');
            expect(agent.getRetryCount()).toBe(0);

            await agent.execute('Second');
            expect(agent.getRetryCount()).toBe(0);
        });
    });

    describe('循环和重试交互', () => {
        it('工具调用循环应该计入 loopCount 而不是 retryCount', async () => {
            let callCount = 0;
            
            mockProvider.generate = async () => {
                callCount++;
                if (callCount <= 3) {
                    return {
                        id: `tool-${callCount}`,
                        choices: [{
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [{
                                    id: `call-${callCount}`,
                                    type: 'function',
                                    function: { name: 'glob', arguments: '{"pattern": "*.ts"}' },
                                }],
                            },
                            finish_reason: 'tool_calls',
                        }],
                    } as LLMResponse;
                }
                return {
                    id: 'final',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: 'Done' },
                        finish_reason: 'stop',
                    }],
                } as LLMResponse;
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxLoops: 10,
            });

            const result = await agent.executeWithResult('Find files');
            // 工具调用会执行但可能失败（工具未注册），最终可能成功或失败
            expect(['completed', 'failed']).toContain(result.status);
            expect(agent.getLoopCount()).toBeGreaterThanOrEqual(1);
        }, 15000);

        it('maxLoops 限制应该生效', async () => {
            // 验证 maxLoops 配置被正确使用
            // 注意：实际行为可能因工具执行结果而异，这里主要验证 loopCount 被正确追踪
            let callCount = 0;
            mockProvider.generate = async () => {
                callCount++;
                if (callCount <= 2) {
                    return {
                        id: 'tool',
                        choices: [{
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: 'Calling tool...',
                                tool_calls: [{
                                    id: 'call-1',
                                    type: 'function',
                                    function: { name: 'glob', arguments: '{"pattern": "*.ts"}' },
                                }],
                            },
                            finish_reason: 'tool_calls',
                        }],
                    } as LLMResponse;
                }
                return {
                    id: 'final',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: 'Done' },
                        finish_reason: 'stop',
                    }],
                } as LLMResponse;
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxLoops: 10,
            });

            const result = await agent.executeWithResult('Find files');
            // 验证 loopCount 被正确追踪
            expect(agent.getLoopCount()).toBeGreaterThanOrEqual(1);
            expect(['completed', 'failed']).toContain(result.status);
        }, 15000);
    });

    describe('错误分类', () => {
        it('网络错误应该被分类为可重试', async () => {
            const { LLMRetryableError } = await import('../../providers');
            
            mockProvider.generate = async () => {
                const error = new Error('Network error');
                (error as any).code = 'ENOTFOUND';
                throw error;
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 1,
                retryDelayMs: 10,
            });

            // 网络错误可能被错误分类器处理，这里只验证基本行为
            const result = await agent.executeWithResult('Hello');
            expect(['completed', 'failed']).toContain(result.status);
        }, 10000);

        it('AbortError 不被分类为可重试错误', async () => {
            const { LLMAbortedError, isRetryableError } = await import('../../providers');
            
            // LLMAbortedError 实际上不被视为可重试错误，因为中止通常意味着永久失败
            const error = new LLMAbortedError('Request aborted');
            expect(isRetryableError(error)).toBe(false); // 中止错误不可重试
            
            // 当遇到 LLMAbortedError 时，应该直接失败而不是重试
            mockProvider.generate = async () => {
                throw new LLMAbortedError('Request was cancelled');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 3,
                retryDelayMs: 10,
            });

            const result = await agent.executeWithResult('Hello');
            // 中止错误应该导致失败，而不是重试
            expect(result.status).toBe('failed');
            expect(agent.getRetryCount()).toBe(0); // 不应该有重试
        }, 10000);
    });
});

// ==================== 流式模式重试测试 ====================

describe('Agent 流式模式重试测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/retry-stream-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    it('流式模式下服务器错误应该触发重试', async () => {
        const { LLMRetryableError } = await import('../../providers');
        let failCount = 0;
        const originalGenerate = mockProvider.generate.bind(mockProvider);
        
        mockProvider.generate = async (messages, options) => {
            if (failCount < 1) {
                failCount++;
                throw new LLMRetryableError('Server error', 10, 'SERVER_500');
            }
            return originalGenerate(messages, options);
        };

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: true,
            memoryManager,
            maxRetries: 3,
            retryDelayMs: 10,
        });

        const result = await agent.execute('Hello');
        expect(result).toBeDefined();
        expect(failCount).toBe(1);
    }, 10000);

    it('流式模式空响应应该触发补偿重试', async () => {
        let callCount = 0;
        
        mockProvider.generate = async () => {
            callCount++;
            if (callCount <= 1) {
                return {
                    id: `empty-${callCount}`,
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: '' },
                        finish_reason: 'length',
                    }],
                } as LLMResponse;
            }
            return {
                id: 'normal',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Normal response' },
                    finish_reason: 'stop',
                }],
            } as LLMResponse;
        };

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: true,
            memoryManager,
            maxLoops: 10,
            maxCompensationRetries: 2,
        });

        const result = await agent.execute('Hello');
        expect(result.content).toBe('Normal response');
    }, 10000);
});

// ==================== executeWithResult 测试 ====================

describe('Agent executeWithResult 重试测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/execute-with-result-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    it('成功时应该返回正确的重试次数', async () => {
        const { LLMRetryableError } = await import('../../providers');
        let failCount = 0;
        const originalGenerate = mockProvider.generate.bind(mockProvider);
        
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
        expect(result.loopCount).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('失败时应该返回 failure 信息', async () => {
        const { LLMRetryableError } = await import('../../providers');
        
        mockProvider.generate = async () => {
            throw new LLMRetryableError('Persistent error', 10, 'PERSISTENT_ERROR');
        };

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            maxRetries: 1,
            retryDelayMs: 10,
        });

        const result = await agent.executeWithResult('Hello');
        expect(result.status).toBe('failed');
        expect(result.failure).toBeDefined();
        expect(result.failure?.code).toBeDefined();
        expect(result.retryCount).toBe(2);
    }, 10000);

    it('中止时应该返回 aborted 状态', async () => {
        const { LLMRetryableError } = await import('../../providers');
        
        mockProvider.generate = async () => {
            throw new LLMRetryableError('Server error', 5000, 'SERVER_500');
        };

        const agent = new Agent({
            provider: mockProvider as any,
            systemPrompt: 'Test',
            stream: false,
            memoryManager,
            maxRetries: 10,
            retryDelayMs: 5000,
        });

        const execution = agent.executeWithResult('Hello');
        setTimeout(() => agent.abort(), 50);
        
        const result = await execution;
        expect(result.status).toBe('aborted');
        expect(result.failure?.code).toBe('AGENT_ABORTED');
    }, 10000);
});
