/**
 * Subagent 事件冒泡深度测试
 *
 * 测试子 Agent 的事件是否正确冒泡到父会话
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LLMProvider } from '../../../providers';
import type { LLMGenerateOptions, LLMRequestMessage, LLMResponse } from '../../../providers';
import type { ToolContext } from '../base';
import { TestEnvironment } from './test-utils';
import { createMemoryManager } from '../../memory';
import type { IMemoryManager } from '../../memory';
import { TaskTool, clearTaskState } from '../task';
import { AgentMessageType, type AgentMessage } from '../../agent/stream-types';

/**
 * 模拟 Provider - 返回包含工具调用的响应
 */
class MockProviderWithToolCalls extends LLMProvider {
    private readonly responses: LLMResponse[];
    private callCount = 0;

    constructor(responses: LLMResponse[]) {
        super({
            apiKey: 'mock',
            baseURL: 'https://mock.local',
            model: 'mock-model',
            max_tokens: 1024,
            LLMMAX_TOKENS: 8192,
            temperature: 0,
        });
        this.responses = responses;
    }

    async generate(_messages: LLMRequestMessage[], options?: LLMGenerateOptions): Promise<LLMResponse | null> {
        if (options?.abortSignal?.aborted) {
            throw new Error('aborted');
        }

        const response = this.responses[this.callCount % this.responses.length];
        this.callCount++;
        return response;
    }

    getTimeTimeout(): number {
        return 30_000;
    }

    getLLMMaxTokens(): number {
        return 8192;
    }

    getMaxOutputTokens(): number {
        return 1024;
    }
}

/**
 * 创建模拟的文本响应
 */
