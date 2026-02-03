export type MessageId = string;
export type Timestamp = number;

export type MessageStatus = 'streaming' | 'complete' | 'error';
export type ToolStatus = 'pending' | 'running' | 'success' | 'error';

export interface ToolInvocation {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: unknown;
  error?: string;
  startedAt: Timestamp;
  completedAt?: Timestamp;
  duration?: number;
}

export type Message =
  | {
      type: 'user';
      id: MessageId;
      content: string;
      timestamp: Timestamp;
    }
  | {
      type: 'assistant';
      id: MessageId;
      content: string;
      status: MessageStatus;
      toolCalls?: ToolInvocation[];
      timestamp: Timestamp;
    }
  | {
      type: 'system';
      id: MessageId;
      level: 'info' | 'warn' | 'error';
      content: string;
      details?: string;
      timestamp: Timestamp;
    };

export type UIEvent =
  | {
      type: 'assistant-start';
      messageId: MessageId;
      timestamp: Timestamp;
    }
  | {
      type: 'assistant-delta';
      messageId: MessageId;
      contentDelta: string;
      isDone: boolean;
    }
  | {
      type: 'assistant-complete';
      messageId: MessageId;
      content?: string;
    }
  | {
      type: 'tool-start';
      messageId: MessageId;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      timestamp: Timestamp;
    }
  | {
      type: 'tool-complete';
      messageId: MessageId;
      toolCallId: string;
      result: unknown;
      duration?: number;
      timestamp: Timestamp;
    }
  | {
      type: 'tool-error';
      messageId: MessageId;
      toolCallId: string;
      error: string;
      duration?: number;
      timestamp: Timestamp;
    }
  | {
      type: 'error';
      message: string;
      phase?: string;
    }
  | {
      type: 'status';
      state?: string;
      message?: string;
    }
  | {
      type: 'session-complete';
    };
