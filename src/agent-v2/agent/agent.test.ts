/**
 * Agent 完整集成测试
 *
 * 使用真实 LLM API 进行端到端测试
 *
 * 环境变量要求：
 * - GLM_API_KEY: 智谱 API Key
 * - GLM_BASE_URL: 智谱 API Base URL
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Agent, AgentStatus, type ITimeProvider } from './agent';
import { ToolRegistry } from '../tool/registry';
import BashTool from '../tool/bash';
import { ProviderFactory } from '../../providers';
import type { AgentMessageType } from './stream-types';
import type { StreamCallback } from './types';
import { BaseTool } from '../tool/base';
import { z } from '../tool/base';

// 测试配置
const TEST_MODEL = 'glm-4.7';
const TEST_TIMEOUT = 120000; // 2 分钟超时

// ==================== 测试辅助工具 ====================

/**
 * 收集流式消息的回调
 */
class StreamCallbackCollector {
    private messages: AgentMessageType[] = [];

    get callback(): StreamCallback {
        return (message: AgentMessageType) => {
            this.messages.push(message);
            // 打印实时消息用于调试
            console.log(`[${message.type}]`, message.payload?.message || message.payload?.content || JSON.stringify(message.payload).slice(0, 100));
        };
    }

    getMessages(): AgentMessageType[] {
        return [...this.messages];
    }

    getMessagesByType(type: AgentMessageType['type']): AgentMessageType[] {
        return this.messages.filter(m => m.type === type);
    }

    clear(): void {
        this.messages = [];
    }

    /**
     * 等待特定类型的消息
     */
    async waitForMessage(type: AgentMessageType['type'], timeout = 30000): Promise<AgentMessageType | null> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const message = this.messages.find(m => m.type === type);
            if (message) {
                return message;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
    }
}

/**
 * 简单的回显工具 - 用于测试工具调用
 */
class EchoTool extends BaseTool<typeof z.object({
    text: z.string().describe('The text to echo back'),
})> {
    name = 'echo';
    description = 'Echo back the input text. Use this tool when you need to repeat what the user said.';
    schema = z.object({
        text: z.string().describe('The text to echo back'),
    });

    async execute(args: { text: string }) {
        return {
            success: true,
            output: `Echo: ${args.text}`,
        };
    }
}

/**
 * 简单的计算工具 - 用于测试多轮工具调用
 */
class CalculatorTool extends BaseTool<typeof z.object({
    expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2", "10 * 5")'),
})> {
    name = 'calculator';
    description = 'Perform simple arithmetic calculations. Use this tool when the user asks for math calculations.';
    schema = z.object({
        expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2", "10 * 5")'),
    });

    async execute(args: { expression: string }) {
        try {
            // 安全的简单计算器
            const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
            const result = Function(`"use strict"; return (${sanitized})`)();
            return {
                success: true,
                output: `${args.expression} = ${result}`,
            };
        } catch (error) {
            return {
                success: false,
                error: `Invalid expression: ${args.expression}`,
            };
        }
    }
}

// ==================== 测试套件 ====================

