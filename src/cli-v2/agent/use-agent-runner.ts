import { useCallback, useEffect, useRef } from 'react';
import { Agent } from '../../agent-v2/agent/agent';
import { AgentStatus } from '../../agent-v2/agent/types';
import { operatorPrompt } from '../../agent-v2/prompts/operator';
import { ProviderRegistry, type ModelId } from '../../providers';
import { StreamAdapter } from './stream-adapter';
import { useChatStore } from '../state/chat-store';

export interface UseAgentRunnerReturn {
  messages: ReturnType<typeof useChatStore>['messages'];
  isLoading: boolean;
  submitMessage: (input: string) => void;
  clearMessages: () => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string) => void;
}

export function useAgentRunner(model: ModelId): UseAgentRunnerReturn {
  const agentRef = useRef<Agent | null>(null);
  const adapterRef = useRef<StreamAdapter | null>(null);
  const applyEventRef = useRef<ReturnType<typeof useChatStore>['applyEvent'] | null>(null);

  const { messages, isLoading, addUserMessage, applyEvent, clearMessages, setLoading, addSystemMessage } = useChatStore();

  applyEventRef.current = applyEvent;

  const initAgent = useCallback(() => {
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
  }, [model]);

  useEffect(() => {
    initAgent();

    return () => {
      adapterRef.current?.dispose();
      agentRef.current?.abort();
    };
  }, [initAgent]);

  const submitMessage = useCallback(
    (input: string) => {
      const message = input.trim();
      if (!message) return;

      const agent = agentRef.current;
      if (!agent) return;

      if (agent.getStatus() !== AgentStatus.IDLE) {
        agent.abort();
      }

      addUserMessage(message);
      setLoading(true);

      agent.execute(message)
        .then(() => {
          setLoading(false);
        })
        .catch((error) => {
          setLoading(false);
          applyEventRef.current?.({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
            phase: 'agent.execute',
          });
        });
    },
    [addUserMessage, setLoading]
  );

  return {
    messages,
    isLoading,
    submitMessage,
    clearMessages,
    addSystemMessage,
  };
}
