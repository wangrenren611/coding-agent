/**
 * Agent runtime hook
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { Agent } from '../../../src/agent-v2/agent/agent.js';
import { operatorPrompt } from '../../../src/agent-v2/prompts/operator.js';
import { ProviderRegistry } from '../../../src/providers/registry.js';
import { createMemoryManager } from '../../../src/agent-v2/memory/index.js';
import type { AgentMessage } from '../../../src/agent-v2/agent/stream-types.js';
import type { StreamMessage } from './types.js';
import { MessageType, AgentStatus } from './types.js';

export interface UseAgentOptions {
  model: string;
  cwd: string;
  language: string;
}

export function useAgent(options: UseAgentOptions) {
  const agentRef = useRef<Agent | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const isCreatingRef = useRef(false);
  const onMessageRef = useRef<((msg: StreamMessage) => void) | null>(null);

  const createAgent = useCallback(async () => {
    while (isCreatingRef.current) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (agentRef.current) {
      return agentRef.current;
    }

    isCreatingRef.current = true;

    try {
      console.error('[useAgent] Creating agent with model:', options.model);
      
      const memoryManager = createMemoryManager({
        type: 'file',
        connectionString: './data/agent-memory-v2',
      });
      await memoryManager.initialize();

      const provider = ProviderRegistry.createFromEnv(options.model as never);
      console.error('[useAgent] Provider created');

      const agent = new Agent({
        provider,
        systemPrompt: operatorPrompt({
          directory: options.cwd,
          language: options.language,
        }),
        stream: true,
        memoryManager,
        streamCallback: (message: AgentMessage) => {
          console.error('[useAgent] Stream callback:', message.type);
          const callback = onMessageRef.current;
          if (callback) {
            const streamMsg = convertAgentMessage(message);
            if (streamMsg) {
              callback(streamMsg);
            }
          }
        },
      });

      agentRef.current = agent;
      console.error('[useAgent] Agent created');
      return agent;
    } catch (err) {
      console.error('[useAgent] Create error:', err);
      throw err;
    } finally {
      isCreatingRef.current = false;
    }
  }, [options.model, options.cwd, options.language]);

  useEffect(() => {
    createAgent().catch(err => {
      console.error('[useAgent] Init error:', err);
    });
    return () => {
      if (agentRef.current) {
        agentRef.current.abort();
        agentRef.current = null;
      }
    };
  }, [createAgent]);

  const execute = useCallback(async (
    query: string,
    onMessage: (msg: StreamMessage) => void
  ) => {
    if (isExecuting) {
      console.error('[useAgent] Already executing');
      return;
    }

    onMessageRef.current = onMessage;
    setIsExecuting(true);

    try {
      if (!agentRef.current) {
        console.error('[useAgent] No agent, creating...');
        await createAgent();
      }
      
      if (!agentRef.current) {
        throw new Error('Failed to create agent');
      }

      console.error('[useAgent] Executing:', query);
      await agentRef.current.execute(query);
      console.error('[useAgent] Execute complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[useAgent] Execute error:', message);
      onMessage({
        type: MessageType.ERROR,
        payload: { error: message },
        sessionId: agentRef.current?.getSessionId() || '',
        timestamp: Date.now(),
      });
    } finally {
      setIsExecuting(false);
    }
  }, [isExecuting, createAgent]);

  const abort = useCallback(() => {
    agentRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    agentRef.current?.abort();
    agentRef.current = null;
    onMessageRef.current = null;
  }, []);

  return { isExecuting, execute, abort, reset };
}

function convertAgentMessage(message: AgentMessage): StreamMessage | null {
  const base = { sessionId: message.sessionId, timestamp: message.timestamp };

  switch (message.type) {
    case 'text-start':
      return { ...base, type: MessageType.TEXT_START, payload: { content: message.payload.content }, msgId: message.msgId };
    case 'text-delta':
      return { ...base, type: MessageType.TEXT_DELTA, payload: { content: message.payload.content }, msgId: message.msgId };
    case 'text-complete':
      return { ...base, type: MessageType.TEXT_COMPLETE, payload: { content: message.payload.content }, msgId: message.msgId };
    case 'tool_call_created':
      return { ...base, type: MessageType.TOOL_CALL_CREATED, payload: { tool_calls: message.payload.tool_calls.map(tc => ({ callId: tc.callId, toolName: tc.toolName, args: tc.args })), content: message.payload.content }, msgId: message.msgId };
    case 'tool_call_stream':
      return { ...base, type: MessageType.TOOL_CALL_STREAM, payload: { callId: message.payload.callId, output: message.payload.output }, msgId: message.msgId };
    case 'tool_call_result':
      return { ...base, type: MessageType.TOOL_CALL_RESULT, payload: { callId: message.payload.callId, status: message.payload.status, result: message.payload.result, exitCode: message.payload.exitCode }, msgId: message.msgId };
    case 'code_patch':
      return { ...base, type: MessageType.CODE_PATCH, payload: { path: message.payload.path, diff: message.payload.diff, language: message.payload.language }, msgId: message.msgId };
    case 'status':
      return { ...base, type: MessageType.STATUS, payload: { state: convertAgentStatus(message.payload.state), message: message.payload.message }, msgId: message.msgId };
    case 'error':
      return { ...base, type: MessageType.ERROR, payload: { error: message.payload.error, phase: message.payload.phase } };
    default:
      return null;
  }
}

function convertAgentStatus(status: string): AgentStatus {
  return { idle: AgentStatus.IDLE, thinking: AgentStatus.THINKING, running: AgentStatus.RUNNING, completed: AgentStatus.COMPLETED, failed: AgentStatus.FAILED, aborted: AgentStatus.ABORTED }[status] || AgentStatus.IDLE;
}
