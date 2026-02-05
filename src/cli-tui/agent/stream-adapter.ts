/**
 * cli-tui Stream Adapter
 * Converts Agent messages to UI events
 */

import type {
  AgentMessage,
  CodePatchMessage,
  ErrorMessage,
  StatusMessage,
  TextMessage,
  TextStartMessage,
  ThoughtMessage,
  ToolCallCreatedMessage,
  ToolCallResultMessage,
  ToolCallStreamMessage,
} from '../../agent-v2/agent/stream-types';
import type { ToolInvocation, UIEvent } from '../types';

interface StreamingState {
  messageId: string | null;
  buffer: string;
  fullContent: string;
  hasStarted: boolean;
  toolCalls: Map<string, ToolInvocation>;
  codePatches: Map<string, { path: string; diff: string; language?: string; timestamp: number }>;
}

const createEmptyState = (): StreamingState => ({
  messageId: null,
  buffer: '',
  fullContent: '',
  hasStarted: false,
  toolCalls: new Map(),
  codePatches: new Map(),
});

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

/**
 * StreamAdapter - Converts Agent messages to UI events
 */
export class StreamAdapter {
  private state: StreamingState = createEmptyState();
  private lastTextMsgId: string | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly emit: (event: UIEvent) => void,
    private readonly flushIntervalMs = 33
  ) {}

  reset(): void {
    this.state = createEmptyState();
    this.lastTextMsgId = null;
    this.clearFlushTimer();
  }

  dispose(): void {
    this.reset();
  }

  handleAgentMessage(message: AgentMessage): void {
    switch (message.type) {
      case 'text-start':
        this.handleTextStart(message as TextStartMessage);
        break;
      case 'text-delta':
        this.handleTextDelta(message as ThoughtMessage);
        break;
      case 'text-complete':
        this.handleTextComplete(message as TextMessage);
        break;
      case 'tool_call_created':
        this.handleToolCallCreated(message as ToolCallCreatedMessage);
        break;
      case 'tool_call_stream':
        this.handleToolCallStream(message as ToolCallStreamMessage);
        break;
      case 'tool_call_result':
        this.handleToolCallResult(message as ToolCallResultMessage);
        break;
      case 'code_patch':
        this.handleCodePatch(message as CodePatchMessage);
        break;
      case 'status':
        this.handleStatus(message as StatusMessage);
        break;
      case 'error':
        this.handleError(message as ErrorMessage);
        break;
      default:
        break;
    }
  }

  private handleTextStart(message: TextStartMessage): void {
    const { msgId, timestamp } = message;

    if (this.state.messageId && this.state.messageId !== msgId) {
      this.flushAndCompleteCurrent();
    }

    this.state.messageId = msgId;
    this.lastTextMsgId = msgId;
    this.state.buffer = '';
    this.state.fullContent = '';
    this.state.hasStarted = true;

    this.emit({
      type: 'text-start',
      messageId: msgId,
      timestamp,
    });
  }

  private handleTextDelta(message: ThoughtMessage): void {
    const { msgId, payload, timestamp } = message;
    const content = payload.content || '';

    if (this.state.messageId !== msgId) {
      this.handleTextStart({
        ...message,
        type: 'text-start',
        timestamp: timestamp ?? Date.now(),
      } as TextStartMessage);
    }

    if (content) {
      this.state.buffer += content;
      this.state.fullContent += content;
      this.scheduleFlush(msgId);
    }
  }

  private handleTextComplete(message: TextMessage): void {
    const { msgId, payload, timestamp } = message;
    const content = payload.content || '';

    if (this.state.messageId !== msgId) {
      this.handleTextStart({
        type: 'text-start',
        msgId,
        timestamp: timestamp ?? Date.now(),
        payload: { content: '' },
      } as TextStartMessage);
    }

    this.flushNow();

    const finalContent = content || this.state.fullContent;

    this.emit({
      type: 'text-complete',
      messageId: msgId,
      content: finalContent,
    });

    this.state.messageId = null;
    this.lastTextMsgId = msgId;
    this.state.buffer = '';
    this.state.fullContent = '';
    this.state.hasStarted = false;
    this.clearFlushTimer();
  }

  private handleToolCallCreated(message: ToolCallCreatedMessage): void {
    const { msgId, payload, timestamp } = message;

    if (this.state.messageId) {
      this.flushNow();
    }

    for (const toolCall of payload.tool_calls) {
      const parsedArgs = parseToolArgs(toolCall.args);

      const invocation: ToolInvocation = {
        id: toolCall.callId,
        name: toolCall.toolName,
        args: parsedArgs,
        status: 'running',
        startedAt: timestamp,
      };

      this.state.toolCalls.set(toolCall.callId, invocation);

      this.emit({
        type: 'tool-start',
        messageId: msgId,
        toolCallId: toolCall.callId,
        toolName: toolCall.toolName,
        args: parsedArgs,
        timestamp,
        content: payload.content,
      });
    }
  }

  private handleToolCallStream(message: ToolCallStreamMessage): void {
    const { payload, timestamp } = message;
    const { callId, output } = payload;

    const messageId =
      (message as any).msgId ??
      this.state.messageId ??
      this.lastTextMsgId;
    if (!messageId) {
      console.warn('[StreamAdapter] tool-stream: no messageId found');
      return;
    }

    const invocation = this.state.toolCalls.get(callId);
    if (!invocation) {
      console.warn('[StreamAdapter] tool-stream: invocation not found for callId:', callId);
      return;
    }

    invocation.streamOutput = (invocation.streamOutput || '') + output;

    this.emit({
      type: 'tool-stream',
      messageId,
      toolCallId: callId,
      output,
      timestamp,
    });
  }

  private handleToolCallResult(message: ToolCallResultMessage): void {
    const { payload, timestamp } = message;
    const { callId, status, result } = payload;

    const invocation = this.state.toolCalls.get(callId);
    if (!invocation) {
      console.warn('[StreamAdapter] tool-result: invocation not found for callId:', callId);
      return;
    }

    const messageId =
      (message as any).msgId ??
      this.state.messageId ??
      this.lastTextMsgId;
    if (!messageId) {
      console.warn('[StreamAdapter] tool-result: no messageId found for callId:', callId);
      return;
    }

    const completedAt = timestamp;
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

  private handleCodePatch(message: CodePatchMessage): void {
    const { msgId, payload, timestamp } = message;
    const { path, diff, language } = payload;

    this.state.codePatches.set(path, { path, diff, language, timestamp });

    this.emit({
      type: 'code-patch',
      messageId: msgId,
      path,
      diff,
      language,
      timestamp,
    });
  }

  private handleStatus(message: StatusMessage): void {
    const state = message.payload?.state;

    this.emit({
      type: 'status',
      state: typeof state === 'string' ? state : undefined,
      message: message.payload?.message,
    });

    if (!state || typeof state !== 'string') return;

    const normalized = state.toLowerCase();
    const isTerminal =
      normalized === 'completed' ||
      normalized === 'success' ||
      normalized === 'succeeded' ||
      normalized === 'failed' ||
      normalized === 'error' ||
      normalized === 'aborted';

    if (isTerminal) {
      this.flushAndCompleteCurrent();
      this.emit({ type: 'session-complete' });
      this.reset();
    }
  }

  private handleError(message: ErrorMessage): void {
    this.emit({
      type: 'error',
      message: message.payload?.error || 'Unknown error',
      phase: message.payload?.phase,
    });

    this.reset();
  }

  private flushAndCompleteCurrent(): void {
    if (!this.state.messageId) return;

    this.flushNow();

    this.emit({
      type: 'text-complete',
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
      type: 'text-delta',
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
      type: 'text-delta',
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
