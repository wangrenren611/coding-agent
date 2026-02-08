import React, { createContext, useCallback, useMemo, useReducer, type ReactNode } from "react";
import type { AgentMessage } from "../agent-v2/agent/stream-types";
import { agentChatReducer, createInitialAgentChatState } from "./reducer";
import { selectLatestAssistantMessage } from "./selectors";
import type { AgentChatContextValue } from "./types";

const AgentChatContext = createContext<AgentChatContextValue | undefined>(undefined);

export interface AgentChatProviderProps {
  children: ReactNode;
}

export function AgentChatProvider({ children }: AgentChatProviderProps): React.JSX.Element {
  const [state, dispatch] = useReducer(agentChatReducer, undefined, createInitialAgentChatState);

  const ingestStreamMessage = useCallback((message: AgentMessage) => {
    dispatch({ type: "INGEST_STREAM_MESSAGE", message });
  }, []);

  const pruneMessages = useCallback((keepLast?: number) => {
    dispatch({ type: "PRUNE_MESSAGES", keepLast: keepLast ?? 20 });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  const latestAssistantMessage = useMemo(() => {
    return selectLatestAssistantMessage(state);
  }, [state]);

  const value = useMemo<AgentChatContextValue>(() => {
    return {
      messages: state.messages,
      latestAssistantMessage,
      status: state.status,
      isStreaming: state.isStreaming,
      error: state.error,
      ingestStreamMessage,
      pruneMessages,
      reset,
      clearError,
    };
  }, [
    state.messages,
    state.status,
    state.isStreaming,
    state.error,
    latestAssistantMessage,
    ingestStreamMessage,
    pruneMessages,
    reset,
    clearError,
  ]);

  return (
    <AgentChatContext.Provider value={value}>
      {children}
    </AgentChatContext.Provider>
  );
}

export { AgentChatContext };
