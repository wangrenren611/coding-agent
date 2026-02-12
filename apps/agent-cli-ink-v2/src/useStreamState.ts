/**
 * 流式消息状态管理
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { MessageType, AgentStatus, type StreamMessage, type DisplayEntry, type TextEntry, type ToolEntry } from './types.js';

interface TextBuffer { content: string; isStreaming: boolean; startTime: number }
interface ToolBuffer { callId: string; toolName: string; args: string; output: string; status: 'running' | 'success' | 'error'; isStreaming: boolean; startTime: number }

interface AgentState {
  status: AgentStatus;
  currentTextId: string | null;
  textBuffers: Map<string, TextBuffer>;
  toolBuffers: Map<string, ToolBuffer>;
  completedEntries: DisplayEntry[];
  sessionId: string;
}

export function useStreamState() {
  const [state, setState] = useState<AgentState>({
    status: AgentStatus.IDLE, 
    currentTextId: null, 
    textBuffers: new Map(), 
    toolBuffers: new Map(), 
    completedEntries: [], 
    sessionId: '',
  });

  const idCounterRef = useRef(0);
  const generateId = useCallback(() => `entry-${Date.now()}-${++idCounterRef.current}`, []);

  // 直接计算当前流式文本，作为派生状态
  const currentStreamingText: TextEntry | null = useMemo(() => {
    if (!state.currentTextId) return null;
    const buffer = state.textBuffers.get(state.currentTextId);
    if (!buffer) return null;
    return {
      kind: 'text' as const,
      id: state.currentTextId,
      content: buffer.content,
      isStreaming: buffer.isStreaming,
      timestamp: buffer.startTime,
    };
  }, [state.currentTextId, state.textBuffers]);

  const processMessage = useCallback((message: StreamMessage) => {
    setState(prev => {
      switch (message.type) {
        case MessageType.STATUS:
          return { ...prev, status: message.payload.state, sessionId: message.sessionId };

        case MessageType.TEXT_START: {
          const newBuffers = new Map(prev.textBuffers);
          newBuffers.set(message.msgId, { content: '', isStreaming: true, startTime: message.timestamp });
          return { ...prev, currentTextId: message.msgId, textBuffers: newBuffers };
        }

        case MessageType.TEXT_DELTA: {
          const buffer = prev.textBuffers.get(message.msgId);
          if (!buffer) {
            const newBuffers = new Map(prev.textBuffers);
            newBuffers.set(message.msgId, { content: message.payload.content, isStreaming: true, startTime: message.timestamp });
            return { ...prev, currentTextId: message.msgId, textBuffers: newBuffers };
          }
          const newBuffers = new Map(prev.textBuffers);
          newBuffers.set(message.msgId, { ...buffer, content: buffer.content + message.payload.content });
          return { ...prev, textBuffers: newBuffers };
        }

        case MessageType.TEXT_COMPLETE: {
          const buffer = prev.textBuffers.get(message.msgId);
          if (!buffer) return prev;
          const newBuffers = new Map(prev.textBuffers);
          newBuffers.set(message.msgId, { ...buffer, isStreaming: false });
          return {
            ...prev, 
            textBuffers: newBuffers,
            completedEntries: [...prev.completedEntries, { kind: 'text' as const, id: message.msgId, content: buffer.content, isStreaming: false, timestamp: buffer.startTime }],
            currentTextId: null,
          };
        }

        case MessageType.TOOL_CALL_CREATED: {
          const newToolBuffers = new Map(prev.toolBuffers);
          for (const tool of message.payload.tool_calls) {
            newToolBuffers.set(tool.callId, { callId: tool.callId, toolName: tool.toolName, args: tool.args, output: '', status: 'running' as const, isStreaming: true, startTime: message.timestamp });
          }
          return { ...prev, toolBuffers: newToolBuffers };
        }

        case MessageType.TOOL_CALL_STREAM: {
          const buffer = prev.toolBuffers.get(message.payload.callId);
          if (!buffer) return prev;
          const newToolBuffers = new Map(prev.toolBuffers);
          newToolBuffers.set(message.payload.callId, { ...buffer, output: buffer.output + message.payload.output });
          return { ...prev, toolBuffers: newToolBuffers };
        }

        case MessageType.TOOL_CALL_RESULT: {
          const buffer = prev.toolBuffers.get(message.payload.callId);
          if (!buffer) return prev;
          const newToolBuffers = new Map(prev.toolBuffers);
          newToolBuffers.set(message.payload.callId, { ...buffer, status: message.payload.status, isStreaming: false, output: typeof message.payload.result === 'string' ? message.payload.result : JSON.stringify(message.payload.result) });
          return { ...prev, toolBuffers: newToolBuffers };
        }

        case MessageType.ERROR:
          return { ...prev, completedEntries: [...prev.completedEntries, { kind: 'error' as const, id: generateId(), message: message.payload.error, phase: message.payload.phase, timestamp: message.timestamp }] };

        default:
          return prev;
      }
    });
  }, [generateId]);

  const addUserMessage = useCallback((content: string) => {
    setState(prev => ({ ...prev, completedEntries: [...prev.completedEntries, { kind: 'user' as const, id: generateId(), content, timestamp: Date.now() }] }));
  }, [generateId]);

  const reset = useCallback(() => {
    setState({ status: AgentStatus.IDLE, currentTextId: null, textBuffers: new Map(), toolBuffers: new Map(), completedEntries: [], sessionId: '' });
  }, []);

  return { 
    status: state.status, 
    sessionId: state.sessionId, 
    completedEntries: state.completedEntries, 
    currentStreamingText,  // 现在是派生状态，不是函数
    processMessage, 
    addUserMessage, 
    reset 
  };
}