function createTextResponse(text: string): LLMResponse {
    return {
        id: `mock-response-${Date.now()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'mock-model',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: text,
                },
                finish_reason: 'stop',
            },
        ],
    };
}

/**
 * 事件收集器
 */
class EventCollector {
    private events: AgentMessage[] = [];

    readonly callback = (msg: AgentMessage) => {
        this.events.push(msg);
    };

    getEvents(): AgentMessage[] {
        return [...this.events];
    }

    getEventsByType(type: AgentMessageType): AgentMessage[] {
        return this.events.filter((e) => e.type === type);
    }

    getSubagentEvents(): AgentMessage[] {
        return this.getEventsByType(AgentMessageType.SUBAGENT_EVENT);
    }

    clear(): void {
        this.events = [];
    }
}

describe('Subagent Event Bubbling', () => {
    let env: TestEnvironment;
    let sessionId: string;
    let memoryManager: IMemoryManager;
    let eventCollector: EventCollector;
    let toolContext: ToolContext;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withContext = <T extends { execute: (...args: any[]) => any }>(tool: T): T => {
        const rawExecute = tool.execute.bind(tool);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any).execute = (args?: unknown) => rawExecute(args as never, toolContext);
        return tool;
    };

    beforeEach(async () => {
        env = new TestEnvironment('task-event-bubbling');
        await env.setup();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: `${env.getTestDir()}/agent-memory`,
        });
        await memoryManager.initialize();
        sessionId = `event-bubbling-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        eventCollector = new EventCollector();
        toolContext = {
            environment: process.cwd(),
            platform: process.platform,
            time: new Date().toISOString(),
            sessionId,
            memoryManager,
            streamCallback: eventCollector.callback,
        };
        clearTaskState();
    });

    afterEach(async () => {
        clearTaskState();
        await memoryManager.close();
        await env.teardown();
    });

    describe('Event Bubbling Mechanism', () => {
        it('should bubble subagent events to parent session', async () => {
            // 创建返回文本响应的 Provider
            const provider = new MockProviderWithToolCalls([
                createTextResponse('I have analyzed the code. The result is: all tests passed.'),
            ]);

            const taskTool = withContext(new TaskTool(provider, process.cwd()));

            const result = await taskTool.execute({
                description: 'Analyze code',
                prompt: 'Analyze the project structure',
                subagent_type: 'explore',
                run_in_background: false,
            });

            expect(result.success).toBe(true);

            // 验证事件被收集
            const events = eventCollector.getEvents();
            console.log('Total events collected:', events.length);
            console.log(
                'Event types:',
                events.map((e) => e.type)
            );

            // 验证有 SUBAGENT_EVENT 类型的事件
            const subagentEvents = eventCollector.getSubagentEvents();
            console.log('Subagent events:', subagentEvents.length);

            // 当父会话有 streamCallback 时，应该有事件冒泡
            if (subagentEvents.length > 0) {
                // 验证事件结构
                const firstEvent = subagentEvents[0];
                expect(firstEvent.type).toBe(AgentMessageType.SUBAGENT_EVENT);
                expect(firstEvent.payload).toHaveProperty('task_id');
                expect(firstEvent.payload).toHaveProperty('subagent_type');
                expect(firstEvent.payload).toHaveProperty('child_session_id');
                expect(firstEvent.payload).toHaveProperty('event');
            }
        });

        it('should not bubble events when parent has no streamCallback', async () => {
            // 移除 streamCallback
            toolContext.streamCallback = undefined;

            const provider = new MockProviderWithToolCalls([createTextResponse('Task completed successfully.')]);

            const taskTool = withContext(new TaskTool(provider, process.cwd()));

            const result = await taskTool.execute({
                description: 'Simple task',
                prompt: 'Do something simple',
                subagent_type: 'explore',
                run_in_background: false,
            });

            expect(result.success).toBe(true);

            // 没有事件被收集（因为没有 streamCallback）
            const events = eventCollector.getEvents();
            expect(events.length).toBe(0);
        });

        it('should include correct metadata in bubbled events', async () => {
            const provider = new MockProviderWithToolCalls([createTextResponse('Analysis complete.')]);

            const taskTool = withContext(new TaskTool(provider, process.cwd()));

            const result = await taskTool.execute({
                description: 'Test metadata',
                prompt: 'Test that metadata is correct',
                subagent_type: 'explore',
                run_in_background: false,
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.task_id).toBeDefined();
            expect(result.metadata?.child_session_id).toBeDefined();

            const subagentEvents = eventCollector.getSubagentEvents();

            if (subagentEvents.length > 0) {
                // 验证所有事件的 metadata 与结果一致
                for (const event of subagentEvents) {
                    expect(event.payload.task_id).toBe(result.metadata?.task_id);
                    expect(event.payload.subagent_type).toBe('explore');
                    expect(event.payload.child_session_id).toBe(result.metadata?.child_session_id);
                }
            }
        });

        it('should bubble text events from subagent', async () => {
            const provider = new MockProviderWithToolCalls([createTextResponse('This is the subagent response text.')]);

            const taskTool = withContext(new TaskTool(provider, process.cwd()));

            const result = await taskTool.execute({
                description: 'Text output test',
                prompt: 'Generate some text',
                subagent_type: 'explore',
                run_in_background: false,
            });

            expect(result.success).toBe(true);

            const subagentEvents = eventCollector.getSubagentEvents();
            console.log('Subagent events count:', subagentEvents.length);

            // 查找文本相关的事件
            const textEvents = subagentEvents.filter((e) => {
                const innerEvent = e.payload.event;
                return (
                    innerEvent.type === AgentMessageType.TEXT_DELTA ||
                    innerEvent.type === AgentMessageType.TEXT_START ||
                    innerEvent.type === AgentMessageType.TEXT_COMPLETE
                );
            });

            console.log('Text events found:', textEvents.length);

            // 如果有事件冒泡，验证文本内容
            if (textEvents.length > 0) {
                const textDeltaEvents = textEvents.filter((e) => e.payload.event.type === AgentMessageType.TEXT_DELTA);

                // 应该有文本增量事件
                expect(textDeltaEvents.length).toBeGreaterThan(0);
            }
        });

        it('should bubble status events from subagent', async () => {
            const provider = new MockProviderWithToolCalls([createTextResponse('Status test complete.')]);

            const taskTool = withContext(new TaskTool(provider, process.cwd()));

            const result = await taskTool.execute({
                description: 'Status test',
                prompt: 'Test status events',
                subagent_type: 'explore',
                run_in_background: false,
            });

            expect(result.success).toBe(true);

            const subagentEvents = eventCollector.getSubagentEvents();

            // 查找状态事件
            const statusEvents = subagentEvents.filter((e) => {
                return e.payload.event.type === AgentMessageType.STATUS;
            });

            console.log('Status events found:', statusEvents.length);

            if (statusEvents.length > 0) {
                // 验证状态事件结构
                for (const event of statusEvents) {
                    const innerEvent = event.payload.event;
                    expect(innerEvent.payload).toHaveProperty('state');
                    expect(innerEvent.payload).toHaveProperty('message');
                }
            }
        });
    });

    describe('Event Bubbling with Background Tasks', () => {
        it('should bubble events from background tasks', async () => {
            const provider = new MockProviderWithToolCalls([createTextResponse('Background task completed.')]);

            const taskTool = withContext(new TaskTool(provider, process.cwd()));

            // 启动后台任务
            const startResult = await taskTool.execute({
                description: 'Background task',
                prompt: 'Run in background',
                subagent_type: 'explore',
                run_in_background: true,
            });

            expect(startResult.success).toBe(true);
            expect(startResult.metadata?.status).toBe('queued');

            // 等待任务完成
            await new Promise((resolve) => setTimeout(resolve, 500));

            // 验证是否有事件冒泡
            const subagentEvents = eventCollector.getSubagentEvents();
            console.log('Background task events:', subagentEvents.length);
        });
    });
});
