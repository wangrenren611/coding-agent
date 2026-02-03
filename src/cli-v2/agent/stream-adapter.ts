import type { AgentMessage } from '../../agent-v2/agent/stream-types';
import type { ToolInvocation, UIEvent } from '../state/types';

interface StreamingState {
  messageId: string | null;
  buffer: string;
  fullContent: string;
  hasStarted: boolean;
  toolCalls: Map<string, ToolInvocation>;
}

export class StreamAdapter {
  private state: StreamingState = {
    messageId: null,
    buffer: '',
    fullContent: '',
    hasStarted: false,
    toolCalls: new Map(),
  };

  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly emit: (event: UIEvent) => void,
    private readonly flushIntervalMs = 33
  ) {}

  reset(): void {
    this.state = {
      messageId: null,
      buffer: '',
      fullContent: '',
      hasStarted: false,
      toolCalls: new Map(),
    };
    this.clearFlushTimer();
  }

  dispose(): void {
    this.reset();
  }

  handleAgentMessage(message: AgentMessage): void {
    const msgType = message.type as string;

    switch (msgType) {
      case 'text':
        this.handleText(message as AgentMessage & { type: 'text' });
        break;
      case 'tool_call_created':
        this.handleToolCallCreated(message as AgentMessage & { type: 'tool_call_created' });
        break;
      case 'tool_call_result':
        this.handleToolCallResult(message as AgentMessage & { type: 'tool_call_result' });
        break;
      case 'status':
        this.handleStatus(message as AgentMessage & { type: 'status' });
        break;
      case 'error':
        this.emit({
          type: 'error',
          message: (message as any)?.payload?.error || 'Unknown error',
          phase: 'agent',
        });
        this.reset();
        break;
      default:
        break;
    }
  }

  private handleText(message: AgentMessage & { type: 'text' }): void {
    const { msgId, payload } = message;
    const content = payload.content || '';

    if (this.state.messageId !== msgId) {
      this.flushAndCompleteCurrent();

      this.state.messageId = msgId;
      this.state.buffer = '';
      this.state.fullContent = '';
      this.state.hasStarted = true;

      this.emit({
        type: 'assistant-start',
        messageId: msgId,
        timestamp: message.timestamp,
      });
    }

    if (content) {
      this.state.buffer += content;
      this.state.fullContent += content;
      this.scheduleFlush(msgId);
    }
  }

  private handleToolCallCreated(message: AgentMessage & { type: 'tool_call_created' }): void {
    const { msgId, payload } = message;

    this.flushAndCompleteCurrent();

    for (const toolCall of payload.tool_calls) {
      const parsedArgs = parseToolArgs(toolCall.args);
      const invocation: ToolInvocation = {
        id: toolCall.callId,
        name: toolCall.toolName,
        args: parsedArgs,
        status: 'running',
        startedAt: message.timestamp,
      };

      this.state.toolCalls.set(toolCall.callId, invocation);

      this.emit({
        type: 'tool-start',
        messageId: msgId,
        toolCallId: toolCall.callId,
        toolName: toolCall.toolName,
        args: parsedArgs,
        timestamp: message.timestamp,
      });
    }
  }

  private handleToolCallResult(message: AgentMessage & { type: 'tool_call_result' }): void {
    const { payload } = message;
    const { callId, status, result } = payload;
    const invocation = this.state.toolCalls.get(callId);

    if (!invocation) return;

    const messageId = (message as any).msgId || this.state.messageId || callId;
    const completedAt = message.timestamp;
    const duration = completedAt - invocation.startedAt;

    if (status === 'success') {
      this.emit({
        type: 'tool-complete',
        messageId,
        toolCallId: callId,
        result,
        duration,
        timestamp: completedAt,
      });
    } else {
      const error = typeof result === 'string' ? result : JSON.stringify(result);
      this.emit({
        type: 'tool-error',
        messageId,
        toolCallId: callId,
        error,
        duration,
        timestamp: completedAt,
      });
    }

    this.state.toolCalls.delete(callId);
  }

  private handleStatus(message: AgentMessage & { type: 'status' }): void {
    const state = message.payload?.state;
    this.emit({
      type: 'status',
      state: typeof state === 'string' ? state : undefined,
      message: message.payload?.message,
    });

    if (!state || typeof state !== 'string') return;
    const normalized = state.toLowerCase();
    const isTerminal = (
      normalized === 'completed' ||
      normalized === 'success' ||
      normalized === 'succeeded' ||
      normalized === 'failed' ||
      normalized === 'error' ||
      normalized === 'aborted'
    );
    if (isTerminal) {
      this.flushAndCompleteCurrent();
      this.emit({ type: 'session-complete' });
      this.reset();
    }
  }

  private flushAndCompleteCurrent(): void {
    if (!this.state.messageId) return;

    this.flushNow();
    this.emit({
      type: 'assistant-complete',
      messageId: this.state.messageId,
      content: this.state.fullContent,
    });

    this.state.messageId = null;
    this.state.buffer = '';
    this.state.fullContent = '';
    this.state.hasStarted = false;
    this.clearFlushTimer();
  }

  private scheduleFlush(messageId: string): void {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPartial(messageId);
    }, this.flushIntervalMs);
  }

  private flushPartial(messageId: string): void {
    if (!this.state.buffer) return;
    if (this.state.messageId !== messageId) return;

    const delta = this.state.buffer;
    this.state.buffer = '';

    this.emit({
      type: 'assistant-delta',
      messageId,
      contentDelta: delta,
      isDone: false,
    });
  }

  private flushNow(): void {
    this.clearFlushTimer();
    if (!this.state.messageId || !this.state.buffer) return;

    const messageId = this.state.messageId;
    const delta = this.state.buffer;
    this.state.buffer = '';

    this.emit({
      type: 'assistant-delta',
      messageId,
      contentDelta: delta,
      isDone: false,
    });
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

const parseToolArgs = (args: unknown): Record<string, unknown> => {
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      return { raw: args };
    }
  }

  if (args && typeof args === 'object') {
    return args as Record<string, unknown>;
  }

  return { raw: args };
};
