/**
 * Agent 错误处理全面测试
 *
 * 测试目标：
 * 1. 错误码常量和类型
 * 2. 专用错误子类
 * 3. 错误分类器
 * 4. Agent 中错误抛出和捕获
 * 5. 类型守卫函数
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from './agent';
import { AgentStatus } from './types';
import { createMemoryManager } from '../memory';
import type { LLMResponse } from '../../providers/types';

// 导入错误类和常量
import {
    AgentError,
    AgentErrorCode,
    AgentAbortedError,
    AgentBusyError,
    AgentMaxRetriesExceededError,
    AgentLoopExceededError,
    AgentConfigurationError,
    AgentValidationError,
    LLMRequestError,
    LLMResponseInvalidError,
    ToolError,
    LLMRetryableError,
    isAgentError,
    isAgentAbortedError,
    isAgentBusyError,
    isAgentMaxRetriesExceededError,
    isAgentLoopExceededError,
    isAgentConfigurationError,
    isAgentValidationError,
    isLLMRequestError,
    isLLMResponseInvalidError,
    isToolError,
    isLLMRetryableError,
    hasValidFailureCode,
} from './errors';

import { ErrorClassifier } from './error-classifier';
import { AGENT_FAILURE_CODES, AgentFailureCode } from './types';

// Mock Provider
class MockProvider {
    public callCount = 0;
    public errorToThrow: Error | null = null;
    public customResponses: Partial<LLMResponse>[] = [];
    public responseIndex = 0;
    public responseDelay = 0;

    async generate(messages: unknown[]) {
        this.callCount++;

        // 模拟延迟
        if (this.responseDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.responseDelay));
        }

        if (this.errorToThrow) {
            const error = this.errorToThrow;
            this.errorToThrow = null;
            throw error;
        }

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
            choices: [
                {
                    index: 0,
                    message: { role: 'assistant', content: 'Hello!' },
                    finish_reason: 'stop',
                },
            ],
        } as LLMResponse;
    }

    getTimeTimeout() {
        return 60000;
    }

    reset() {
        this.callCount = 0;
        this.errorToThrow = null;
        this.responseDelay = 0;
        this.customResponses = [];
        this.responseIndex = 0;
    }
}

// ==================== 错误码常量测试 ====================

describe('AgentErrorCode 常量测试', () => {
    it('应该定义所有必要的错误码', () => {
        expect(AgentErrorCode.ABORTED).toBe('AGENT_ABORTED');
        expect(AgentErrorCode.BUSY).toBe('AGENT_BUSY');
        expect(AgentErrorCode.RUNTIME_ERROR).toBe('AGENT_RUNTIME_ERROR');
        expect(AgentErrorCode.MAX_RETRIES_EXCEEDED).toBe('AGENT_MAX_RETRIES_EXCEEDED');
        expect(AgentErrorCode.LOOP_EXCEEDED).toBe('AGENT_LOOP_EXCEEDED');
        expect(AgentErrorCode.CONFIGURATION_ERROR).toBe('AGENT_CONFIGURATION_ERROR');
        expect(AgentErrorCode.VALIDATION_ERROR).toBe('AGENT_VALIDATION_ERROR');
        expect(AgentErrorCode.LLM_TIMEOUT).toBe('LLM_TIMEOUT');
        expect(AgentErrorCode.LLM_REQUEST_FAILED).toBe('LLM_REQUEST_FAILED');
        expect(AgentErrorCode.LLM_RESPONSE_INVALID).toBe('LLM_RESPONSE_INVALID');
        expect(AgentErrorCode.TOOL_EXECUTION_FAILED).toBe('TOOL_EXECUTION_FAILED');
    });

    it('AGENT_FAILURE_CODES 应该包含所有有效的错误码', () => {
        expect(AGENT_FAILURE_CODES).toContain('AGENT_ABORTED');
        expect(AGENT_FAILURE_CODES).toContain('AGENT_BUSY');
        expect(AGENT_FAILURE_CODES).toContain('AGENT_RUNTIME_ERROR');
        expect(AGENT_FAILURE_CODES).toContain('AGENT_MAX_RETRIES_EXCEEDED');
        expect(AGENT_FAILURE_CODES).toContain('AGENT_LOOP_EXCEEDED');
        expect(AGENT_FAILURE_CODES).toContain('AGENT_CONFIGURATION_ERROR');
        expect(AGENT_FAILURE_CODES).toContain('AGENT_VALIDATION_ERROR');
        expect(AGENT_FAILURE_CODES).toContain('LLM_TIMEOUT');
        expect(AGENT_FAILURE_CODES).toContain('LLM_REQUEST_FAILED');
        expect(AGENT_FAILURE_CODES).toContain('LLM_RESPONSE_INVALID');
        expect(AGENT_FAILURE_CODES).toContain('TOOL_EXECUTION_FAILED');
    });
});

// ==================== 专用错误子类测试 ====================

describe('专用错误子类测试', () => {
    describe('AgentAbortedError', () => {
        it('应该有正确的 name 和 code', () => {
            const error = new AgentAbortedError();
            expect(error.name).toBe('AgentAbortedError');
            expect(error.code).toBe('AGENT_ABORTED');
            expect(error.message).toBe('Task was aborted.');
        });

        it('应该支持自定义消息', () => {
            const error = new AgentAbortedError('User cancelled the task');
            expect(error.message).toBe('User cancelled the task');
        });

        it('应该是 AgentError 的实例', () => {
            const error = new AgentAbortedError();
            expect(error instanceof AgentError).toBe(true);
            expect(isAgentError(error)).toBe(true);
            expect(isAgentAbortedError(error)).toBe(true);
        });
    });

    describe('AgentBusyError', () => {
        it('应该有正确的 name、code 和消息', () => {
            const error = new AgentBusyError('RUNNING');
            expect(error.name).toBe('AgentBusyError');
            expect(error.code).toBe('AGENT_BUSY');
            expect(error.message).toBe('Agent is not idle, current status: RUNNING');
        });

        it('应该是 AgentError 的实例', () => {
            const error = new AgentBusyError('THINKING');
            expect(error instanceof AgentError).toBe(true);
            expect(isAgentBusyError(error)).toBe(true);
        });
    });

    describe('AgentMaxRetriesExceededError', () => {
        it('应该有正确的 name 和 code（无原因）', () => {
            const error = new AgentMaxRetriesExceededError();
            expect(error.name).toBe('AgentMaxRetriesExceededError');
            expect(error.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');
            expect(error.message).toBe('Agent failed after maximum retries.');
        });

        it('应该支持包含原因', () => {
            const error = new AgentMaxRetriesExceededError('Last error: TIMEOUT');
            expect(error.message).toBe('Agent failed after maximum retries. Last error: TIMEOUT');
        });

        it('应该是 AgentError 的实例', () => {
            const error = new AgentMaxRetriesExceededError();
            expect(isAgentMaxRetriesExceededError(error)).toBe(true);
        });
    });

    describe('AgentLoopExceededError', () => {
        it('应该有正确的 name、code 和消息', () => {
            const error = new AgentLoopExceededError(100);
            expect(error.name).toBe('AgentLoopExceededError');
            expect(error.code).toBe('AGENT_LOOP_EXCEEDED');
            expect(error.message).toBe('Agent exceeded maximum loop count (100).');
        });

        it('应该是 AgentError 的实例', () => {
            const error = new AgentLoopExceededError(50);
            expect(isAgentLoopExceededError(error)).toBe(true);
        });
    });

    describe('AgentConfigurationError', () => {
        it('应该有正确的 name、code 和消息', () => {
            const error = new AgentConfigurationError('Provider is required');
            expect(error.name).toBe('AgentConfigurationError');
            expect(error.code).toBe('AGENT_CONFIGURATION_ERROR');
            expect(error.message).toBe('Provider is required');
        });

        it('应该是 AgentError 的实例', () => {
            const error = new AgentConfigurationError('Test');
            expect(isAgentConfigurationError(error)).toBe(true);
        });
    });

    describe('AgentValidationError', () => {
        it('应该有正确的 name、code 和消息', () => {
            const error = new AgentValidationError('Input cannot be empty');
            expect(error.name).toBe('AgentValidationError');
            expect(error.code).toBe('AGENT_VALIDATION_ERROR');
            expect(error.message).toBe('Input cannot be empty');
        });

        it('应该是 AgentError 的实例', () => {
            const error = new AgentValidationError('Test');
            expect(isAgentValidationError(error)).toBe(true);
        });
    });

    describe('LLMRequestError', () => {
        it('应该有正确的 name、code 和消息', () => {
            const error = new LLMRequestError('No valid messages to send to LLM');
            expect(error.name).toBe('LLMRequestError');
            expect(error.code).toBe('LLM_REQUEST_FAILED');
            expect(error.message).toBe('No valid messages to send to LLM');
        });

        it('应该是 AgentError 的实例', () => {
            const error = new LLMRequestError('Test');
            expect(isLLMRequestError(error)).toBe(true);
        });
    });

    describe('LLMResponseInvalidError', () => {
        it('应该有正确的 name、code 和默认消息', () => {
            const error = new LLMResponseInvalidError();
            expect(error.name).toBe('LLMResponseInvalidError');
            expect(error.code).toBe('LLM_RESPONSE_INVALID');
            expect(error.message).toBe('LLM response is invalid');
        });

        it('应该支持自定义消息', () => {
            const error = new LLMResponseInvalidError('LLM response missing choices');
            expect(error.message).toBe('LLM response missing choices');
        });

        it('应该是 AgentError 的实例', () => {
            const error = new LLMResponseInvalidError();
            expect(isLLMResponseInvalidError(error)).toBe(true);
        });
    });

    describe('ToolError', () => {
        it('应该有正确的默认 code', () => {
            const error = new ToolError('Tool failed');
            expect(error.name).toBe('ToolError');
            expect(error.code).toBe('TOOL_EXECUTION_FAILED');
        });

        it('应该支持自定义 code', () => {
            const error = new ToolError('Custom error', { code: 'CUSTOM_TOOL_ERROR' });
            expect(error.code).toBe('CUSTOM_TOOL_ERROR');
        });
    });

    describe('LLMRetryableError', () => {
        it('应该有正确的属性', () => {
            const error = new LLMRetryableError('Server error', 5000, 'TIMEOUT');
            expect(error.name).toBe('LLMRetryableError');
            expect(error.code).toBe('LLM_RETRYABLE');
            expect(error.retryAfter).toBe(5000);
            expect(error.errorType).toBe('TIMEOUT');
        });

        it('static timeout() 应该创建正确的错误', () => {
            const error = LLMRetryableError.timeout(30000);
            expect(error.message).toContain('30000ms');
            expect(error.retryAfter).toBe(5000);
            expect(error.errorType).toBe('TIMEOUT');
        });

        it('static rateLimit() 应该创建正确的错误', () => {
            const error = LLMRetryableError.rateLimit(60000);
            expect(error.message).toBe('Rate limit exceeded');
            expect(error.retryAfter).toBe(60000);
            expect(error.errorType).toBe('RATE_LIMIT');
        });
    });
});

// ==================== 类型守卫测试 ====================

describe('类型守卫函数测试', () => {
    it('isAgentError 应该正确识别', () => {
        expect(isAgentError(new AgentError('test'))).toBe(true);
        expect(isAgentError(new AgentAbortedError())).toBe(true);
        expect(isAgentError(new Error('test'))).toBe(false);
        expect(isAgentError(null)).toBe(false);
        expect(isAgentError('string')).toBe(false);
    });

    it('isAgentAbortedError 应该正确识别', () => {
        expect(isAgentAbortedError(new AgentAbortedError())).toBe(true);
        expect(isAgentAbortedError(new AgentError('aborted'))).toBe(false);
    });

    it('isAgentBusyError 应该正确识别', () => {
        expect(isAgentBusyError(new AgentBusyError('RUNNING'))).toBe(true);
        expect(isAgentBusyError(new AgentError('busy'))).toBe(false);
    });

    it('isAgentMaxRetriesExceededError 应该正确识别', () => {
        expect(isAgentMaxRetriesExceededError(new AgentMaxRetriesExceededError())).toBe(true);
        expect(isAgentMaxRetriesExceededError(new AgentError('maximum retries'))).toBe(false);
    });

    it('isToolError 应该正确识别', () => {
        expect(isToolError(new ToolError('test'))).toBe(true);
        expect(isToolError(new AgentError('test'))).toBe(false);
    });

    it('isLLMRetryableError 应该正确识别', () => {
        expect(isLLMRetryableError(new LLMRetryableError('test'))).toBe(true);
        expect(isLLMRetryableError(new Error('test'))).toBe(false);
    });

    describe('hasValidFailureCode', () => {
        it('应该识别有效的 AgentError code', () => {
            const error = new AgentError('test', { code: 'AGENT_ABORTED' });
            expect(hasValidFailureCode(error)).toBe(true);
        });

        it('应该拒绝无效的 code', () => {
            const error = new AgentError('test', { code: 'INVALID_CODE' });
            expect(hasValidFailureCode(error)).toBe(false);
        });

        it('应该拒绝没有 code 的 AgentError', () => {
            const error = new AgentError('test');
            expect(hasValidFailureCode(error)).toBe(false);
        });

        it('应该拒绝非 AgentError', () => {
            expect(hasValidFailureCode(new Error('test'))).toBe(false);
            expect(hasValidFailureCode(null)).toBe(false);
        });

        it('应该识别专用子类的 code', () => {
            expect(hasValidFailureCode(new AgentAbortedError())).toBe(true);
            expect(hasValidFailureCode(new AgentBusyError('RUNNING'))).toBe(true);
            expect(hasValidFailureCode(new AgentMaxRetriesExceededError())).toBe(true);
        });
    });
});

// ==================== 错误分类器测试 ====================

describe('ErrorClassifier 测试', () => {
    let classifier: ErrorClassifier;

    beforeEach(() => {
        classifier = new ErrorClassifier();
    });

    describe('classifyFailureCode - 专用子类识别', () => {
        it('应该识别 AgentAbortedError', () => {
            const code = classifier.classifyFailureCode(new AgentAbortedError());
            expect(code).toBe('AGENT_ABORTED');
        });

        it('应该识别 AgentBusyError', () => {
            const code = classifier.classifyFailureCode(new AgentBusyError('RUNNING'));
            expect(code).toBe('AGENT_BUSY');
        });

        it('应该识别 AgentMaxRetriesExceededError', () => {
            const code = classifier.classifyFailureCode(new AgentMaxRetriesExceededError());
            expect(code).toBe('AGENT_MAX_RETRIES_EXCEEDED');
        });

        it('应该识别 AgentLoopExceededError', () => {
            const code = classifier.classifyFailureCode(new AgentLoopExceededError(100));
            expect(code).toBe('AGENT_LOOP_EXCEEDED');
        });

        it('应该识别 AgentConfigurationError', () => {
            const code = classifier.classifyFailureCode(new AgentConfigurationError('test'));
            expect(code).toBe('AGENT_CONFIGURATION_ERROR');
        });

        it('应该识别 AgentValidationError', () => {
            const code = classifier.classifyFailureCode(new AgentValidationError('test'));
            expect(code).toBe('AGENT_VALIDATION_ERROR');
        });

        it('应该识别 LLMRequestError', () => {
            const code = classifier.classifyFailureCode(new LLMRequestError('test'));
            expect(code).toBe('LLM_REQUEST_FAILED');
        });

        it('应该识别 LLMResponseInvalidError', () => {
            const code = classifier.classifyFailureCode(new LLMResponseInvalidError());
            expect(code).toBe('LLM_RESPONSE_INVALID');
        });

        it('应该识别 ToolError', () => {
            const code = classifier.classifyFailureCode(new ToolError('test'));
            expect(code).toBe('TOOL_EXECUTION_FAILED');
        });
    });

    describe('classifyFailureCode - AgentError.code 属性', () => {
        it('应该使用 AgentError 的 code 属性', () => {
            const error = new AgentError('test', { code: 'AGENT_CONFIGURATION_ERROR' });
            const code = classifier.classifyFailureCode(error);
            expect(code).toBe('AGENT_CONFIGURATION_ERROR');
        });
    });

    describe('classifyFailureCode - 状态检查', () => {
        it('状态为 ABORTED 时应该返回 AGENT_ABORTED', () => {
            const code = classifier.classifyFailureCode(new Error('test'), AgentStatus.ABORTED);
            expect(code).toBe('AGENT_ABORTED');
        });
    });

    describe('classifyFailureCode - 超时错误', () => {
        it('应该识别超时类错误', () => {
            const error = new Error('Request timeout');
            const code = classifier.classifyFailureCode(error);
            expect(code).toBe('LLM_TIMEOUT');
        });

        it('应该识别 timed out 消息', () => {
            const error = new Error('Connection timed out');
            const code = classifier.classifyFailureCode(error);
            expect(code).toBe('LLM_TIMEOUT');
        });
    });

    describe('classifyFailureCode - 默认值', () => {
        it('未知错误应该返回 AGENT_RUNTIME_ERROR', () => {
            const code = classifier.classifyFailureCode(new Error('Unknown error'));
            expect(code).toBe('AGENT_RUNTIME_ERROR');
        });

        it('null 应该返回 AGENT_RUNTIME_ERROR', () => {
            const code = classifier.classifyFailureCode(null);
            expect(code).toBe('AGENT_RUNTIME_ERROR');
        });

        it('字符串应该返回 AGENT_RUNTIME_ERROR', () => {
            const code = classifier.classifyFailureCode('error string');
            expect(code).toBe('AGENT_RUNTIME_ERROR');
        });
    });

    describe('sanitizeError', () => {
        it('AgentError 应该返回原始消息', () => {
            const safe = classifier.sanitizeError(new AgentError('Test error'));
            expect(safe.userMessage).toBe('Test error');
            expect(safe.internalMessage).toBeDefined();
        });

        it('ToolError 应该返回用户友好的消息', () => {
            const safe = classifier.sanitizeError(new ToolError('Internal tool error'));
            expect(safe.userMessage).toBe('Tool execution failed. Please try again.');
            expect(safe.internalMessage).toBe('Internal tool error');
        });

        it('普通 Error 应该返回通用消息', () => {
            const safe = classifier.sanitizeError(new Error('Some error'));
            expect(safe.userMessage).toBe('An unexpected error occurred. Please try again.');
            expect(safe.internalMessage).toBe('Some error');
        });

        it('非 Error 对象应该返回通用消息', () => {
            const safe = classifier.sanitizeError('string error');
            expect(safe.userMessage).toBe('An unexpected error occurred. Please try again.');
            expect(safe.internalMessage).toBe('string error');
        });
    });

    describe('buildFailure', () => {
        it('应该构建完整的失败对象', () => {
            const failure = classifier.buildFailure(new AgentAbortedError());
            expect(failure.code).toBe('AGENT_ABORTED');
            expect(failure.userMessage).toBe('Task was aborted.');
            expect(failure.internalMessage).toBeDefined();
        });

        it('应该包含状态信息', () => {
            const failure = classifier.buildFailure(new Error('test'), AgentStatus.ABORTED);
            expect(failure.code).toBe('AGENT_ABORTED');
        });
    });

    describe('isValidFailureCode', () => {
        it('应该识别有效的错误码', () => {
            expect(classifier.isValidFailureCode('AGENT_ABORTED')).toBe(true);
            expect(classifier.isValidFailureCode('AGENT_BUSY')).toBe(true);
            expect(classifier.isValidFailureCode('LLM_TIMEOUT')).toBe(true);
        });

        it('应该拒绝无效的错误码', () => {
            expect(classifier.isValidFailureCode('INVALID_CODE')).toBe(false);
            expect(classifier.isValidFailureCode('')).toBe(false);
        });
    });
});

// ==================== Agent 错误抛出测试 ====================

describe('Agent 错误抛出测试', () => {
    let mockProvider: MockProvider;
    let memoryManager: ReturnType<typeof createMemoryManager>;

    beforeEach(async () => {
        mockProvider = new MockProvider();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: './test-memory/error-test-' + Date.now(),
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        mockProvider.reset();
    });

    describe('配置错误', () => {
        it('缺少 provider 应该抛出 AgentConfigurationError', () => {
            expect(() => {
                new Agent({
                    provider: null as any,
                    systemPrompt: 'Test',
                });
            }).toThrow(AgentConfigurationError);
        });
    });

    describe('验证错误', () => {
        it('空输入应该抛出 AgentValidationError', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            await expect(agent.execute('')).rejects.toThrow(AgentValidationError);
        });

        it('纯空白输入应该抛出 AgentValidationError', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            await expect(agent.execute('   ')).rejects.toThrow(AgentValidationError);
        });
    });

    describe('忙碌错误', () => {
        it('忙碌时执行应该抛出 AgentBusyError', async () => {
            // 使用足够长的延迟确保第一次请求还在执行
            mockProvider.responseDelay = 3000;

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const firstExecution = agent.execute('First');

            // 等待一小段时间确保第一次执行已经开始
            await new Promise((resolve) => setTimeout(resolve, 200));

            // 第二次执行应该被拒绝
            try {
                await agent.execute('Second');
                expect.fail('Should have thrown AgentBusyError');
            } catch (error) {
                expect(error).toBeInstanceOf(AgentBusyError);
            }

            await firstExecution;
        }, 10000);
    });

    describe('中止错误', () => {
        it('中止后状态应该是 ABORTED', async () => {
            // 使用一个持续抛出错误的 Provider 来模拟长时间运行
            const { LLMRetryableError: ProviderLLMRetryableError } = await import('../../providers');
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            mockProvider.generate = async () => {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                throw new ProviderLLMRetryableError('Retry later', 1000, 'RATE_LIMIT');
            };

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxRetries: 10,
                retryDelayMs: 1000,
            });

            const execution = agent.executeWithResult('Hello');

            // 等待一小段时间后中止
            setTimeout(() => agent.abort(), 100);

            const result = await execution;
            expect(result.status).toBe('aborted');
            expect(result.failure?.code).toBe('AGENT_ABORTED');

            // 恢复原始 generate
            mockProvider.generate = originalGenerate;
        }, 10000);
    });

    describe('重试超过限制错误', () => {
        it('超过最大重试次数应该抛出 AgentMaxRetriesExceededError', async () => {
            const { LLMRetryableError: ProviderLLMRetryableError } = await import('../../providers');

            // 每次调用都抛出错误（不重置）
            const originalGenerate = mockProvider.generate.bind(mockProvider);
            mockProvider.generate = async () => {
                throw new ProviderLLMRetryableError('Server error', 10, 'SERVER_500');
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
            expect(result.failure?.code).toBe('AGENT_MAX_RETRIES_EXCEEDED');

            // 恢复原始 generate
            mockProvider.generate = originalGenerate;
        }, 10000);
    });

    describe('空响应持续重试超过限制错误', () => {
        it('在未完成时达到 maxLoops 应该返回 AGENT_LOOP_EXCEEDED', async () => {
            mockProvider.customResponses = [
                {
                    choices: [
                        {
                            index: 0,
                            message: { role: 'assistant', content: '' },
                            finish_reason: 'stop',
                        },
                    ],
                },
                {
                    choices: [
                        {
                            index: 0,
                            message: { role: 'assistant', content: '' },
                            finish_reason: 'stop',
                        },
                    ],
                },
            ];

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
                maxLoops: 10,
            });

            const result = await agent.executeWithResult('Hello');
            expect(result.status).toBe('failed');
            expect(result.failure?.code).toBe('AGENT_LOOP_EXCEEDED');
        }, 10000);
    });

    describe('LLM 响应错误', () => {
        it('LLM 返回空响应应该抛出 LLMResponseInvalidError', async () => {
            mockProvider.customResponses = [
                {
                    id: 'test',
                    choices: [], // 空的 choices
                },
            ];

            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const result = await agent.executeWithResult('Hello');
            expect(result.status).toBe('failed');
            expect(result.failure?.code).toBe('LLM_RESPONSE_INVALID');
        }, 10000);
    });

    describe('成功场景', () => {
        it('正常执行应该返回 completed 状态', async () => {
            const agent = new Agent({
                provider: mockProvider as any,
                systemPrompt: 'Test',
                stream: false,
                memoryManager,
            });

            const result = await agent.executeWithResult('Hello');
            expect(result.status).toBe('completed');
            expect(result.failure).toBeUndefined();
        });
    });
});

// ==================== 向后兼容性测试 ====================

describe('向后兼容性测试', () => {
    let classifier: ErrorClassifier;

    beforeEach(() => {
        classifier = new ErrorClassifier();
    });

    it('旧的 AgentError（无 code）应该通过消息匹配分类', () => {
        // 注意：消息不能包含 "timeout" 关键词，否则会被识别为 LLM_TIMEOUT
        const error = new AgentError('Agent failed after maximum retries.');
        const code = classifier.classifyFailureCode(error);
        expect(code).toBe('AGENT_MAX_RETRIES_EXCEEDED');
    });

    it('旧的 AgentError 包含 abort 应该返回 AGENT_ABORTED', () => {
        const error = new AgentError('Task was aborted by user');
        const code = classifier.classifyFailureCode(error);
        expect(code).toBe('AGENT_ABORTED');
    });

    it('旧的 AgentError 包含 "not idle" 应该返回 AGENT_BUSY', () => {
        const error = new AgentError('Agent is not idle, current status: RUNNING');
        const code = classifier.classifyFailureCode(error);
        expect(code).toBe('AGENT_BUSY');
    });
});
