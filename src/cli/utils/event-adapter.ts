/**
 * 事件适配器
 *
 * 将当前项目 Agent 的流式消息转换为 UI 事件格式
 * 提供统一的转换逻辑，使 UI 层与核心 Agent 解耦
 */

import type { AgentMessage } from '../../agent-v2/agent/stream-types';
import type { UIEvent, ToolInvocation } from '../types/message-types';

// =============================================================================
// 事件转换器
// =============================================================================

/**
 * UI 事件回调
 */
export type UIEventCallback = (event: UIEvent) => void;

/**
 * 流式消息状态跟踪
 */
interface StreamingState {
  messageId: string | null;
  buffer: string;
  hasStarted: boolean;
  toolCalls: Map<string, ToolInvocation>;
}

// =============================================================================
// 适配器类
// =============================================================================

export class AgentEventAdapter {
  private streamingState: StreamingState = {
    messageId: null,
    buffer: '',
    hasStarted: false,
    toolCalls: new Map(),
  };

  constructor(private uiEventCallback: UIEventCallback) {}

  /**
   * 处理 Agent 消息并转换为 UI 事件
   */
  handleAgentMessage(message: AgentMessage): void {
    const msgType = message.type as string;

    switch (msgType) {
      case 'thought':
        // 思考内容可以合并到文本内容或单独显示
        break;

      case 'text':
        this.handleTextMessage(message as AgentMessage & { type: 'text' });
        break;

      case 'tool_call_created':
        this.handleToolCallCreated(message as AgentMessage & { type: 'tool_call_created' });
        break;

      case 'tool_call_stream':
        // 工具执行中的实时日志，可以显示或忽略
        break;

      case 'tool_call_result':
        this.handleToolCallResult(message as AgentMessage & { type: 'tool_call_result' });
        break;

      case 'status':
        this.handleStatusMessage(message as AgentMessage & { type: 'status' });
        break;

      case 'error':
        this.handleError(message as AgentMessage & { type: 'error' });
        break;

      case 'code_patch':
        // 代码 diff 可以单独处理或作为结果显示
        break;
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.streamingState = {
      messageId: null,
      buffer: '',
      hasStarted: false,
      toolCalls: new Map(),
    };
  }

  // ---------------------------------------------------------------------------
  // 事件处理器
  // ---------------------------------------------------------------------------

  /**
   * 处理文本消息
   */
  private handleTextMessage(message: AgentMessage & { type: 'text' }): void {
    const { msgId, payload } = message;
    const content = payload.content || '';

    // 新消息开始
    if (this.streamingState.messageId !== msgId) {
      // 完成之前的消息
      if (this.streamingState.hasStarted && this.streamingState.messageId) {
        this.uiEventCallback({
          type: 'assistant-message-complete',
          messageId: this.streamingState.messageId,
          content: this.streamingState.buffer,
        });
      }

      // 开始新消息
      this.streamingState.messageId = msgId;
      this.streamingState.buffer = '';
      this.streamingState.hasStarted = false;

      // 发送开始事件
      this.uiEventCallback({
        type: 'assistant-message-start',
        messageId: msgId,
        timestamp: message.timestamp,
        hasToolCalls: false,
      });
      this.streamingState.hasStarted = true;
    }

    // 发送内容增量
    if (content) {
      this.streamingState.buffer += content;
      this.uiEventCallback({
        type: 'assistant-message-delta',
        messageId: msgId,
        contentDelta: content,
        isDone: false,
      });
    }
  }

  /**
   * 处理工具调用创建
   */
  private handleToolCallCreated(message: AgentMessage & { type: 'tool_call_created' }): void {
    const { msgId, payload } = message;

    // 如果有新的工具调用，先完成之前的文本消息
    if (this.streamingState.hasStarted && this.streamingState.messageId === msgId) {
      this.uiEventCallback({
        type: 'assistant-message-complete',
        messageId: msgId,
        content: this.streamingState.buffer,
      });
    }

    // 处理每个工具调用
    for (const toolCall of payload.tool_calls) {
      const toolInvocation: ToolInvocation = {
        id: toolCall.callId,
        name: toolCall.toolName,
        args: typeof toolCall.args === 'string' ? JSON.parse(toolCall.args) : toolCall.args,
        status: 'running',
        startedAt: message.timestamp,
      };

      this.streamingState.toolCalls.set(toolCall.callId, toolInvocation);

      // 发送工具调用开始事件
      this.uiEventCallback({
        type: 'tool-invocation-start',
        messageId: msgId,
        toolCallId: toolCall.callId,
        toolName: toolCall.toolName,
        args: toolInvocation.args,
        timestamp: message.timestamp,
      });
    }
  }

  /**
   * 处理工具调用结果
   */
  private handleToolCallResult(message: AgentMessage & { type: 'tool_call_result' }): void {
    const { payload } = message;
    const { callId, status, result } = payload;

    const existingCall = this.streamingState.toolCalls.get(callId);
    if (!existingCall) return;

    const completedAt = message.timestamp;
    const duration = completedAt - existingCall.startedAt;

    if (status === 'success') {
      // 更新工具调用状态
      existingCall.status = 'success';
      existingCall.result = result;
      existingCall.duration = duration;
      existingCall.completedAt = completedAt;

      // 发送完成事件
      this.uiEventCallback({
        type: 'tool-invocation-complete',
        messageId: message.msgId,
        toolCallId: callId,
        result,
        duration,
        timestamp: completedAt,
      });
    } else {
      // 错误状态
      existingCall.status = 'error';
      existingCall.error = typeof result === 'string' ? result : JSON.stringify(result);
      existingCall.duration = duration;
      existingCall.completedAt = completedAt;

      // 发送错误事件
      this.uiEventCallback({
        type: 'tool-invocation-error',
        messageId: message.msgId,
        toolCallId: callId,
        error: existingCall.error,
        duration,
        timestamp: completedAt,
      });
    }

    this.streamingState.toolCalls.delete(callId);
  }

  /**
   * 处理状态消息
   */
  private handleStatusMessage(message: AgentMessage & { type: 'status' }): void {
    const { payload } = message;
    const { state, message: statusMessage } = payload;

    // 当状态变为 completed 时，完成当前消息
    if (state === 'completed' || state === 'COMPLETED') {
      if (this.streamingState.hasStarted && this.streamingState.messageId) {
        this.uiEventCallback({
          type: 'assistant-message-complete',
          messageId: this.streamingState.messageId,
          content: this.streamingState.buffer,
        });
        this.uiEventCallback({
          type: 'session-complete',
          finalContent: this.streamingState.buffer,
        });
        this.reset();
      }
    }
  }

  /**
   * 处理错误消息
   */
  private handleError(message: AgentMessage & { type: 'error' }): void {
    // 发送错误事件
    this.uiEventCallback({
      type: 'error',
      error: new Error(message.payload.error || 'Unknown error'),
      phase: 'agent-execution',
      recoverable: true,
    });

    // 重置状态
    this.reset();
  }
}

// =============================================================================
// 工厂函数
// =============================================================================

/**
 * 创建事件适配器
 */
export function createEventAdapter(
  uiEventCallback: UIEventCallback
): AgentEventAdapter {
  return new AgentEventAdapter(uiEventCallback);
}

export default AgentEventAdapter;
