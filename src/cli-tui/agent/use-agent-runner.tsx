/**
 * Agent Runner Hook with Session Storage
 *
 * Integrates agent-v2 Agent with persistent session storage.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Agent } from '../../agent-v2/agent/agent';
import { AgentStatus } from '../../agent-v2/agent/types';
import { operatorPrompt } from '../../agent-v2/prompts/operator';
import { ProviderRegistry, type ModelId } from '../../providers';
import { useChatStore } from '../state/chat-store';
import { StreamAdapter } from './stream-adapter';
import { createMemoryManager } from '../../agent-v2/memory';

export interface UseAgentRunnerReturn {
  messages: ReturnType<typeof useChatStore>['messages'];
  isLoading: boolean;
  executionState: ReturnType<typeof useChatStore>['executionState'];
  statusMessage?: string;
  submitMessage: (input: string) => void;
  clearMessages: () => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string) => void;
  stopCurrentRun: () => void;
  sessions: ReturnType<typeof useChatStore>['sessions'];
  currentSessionId: ReturnType<typeof useChatStore>['currentSessionId'];
  isStorageReady: boolean;
  createNewSession: (title?: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSessionById: (sessionId: string) => Promise<void>;
}

const STORAGE_PATH = process.env.CODING_AGENT_SESSIONS_PATH || '.coding-agent/sessions';

export function useAgentRunner(model: ModelId): UseAgentRunnerReturn {
  const agentRef = useRef<Agent | null>(null);
  const adapterRef = useRef<StreamAdapter | null>(null);
  const memoryManagerRef = useRef<ReturnType<typeof createMemoryManager> | null>(null);
  const applyEventRef = useRef<ReturnType<typeof useChatStore>['applyEvent'] | null>(null);

  const {
    messages,
    isLoading,
    executionState,
    statusMessage,
    addUserMessage,
    applyEvent,
    clearMessages,
    setLoading,
    setExecutionState,
    setStatusMessage,
    addSystemMessage,
    sessions,
    currentSessionId,
    isStorageReady,
    createNewSession,
    loadSession,
    deleteSessionById,
  } = useChatStore();

  applyEventRef.current = applyEvent;

  // Initialize MemoryManager
  useEffect(() => {
    const mm = createMemoryManager({
      type: 'file',
      connectionString: STORAGE_PATH,
    });
    memoryManagerRef.current = mm;

    mm.initialize().catch(error => {
      console.error('Failed to initialize memory manager:', error);
    });

    return () => {
      mm.close().catch(console.error);
    };
  }, []);

  const initAgent = useCallback(() => {
    try {
      const provider = ProviderRegistry.createFromEnv(model);
      const adapter = new StreamAdapter(event => applyEventRef.current?.(event));

      // Create agent with sessionId and memoryManager if available
      const agentConfig: {
        provider: ReturnType<typeof ProviderRegistry.createFromEnv>;
        systemPrompt: string;
        stream: boolean;
        streamCallback: (message: import('../../agent-v2/agent/stream-types').AgentMessage) => void;
        sessionId?: string;
        memoryManager?: ReturnType<typeof createMemoryManager>;
      } = {
        provider,
        systemPrompt: operatorPrompt({
          directory: process.cwd(),
          vcs: 'git',
          language: 'Chinese',
        }),
        stream: true,
        streamCallback: message => adapter.handleAgentMessage(message),
      };

      // Add session persistence if we have a current session
      if (currentSessionId && memoryManagerRef.current) {
        agentConfig.sessionId = currentSessionId;
        agentConfig.memoryManager = memoryManagerRef.current;
      }
      
      const agent = new Agent(agentConfig);

      agentRef.current = agent;
      adapterRef.current = adapter;
      setStatusMessage(`Model: ${model}${currentSessionId ? ` | Session: ${currentSessionId.slice(0, 8)}` : ''}`);
      setExecutionState('idle');
    } catch (error) {
      agentRef.current = null;
      adapterRef.current = null;
      const message = error instanceof Error ? error.message : String(error);
      addSystemMessage('error', `Failed to initialize model '${model}': ${message}`);
      setExecutionState('error', 'Model initialization failed');
    }
  }, [addSystemMessage, model, setExecutionState, setStatusMessage, currentSessionId]);

  // Re-initialize agent when session changes
  useEffect(() => {
    initAgent();

    return () => {
      adapterRef.current?.dispose();
      agentRef.current?.abort();
      adapterRef.current = null;
      agentRef.current = null;
    };
  }, [initAgent]);

  const submitMessage = useCallback(
    (input: string) => {
      const message = input.trim();
      if (!message) return;

      const agent = agentRef.current;
      if (!agent) {
        addSystemMessage('error', 'Agent is not initialized. Check model and API config.');
        return;
      }

      const status = agent.getStatus();
      if (
        status === AgentStatus.RUNNING ||
        status === AgentStatus.THINKING ||
        status === AgentStatus.RETRYING
      ) {
        agent.abort();
      }

      addUserMessage(message);
      setLoading(true);
      setStatusMessage(undefined);

      agent
        .execute(message)
        .then(() => {
          setLoading(false);
        })
        .catch(error => {
          setLoading(false);
          applyEventRef.current?.({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
            phase: 'agent.execute',
          });
        });
    },
    [addSystemMessage, addUserMessage, setLoading, setStatusMessage]
  );

  const stopCurrentRun = useCallback(() => {
    const agent = agentRef.current;
    if (!agent) return;

    const status = agent.getStatus();
    if (status === AgentStatus.RUNNING || status === AgentStatus.THINKING || status === AgentStatus.RETRYING) {
      agent.abort();
      setLoading(false);
      setExecutionState('idle', 'Stopped');
    }
  }, [setExecutionState, setLoading]);

  return {
    messages,
    isLoading,
    executionState,
    statusMessage,
    submitMessage,
    clearMessages,
    addSystemMessage,
    stopCurrentRun,
    sessions,
    currentSessionId,
    isStorageReady,
    createNewSession,
    loadSession,
    deleteSessionById,
  };
}