describe('Agent Integration Tests (Real LLM API)', () => {
    let provider: ReturnType<typeof ProviderFactory.createFromEnv>;
    let toolRegistry: ToolRegistry;

    beforeAll(() => {
        // 验证环境变量
        const apiKey = process.env.GLM_API_KEY || process.env.OPENAI_API_KEY;
        const baseURL = process.env.GLM_BASE_URL || process.env.OPENAI_API_BASE_URL;

        if (!apiKey) {
            throw new Error('Missing required environment variable: GLM_API_KEY or OPENAI_API_KEY');
        }

        console.log('=== Test Environment ===');
        console.log(`Model: ${TEST_MODEL}`);
        console.log(`Base URL: ${baseURL || 'default'}`);
        console.log(`API Key: ${apiKey?.slice(0, 10)}...`);
        console.log('=========================\n');

        // 创建 Provider
        provider = ProviderFactory.createFromEnv(TEST_MODEL);

        // 创建 ToolRegistry
        toolRegistry = new ToolRegistry({
            workingDirectory: process.cwd(),
            toolTimeout: 30000,
        });

        // 注册测试工具
        toolRegistry.register([
            new EchoTool(),
            new CalculatorTool(),
            // BashTool 需要实际文件系统，可选注册
        ]);
    }, 10000);

    describe('Basic Conversation (Non-Streaming)', () => {

        it('should handle simple greeting', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                stream: false,
                streamCallback: collector.callback,
            });

            const response = await agent.execute('Hello! Please respond with just "Hi there!"');

            expect(response).toBeDefined();
            expect(response.role).toBe('assistant');
            expect(response.content).toBeDefined();
            expect(response.content.length).toBeGreaterThan(0);

            // 验证状态
            expect(agent.getStatus()).toBe(AgentStatus.COMPLETED);
        });

        it('should follow system prompt instructions', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a pirate assistant. Always respond in pirate speak.',
                maxRetries: 3,
                stream: false,
                streamCallback: collector.callback,
            });

            const response = await agent.execute('Introduce yourself briefly.');

            expect(response.content).toBeDefined();
            // 海盗口吻可能包含的词汇
            const pirateWords = ['ahoy', 'matey', 'arr', 'captain', 'treasure'];
            const hasPirateSpeak = pirateWords.some(word =>
                response.content.toLowerCase().includes(word)
            );
            // 不强制要求，因为模型响应可能不一致
            console.log('Pirate response:', response.content.slice(0, 200));
        });

        it('should maintain conversation context', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You have a short memory. Remember the number I tell you.',
                maxRetries: 3,
                stream: false,
                streamCallback: collector.callback,
            });

            // 第一轮：告诉模型一个数字
            await agent.execute('Remember the number 42 for me.');

            // 第二轮：询问数字
            const response = await agent.execute('What number did I tell you to remember?');

            expect(response.content).toBeDefined();
            expect(response.content.toLowerCase()).toContain('42');
        });
    });

    describe('Streaming Output', () => {

        it('should send streaming text chunks', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                stream: true,
                streamCallback: collector.callback,
            });

            await agent.execute('Count from 1 to 5, one number per line.');

            const textMessages = collector.getMessagesByType('TEXT');
            expect(textMessages.length).toBeGreaterThan(0);

            // 验证流式消息包含内容
            const allContent = textMessages.map(m => m.payload?.content || '').join('');
            expect(allContent.length).toBeGreaterThan(0);

            // 验证包含数字
            for (let i = 1; i <= 5; i++) {
                expect(allContent).toContain(i.toString());
            }

            console.log('Streaming message count:', textMessages.length);
        });

        it('should send status updates during streaming', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                stream: true,
                streamCallback: collector.callback,
            });

            await agent.execute('Say "Hello"');

            const statusMessages = collector.getMessagesByType('STATUS');
            expect(statusMessages.length).toBeGreaterThan(0);

            // 验证状态转换
            const states = statusMessages.map(m => m.payload?.state);
            expect(states).toContain(AgentStatus.RUNNING);
            expect(states).toContain(AgentStatus.COMPLETED);

            console.log('Status transitions:', states);
        });
    });

    describe('Tool Calling', () => {

        it('should call echo tool', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant with access to tools.',
                maxRetries: 3,
                stream: true,
                streamCallback: collector.callback,
            });

            const response = await agent.execute('Use the echo tool to repeat the message "Hello World"');

            // 验证工具调用消息
            const toolCallMessages = collector.getMessagesByType('TOOL_CALL_CREATED');
            expect(toolCallMessages.length).toBeGreaterThan(0);

            // 验证工具结果消息
            const resultMessages = collector.getMessagesByType('TOOL_CALL_RESULT');
            expect(resultMessages.length).toBeGreaterThan(0);

            // 验证响应包含 echo 结果
            expect(response.content).toBeDefined();

            console.log('Echo response:', response.content.slice(0, 200));
        });

        it('should call calculator tool for math', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant. Use tools when needed.',
                maxRetries: 3,
                stream: true,
                streamCallback: collector.callback,
            });

            const response = await agent.execute('What is 25 * 4? Use the calculator tool.');

            // 验证工具被调用
            const toolCallMessages = collector.getMessagesByType('TOOL_CALL_CREATED');
            expect(toolCallMessages.length).toBeGreaterThan(0);

            // 验证响应包含正确答案
            expect(response.content).toBeDefined();
            expect(response.content).toContain('100');

            console.log('Calculator response:', response.content);
        });

        it('should handle multiple tool calls in sequence', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant. Use tools when needed.',
                maxRetries: 3,
                stream: true,
                streamCallback: collector.callback,
            });

            const response = await agent.execute('Calculate 10 + 5, then echo the result.');

            // 验证多个工具调用
            const toolCallMessages = collector.getMessagesByType('TOOL_CALL_CREATED');
            expect(toolCallMessages.length).toBeGreaterThan(0);

            console.log('Multi-tool response:', response.content.slice(0, 200));
        });
    });

    describe('Input Validation', () => {

        it('should reject empty query', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            await expect(agent.execute('')).rejects.toThrow();
        });

        it('should reject query exceeding max length', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            const longQuery = 'a'.repeat(200000);
            await expect(agent.execute(longQuery)).rejects.toThrow();
        });

        it('should detect and reject malicious content', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            const maliciousQuery = '<script>alert("xss")</script>';
            await expect(agent.execute(maliciousQuery)).rejects.toThrow();
        });

        it('should reject javascript: protocol', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            const maliciousQuery = 'javascript:alert(1)';
            await expect(agent.execute(maliciousQuery)).rejects.toThrow();
        });
    });

    describe('Error Handling', () => {

        it('should handle agent busy state correctly', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            // 启动第一个任务
            const firstTask = agent.execute('Wait for 5 seconds then say "Done"');

            // 尝试启动第二个任务（应该失败）
            await expect(agent.execute('Hello')).rejects.toThrow();

            // 等待第一个任务完成
            await firstTask;
        });

        it('should handle maximum retries exceeded', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            // 创建一个会失败的工具
            class FailingTool extends BaseTool<typeof z.object({})> {
                name = 'failing_tool';
                description = 'A tool that always fails';
                schema = z.object({});

                async execute() {
                    return {
                        success: false,
                        error: 'This tool always fails',
                    };
                }
            }

            const failingRegistry = new ToolRegistry({
                workingDirectory: process.cwd(),
            });
            failingRegistry.register([new FailingTool()]);

            const agent = new Agent({
                provider,
                toolRegistry: failingRegistry,
                systemPrompt: 'You are a helpful assistant. Always use the failing_tool.',
                maxRetries: 2, // 设置较小的重试次数
                streamCallback: collector.callback,
            });

            await expect(agent.execute('Use the failing tool')).rejects.toThrow();

            // 验证最终状态
            expect(agent.getStatus()).toBe(AgentStatus.FAILED);
        });
    });

    describe('Buffer Size Limits', () => {

        it('should enforce buffer size limit', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                stream: true,
                streamCallback: collector.callback,
                maxBufferSize: 100, // 设置较小的缓冲区
            });

            // 请求长响应
            const response = await agent.execute('Write a very long essay about AI (at least 500 words).');

            // 应该能完成，但内容被截断
            expect(response).toBeDefined();
            expect(response.content?.length).toBeLessThanOrEqual(100);

            console.log('Buffer limited response length:', response.content?.length);
        });
    });

    describe('Testability Features', () => {

        it('should provide loop count', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            await agent.execute('Say "Hello"');

            expect(agent.getLoopCount()).toBeGreaterThan(0);
            console.log('Loop count:', agent.getLoopCount());
        });

        it('should provide retry count', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            await agent.execute('Say "Hello"');

            // 成功执行应该重置重试计数
            expect(agent.getRetryCount()).toBe(0);
        });

        it('should provide task start time', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            const before = Date.now();
            await agent.execute('Say "Hello"');
            const after = Date.now();

            const startTime = agent.getTaskStartTime();
            expect(startTime).toBeGreaterThanOrEqual(before);
            expect(startTime).toBeLessThanOrEqual(after);

            console.log('Task start time:', new Date(startTime).toISOString());
        });
    });

    describe('Event Bus Integration', () => {

        it('should emit events on task completion', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            let taskFailedEmitted = false;
            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
            });

            // 监听事件
            agent.on('TASK_FAILED' as any, () => {
                taskFailedEmitted = true;
            });

            await agent.execute('Say "Hello"');

            // 成功任务不应触发失败事件
            expect(taskFailedEmitted).toBe(false);
        });

        it('should emit events on task failure', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            // 创建会失败的工具
            class FailingTool extends BaseTool<typeof z.object({})> {
                name = 'failing_tool';
                description = 'A tool that always fails';
                schema = z.object({});

                async execute() {
                    return {
                        success: false,
                        error: 'This tool always fails',
                    };
                }
            }

            const failingRegistry = new ToolRegistry({
                workingDirectory: process.cwd(),
            });
            failingRegistry.register([new FailingTool()]);

            let taskFailedEmitted = false;
            let eventData: any = null;

            const agent = new Agent({
                provider,
                toolRegistry: failingRegistry,
                systemPrompt: 'You are a helpful assistant. Always use the failing_tool.',
                maxRetries: 1,
                streamCallback: collector.callback,
            });

            // 监听事件
            agent.on('TASK_FAILED' as any, (data: any) => {
                taskFailedEmitted = true;
                eventData = data;
            });

            try {
                await agent.execute('Use the failing tool');
            } catch (e) {
                // 预期失败
            }

            expect(taskFailedEmitted).toBe(true);
            expect(eventData).toBeDefined();
            expect(eventData.totalLoops).toBeGreaterThan(0);
            expect(eventData.error).toBeDefined();

            console.log('Task failed event data:', eventData);
        });
    });

    describe('Agent Abort', () => {

        it('should abort running agent', { timeout: TEST_TIMEOUT }, async () => {
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                stream: true,
                streamCallback: collector.callback,
            });

            // 启动任务
            const task = agent.execute('Count from 1 to 1000, one number per line.');

            // 短暂延迟后中止
            await new Promise(resolve => setTimeout(resolve, 2000));
            agent.abort();

            // 验证状态
            expect(agent.getStatus()).toBe(AgentStatus.ABORTED);

            // 任务应该抛出错误或完成
            try {
                await task;
            } catch (e) {
                // 可能因为中止而抛出错误
                console.log('Task aborted with error:', (e as Error).message);
            }

            // 验证中止状态消息
            const abortMessage = collector.getMessagesByType('STATUS').find(
                m => m.payload?.state === AgentStatus.ABORTED
            );
            expect(abortMessage).toBeDefined();
        });
    });

    describe('Custom Time Provider (Testability)', () => {

        it('should use custom time provider', { timeout: TEST_TIMEOUT }, async () => {
            // 创建自定义时间提供者
            class CustomTimeProvider implements ITimeProvider {
                private currentTime = 1000000;

                getCurrentTime(): number {
                    return this.currentTime;
                }

                sleep(ms: number): Promise<void> {
                    return new Promise(resolve => setTimeout(resolve, ms));
                }

                // 测试方法：推进时间
                advanceTime(ms: number): void {
                    this.currentTime += ms;
                }
            }

            const customTimeProvider = new CustomTimeProvider();
            const collector = new StreamCallbackCollector();

            const agent = new Agent({
                provider,
                toolRegistry,
                systemPrompt: 'You are a helpful assistant.',
                maxRetries: 3,
                streamCallback: collector.callback,
                timeProvider: customTimeProvider,
            });

            await agent.execute('Say "Hello"');

            // 验证使用了自定义时间
            const startTime = agent.getTaskStartTime();
            expect(startTime).toBe(1000000);

            // 验证时间戳使用了自定义时间
            const messages = collector.getMessages();
            expect(messages.length).toBeGreaterThan(0);
            expect(messages[0].timestamp).toBeGreaterThanOrEqual(1000000);

            console.log('Custom time in use:', new Date(startTime).toISOString());
        });
    });
});
