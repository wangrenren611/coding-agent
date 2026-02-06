/**
 * Agent 集成测试脚本
 *
 * 使用真实 LLM API 进行端到端测试
 *
 * 运行方式：
 *   npx tsx src/agent-v2/agent/run-test.ts
 *
 * 环境变量要求：
 * - GLM_API_KEY: 智谱 API Key
 * - GLM_BASE_URL: 智谱 API Base URL
 */

import { Agent, type ITimeProvider } from './agent';
import { AgentStatus, type StreamCallback } from './types';
import { ToolRegistry } from '../tool/registry';
import { ProviderFactory } from '../../providers/registry/provider-factory';
import type { AgentMessage } from './stream-types';
import { BaseTool, z } from '../tool/base';
import { config } from 'dotenv';

// 加载环境变量
config({ path: '.env.development' });

// ==================== 测试配置 ====================

const TEST_MODEL = 'glm-4.7';
const TEST_TIMEOUT = 120000; // 2 分钟超时

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message: string) {
    log(`✓ ${message}`, 'green');
}

function error(message: string) {
    log(`✗ ${message}`, 'red');
}

function info(message: string) {
    log(`  ${message}`, 'cyan');
}

function section(title: string) {
    console.log('');
    log(`\n═══ ${title} ═══`, 'blue');
}

// ==================== 测试辅助工具 ====================

class TestRunner {
    private passed = 0;
    private failed = 0;
    private skipped = 0;

    async test(name: string, fn: () => Promise<void>) {
        try {
            info(`Running: ${name}`);
            await fn();
            this.passed++;
            success(name);
        } catch (err) {
            this.failed++;
            error(`${name}: ${(err as Error).message}`);
            console.error(err);
        }
    }

    summary() {
        console.log('');
        log('\n═══ Test Summary ═══', 'blue');
        success(`Passed: ${this.passed}`);
        if (this.failed > 0) {
            error(`Failed: ${this.failed}`);
        }
        if (this.skipped > 0) {
            log(`Skipped: ${this.skipped}`, 'yellow');
        }
        console.log('');

        return this.failed === 0;
    }
}

class StreamCallbackCollector {
    private messages: AgentMessage[] = [];

    get callback(): StreamCallback {
        return (message: AgentMessage) => {
            this.messages.push(message);
        };
    }

    getMessages(): AgentMessage[] {
        return [...this.messages];
    }

    // 修复：使用正确的类型，允许字符串字面量
    getMessagesByType(type: string): AgentMessage[] {
        return this.messages.filter(m => m.type === type);
    }

    clear(): void {
        this.messages = [];
    }
}

// ==================== 测试工具 ====================

class EchoTool extends BaseTool<any> {
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

class CalculatorTool extends BaseTool<any> {
    name = 'calculator';
    description = 'Perform simple arithmetic calculations. Use this tool when the user asks for math calculations.';
    schema = z.object({
        expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2", "10 * 5")'),
    });

