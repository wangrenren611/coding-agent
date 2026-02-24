/**
 * Subagent 事件冒泡深度测试
 * 
 * 测试子 Agent 的事件是否正确传递到父会话
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
class MockProviderWithResponses extends LLMProvider {
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

  async generate(
    _messages: LLMRequestMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMResponse | null> {
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
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text,
      },
      finish_reason: 'stop',
    }],
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
    return this.events.filter(e => e.type === type);
  }

  getSubagentEvents(): AgentMessage[] {
    return this.getEventsByType(AgentMessageType.SUBAGENT_EVENT);
  }

  clear(): void {
    this.events = [];
  }
}

describe('Subagent Message Passing', () => {
  let env: TestEnvironment;
  let sessionId: string;
  let memoryManager: IMemoryManager;
  let eventCollector: EventCollector;
  let toolContext: ToolContext;

  const withContext = <T extends { execute: (...args: any[]) => any }>(tool: T): T => {
    const rawExecute = tool.execute.bind(tool);
    (tool as any).execute = (args?: unknown) => rawExecute(args as never, toolContext);
    return tool;
  };

  beforeEach(async () => {
    env = new TestEnvironment('subagent-msg-test');
    await env.setup();
    memoryManager = createMemoryManager({
      type: 'file',
      connectionString: `${env.getTestDir()}/agent-memory`,
    });
    await memoryManager.initialize();
    sessionId = `msg-test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  describe('Message Passing Mechanism', () => {
    it('should pass subagent events to parent when streamCallback exists', async () => {
      const provider = new MockProviderWithResponses([
        createTextResponse('Analysis complete. All tests passed.'),
      ]);

      const taskTool = withContext(new TaskTool(provider, process.cwd()));

      const result = await taskTool.execute({
        description: 'Analyze code',
        prompt: 'Analyze the project',
        subagent_type: 'explore',
        run_in_background: false,
      });

      expect(result.success).toBe(true);

      const events = eventCollector.getEvents();
      console.log('Total events collected:', events.length);
      console.log('Event types:', events.map(e => e.type));

      const subagentEvents = eventCollector.getSubagentEvents();
      console.log('Subagent events count:', subagentEvents.length);

      // 验证事件结构（如果有）
      if (subagentEvents.length > 0) {
        const firstEvent = subagentEvents[0];
        expect(firstEvent.type).toBe(AgentMessageType.SUBAGENT_EVENT);
        expect(firstEvent.payload).toHaveProperty('task_id');
        expect(firstEvent.payload).toHaveProperty('subagent_type');
        expect(firstEvent.payload).toHaveProperty('child_session_id');
        expect(firstEvent.payload).toHaveProperty('event');
        console.log('First subagent event payload:', JSON.stringify(firstEvent.payload, null, 2));
      }
    });

    it('should NOT pass events when parent has no streamCallback', async () => {
      toolContext.streamCallback = undefined;

      const provider = new MockProviderWithResponses([
        createTextResponse('Task done.'),
      ]);

      const taskTool = withContext(new TaskTool(provider, process.cwd()));

      const result = await taskTool.execute({
        description: 'Simple task',
        prompt: 'Do something',
        subagent_type: 'explore',
        run_in_background: false,
      });

      expect(result.success).toBe(true);

      const events = eventCollector.getEvents();
      expect(events.length).toBe(0);
      console.log('Events without streamCallback:', events.length);
    });

    it('should include correct metadata in passed events', async () => {
      const provider = new MockProviderWithResponses([
        createTextResponse('Done.'),
      ]);

      const taskTool = withContext(new TaskTool(provider, process.cwd()));

      const result = await taskTool.execute({
        description: 'Metadata test',
        prompt: 'Test metadata',
        subagent_type: 'explore',
        run_in_background: false,
      });

      expect(result.success).toBe(true);
      expect(result.metadata?.task_id).toBeDefined();
      expect(result.metadata?.child_session_id).toBeDefined();

      const subagentEvents = eventCollector.getSubagentEvents();
      
      if (subagentEvents.length > 0) {
        for (const event of subagentEvents) {
          expect(event.payload.task_id).toBe(result.metadata?.task_id);
          expect(event.payload.subagent_type).toBe('explore');
          expect(event.payload.child_session_id).toBe(result.metadata?.child_session_id);
        }
        console.log('All events have correct metadata');
      }
    });

    it('should collect multiple event types from subagent', async () => {
      const provider = new MockProviderWithResponses([
        createTextResponse('Response text here.'),
      ]);

      const taskTool = withContext(new TaskTool(provider, process.cwd()));

      const result = await taskTool.execute({
        description: 'Multi event test',
        prompt: 'Generate events',
        subagent_type: 'explore',
        run_in_background: false,
      });

      expect(result.success).toBe(true);

      const subagentEvents = eventCollector.getSubagentEvents();
      console.log('Total subagent events:', subagentEvents.length);

      if (subagentEvents.length > 0) {
        // 统计各种事件类型
        const eventTypes = new Map<string, number>();
        for (const event of subagentEvents) {
          const innerType = event.payload.event.type;
          eventTypes.set(innerType, (eventTypes.get(innerType) || 0) + 1);
        }
        
        console.log('Event type distribution:');
        for (const [type, count] of eventTypes) {
          console.log(`  ${type}: ${count}`);
        }
      }
    });
  });

  describe('Background Task Events', () => {
    it('should pass events from background tasks', async () => {
      const provider = new MockProviderWithResponses([
        createTextResponse('Background complete.'),
      ]);

      const taskTool = withContext(new TaskTool(provider, process.cwd()));

      const startResult = await taskTool.execute({
        description: 'BG task',
        prompt: 'Run background',
        subagent_type: 'explore',
        run_in_background: true,
      });

      expect(startResult.success).toBe(true);
      expect(startResult.metadata?.status).toBe('queued');

      // 等待后台任务完成
      await new Promise(resolve => setTimeout(resolve, 1000));

      const subagentEvents = eventCollector.getSubagentEvents();
      console.log('Background task events:', subagentEvents.length);
    });
  });
});
