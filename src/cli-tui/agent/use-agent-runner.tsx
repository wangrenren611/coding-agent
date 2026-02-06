import { useCallback, useEffect, useRef } from 'react';
import { Agent } from '../../agent-v2/agent/agent';
import { AgentStatus } from '../../agent-v2/agent/types';
import { operatorPrompt } from '../../agent-v2/prompts/operator';
import { ProviderRegistry, type ModelId } from '../../providers';
import { useChatStore } from '../state/chat-store';
import { StreamAdapter } from './stream-adapter';

export interface UseAgentRunnerReturn {
  messages: ReturnType<typeof useChatStore>['messages'];
  isLoading: boolean;
  executionState: ReturnType<typeof useChatStore>['executionState'];
  statusMessage?: string;
  submitMessage: (input: string) => void;
  clearMessages: () => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string) => void;
  stopCurrentRun: () => void;
}

export function useAgentRunner(model: ModelId): UseAgentRunnerReturn {
  const agentRef = useRef<Agent | null>(null);
  const adapterRef = useRef<StreamAdapter | null>(null);
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
  } = useChatStore();

  applyEventRef.current = applyEvent;

  const initAgent = useCallback(() => {
    try {
      const provider = ProviderRegistry.createFromEnv(model);
      const adapter = new StreamAdapter(event => applyEventRef.current?.(event));
      const agent = new Agent({
        provider,
        systemPrompt: operatorPrompt({
          directory: process.cwd(),
          vcs: 'git',
          language: 'Chinese',
        }),
        stream: true,
        streamCallback: message => adapter.handleAgentMessage(message),
      });

      agentRef.current = agent;
      adapterRef.current = adapter;
      setStatusMessage(`Model: ${model}`);
      setExecutionState('idle');
    } catch (error) {
      agentRef.current = null;
      adapterRef.current = null;
      const message = error instanceof Error ? error.message : String(error);
      addSystemMessage('error', `Failed to initialize model '${model}': ${message}`);
      setExecutionState('error', 'Model initialization failed');
    }
  }, [addSystemMessage, model, setExecutionState, setStatusMessage]);

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

      if (agent.getStatus() !== AgentStatus.IDLE) {
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
  };
}