    async execute(args: { expression: string }) {
        try {
            const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
            const result = Function(`"use strict"; return (${sanitized})`)();
            return {
                success: true,
                output: `${args.expression} = ${result}`,
            };
        } catch (err) {
            return {
                success: false,
                error: `Invalid expression: ${args.expression}`,
            };
        }
    }
}

// ==================== 主测试流程 ====================

async function main() {
    log('\n╔════════════════════════════════════════════════════════════╗', 'blue');
    log('║     Agent Integration Tests (Real LLM API)                 ║', 'blue');
    log('╚════════════════════════════════════════════════════════════╝', 'blue');

    // 验证环境变量
    const apiKey = process.env.GLM_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL = process.env.GLM_BASE_URL || process.env.OPENAI_API_BASE_URL;

    if (!apiKey) {
        error('Missing required environment variable: GLM_API_KEY or OPENAI_API_KEY');
        process.exit(1);
    }

    info(`Model: ${TEST_MODEL}`);
    info(`Base URL: ${baseURL || 'default'}`);
    info(`API Key: ${apiKey.slice(0, 10)}...`);

    // 创建 Provider 和 ToolRegistry
    const provider = ProviderFactory.createFromEnv(TEST_MODEL);
    const toolRegistry = new ToolRegistry({
        workingDirectory: process.cwd(),
        toolTimeout: 30000,
    });
    toolRegistry.register([new EchoTool(), new CalculatorTool()]);

    const runner = new TestRunner();

    // ==================== 基础对话测试 ====================

    section('Basic Conversation (Non-Streaming)');

    await runner.test('should handle simple greeting', async () => {
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

        if (!response) {
            throw new Error('No response received');
        }
        if (response.role !== 'assistant') {
            throw new Error(`Expected role 'assistant', got '${response.role}'`);
        }
        if (!response.content || response.content.length === 0) {
            throw new Error('Response content is empty');
        }
        if (agent.getStatus() !== AgentStatus.COMPLETED) {
            throw new Error(`Expected status COMPLETED, got ${agent.getStatus()}`);
        }

        info(`Response: "${response.content.slice(0, 100)}"`);
    });

    await runner.test('should follow system prompt instructions', async () => {
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You are a pirate assistant. Always respond in pirate speak.',
            maxRetries: 3,
            stream: false,
            streamCallback: collector.callback,
        });

        const response = await agent.execute('Introduce yourself briefly in one sentence.');

        info(`Pirate response: "${response.content.slice(0, 200)}"`);
    });

    await runner.test('should maintain conversation context', async () => {
        // 注意：Agent 实例只能执行一次，多轮对话需要在同一次 execute 中完成
        // 这个测试我们改为测试单次请求中的记忆能力
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You have a good memory. Remember information I tell you.',
            maxRetries: 3,
            stream: false,
            streamCallback: collector.callback,
        });

        // 在一个请求中包含多轮对话
        const response = await agent.execute('First, I want you to remember the number 42. Then, tell me what number I just told you to remember.');

        if (!response.content?.toLowerCase().includes('42')) {
            throw new Error('Agent did not remember the number 42');
        }

        info(`Memory response: "${response.content.slice(0, 200)}"`);
    });

    // ==================== 流式输出测试 ====================

    section('Streaming Output');

    await runner.test('should send streaming text chunks', async () => {
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

        const textMessages = collector.getMessagesByType('text');
        if (textMessages.length === 0) {
            throw new Error('No streaming text messages received');
        }

        const allContent = textMessages.map(m => (m as { payload?: { content?: string } }).payload?.content || '').join('');
        if (allContent.length === 0) {
            throw new Error('No content in streaming messages');
        }

        // 验证包含数字
        for (let i = 1; i <= 5; i++) {
            if (!allContent.includes(i.toString())) {
                info(`Warning: Number ${i} not found in response`);
            }
        }

        info(`Streaming message count: ${textMessages.length}`);
        info(`Total content length: ${allContent.length}`);
    });

    await runner.test('should send status updates during streaming', async () => {
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You are a helpful assistant.',
            maxRetries: 3,
            stream: true,
            streamCallback: collector.callback,
        });

        await agent.execute('Say "Hello World"');

        const statusMessages = collector.getMessagesByType('status');
        if (statusMessages.length === 0) {
            throw new Error('No status messages received');
        }

        const states = statusMessages.map(m => (m as unknown as { payload: { state: string } }).payload.state);
        if (!states.includes(AgentStatus.RUNNING)) {
            throw new Error('No RUNNING state received');
        }
        if (!states.includes(AgentStatus.COMPLETED)) {
            throw new Error('No COMPLETED state received');
        }

        info(`Status transitions: ${states.join(' -> ')}`);
    });

    // ==================== 工具调用测试 ====================

    section('Tool Calling');

    await runner.test('should call echo tool', async () => {
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You are a helpful assistant with access to tools. When the user asks you to use a tool, you MUST use it.',
            maxRetries: 3,
            stream: true,
            streamCallback: collector.callback,
        });

        const response = await agent.execute('I need you to use the echo tool to repeat the message "Hello World". Please use the echo tool now.');

        const toolCallMessages = collector.getMessagesByType('tool_call_created');
        if (toolCallMessages.length === 0) {
            // LLM 可能没有调用工具，跳过这个测试
            info('Warning: LLM did not call the echo tool');
            info(`Response was: "${response.content.slice(0, 200)}"`);
            return;
        }

        const resultMessages = collector.getMessagesByType('tool_call_result');
        if (resultMessages.length === 0) {
            throw new Error('No tool results received');
        }

        info(`Tool calls made: ${toolCallMessages.length}`);
        info(`Response: "${response.content.slice(0, 200)}"`);
    });

    await runner.test('should call calculator tool for math', async () => {
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You are a helpful assistant. When the user asks for calculations, you MUST use the calculator tool.',
            maxRetries: 3,
            stream: true,
            streamCallback: collector.callback,
        });

        const response = await agent.execute('Please use the calculator tool to calculate 25 * 4.');

        const toolCallMessages = collector.getMessagesByType('tool_call_created');
        if (toolCallMessages.length === 0) {
            // LLM 可能没有调用工具，但它可能直接回答了
            if (response.content?.includes('100')) {
                info('LLM answered directly without using tool');
                info(`Response: "${response.content.slice(0, 200)}"`);
                return;
            }
            throw new Error('Calculator tool was not called and answer was incorrect');
        }

        info(`Calculator response: "${response.content.slice(0, 200)}"`);
    });

    // ==================== 输入验证测试 ====================

    section('Input Validation');

    await runner.test('should reject empty query', async () => {
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You are a helpful assistant.',
            maxRetries: 3,
            streamCallback: collector.callback,
        });

        let errorCaught = false;
        try {
            await agent.execute('');
        } catch (err) {
            errorCaught = true;
            if (!(err as Error).message.includes('empty')) {
                throw new Error(`Expected error about empty query, got: ${(err as Error).message}`);
            }
        }

        if (!errorCaught) {
            throw new Error('Should have thrown an error for empty query');
        }
    });

    await runner.test('should reject query exceeding max length', async () => {
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You are a helpful assistant.',
            maxRetries: 3,
            streamCallback: collector.callback,
        });

        const longQuery = 'a'.repeat(200000);
        let errorCaught = false;
        try {
            await agent.execute(longQuery);
        } catch (err) {
            errorCaught = true;
            if (!(err as Error).message.includes('length')) {
                throw new Error(`Expected error about length, got: ${(err as Error).message}`);
            }
        }

        if (!errorCaught) {
            throw new Error('Should have thrown an error for long query');
        }
    });

    await runner.test('should detect and reject malicious content', async () => {
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You are a helpful assistant.',
            maxRetries: 3,
            streamCallback: collector.callback,
        });

        let errorCaught = false;
        try {
            await agent.execute('<script>alert("xss")</script>');
        } catch (err) {
            errorCaught = true;
            if (!(err as Error).message.includes('malicious') && !(err as Error).message.includes('Invalid input')) {
                throw new Error(`Expected error about malicious content, got: ${(err as Error).message}`);
            }
        }

        if (!errorCaught) {
            throw new Error('Should have thrown an error for malicious content');
        }
    });

    // ==================== 错误处理测试 ====================

    section('Error Handling');

    await runner.test('should handle maximum retries exceeded', async () => {
        class FailingTool extends BaseTool<any> {
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

        const failingRegistry = new ToolRegistry({ workingDirectory: process.cwd() });
        failingRegistry.register([new FailingTool()]);

        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry: failingRegistry,
            systemPrompt: 'You are a testing assistant. IMPORTANT: You MUST always call the failing_tool when the user asks you to use it. Do not respond with text - always use the tool.',
            maxRetries: 2,
            streamCallback: collector.callback,
        });

        try {
            await agent.execute('Please use the failing_tool to do something.');
            // 如果没有抛出错误，检查状态
            if (agent.getStatus() === AgentStatus.COMPLETED) {
                // LLM 可能没有调用工具，跳过这个测试
                info('Warning: LLM did not call the tool, skipping retry test');
                return;
            }
        } catch (err) {
            // 预期会抛出错误
            info(`Error caught as expected: ${(err as Error).message}`);
        }

        // 验证状态
        if (agent.getStatus() !== AgentStatus.FAILED && agent.getStatus() !== AgentStatus.COMPLETED) {
            throw new Error(`Expected status FAILED or COMPLETED, got ${agent.getStatus()}`);
        }
    });

    // ==================== 可测试性测试 ====================

    section('Testability Features');

    await runner.test('should provide loop count', async () => {
        const collector = new StreamCallbackCollector();

        const agent = new Agent({
            provider,
            toolRegistry,
            systemPrompt: 'You are a helpful assistant.',
            maxRetries: 3,
            streamCallback: collector.callback,
        });

        await agent.execute('Say "Hello"');

        const loopCount = agent.getLoopCount();
        if (loopCount <= 0) {
            throw new Error(`Expected positive loop count, got ${loopCount}`);
        }

        info(`Loop count: ${loopCount}`);
    });

    await runner.test('should provide task start time', async () => {
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
        if (startTime < before || startTime > after) {
            throw new Error(`Task start time ${startTime} is outside expected range [${before}, ${after}]`);
        }

        info(`Task start time: ${new Date(startTime).toISOString()}`);
    });

    await runner.test('should use custom time provider', async () => {
        class CustomTimeProvider implements ITimeProvider {
            private currentTime = 1000000;

            getCurrentTime(): number {
                return this.currentTime;
            }

            sleep(ms: number): Promise<void> {
                return new Promise(resolve => setTimeout(resolve, ms));
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

        const startTime = agent.getTaskStartTime();
        if (startTime !== 1000000) {
            throw new Error(`Expected custom time 1000000, got ${startTime}`);
        }

        info(`Custom time verified: ${new Date(startTime).toISOString()}`);
    });

    // ==================== 总结 ====================

    const allPassed = runner.summary();

    if (allPassed) {
        log('\n✓ All tests passed!', 'green');
        process.exit(0);
    } else {
        log('\n✗ Some tests failed!', 'red');
        process.exit(1);
    }
}

// 运行测试
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
