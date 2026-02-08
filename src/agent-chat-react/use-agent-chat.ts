import { useContext } from "react";
import { AgentChatContext } from "./context";
import type { AgentChatContextValue } from "./types";

export function useAgentChat(): AgentChatContextValue {
  const context = useContext(AgentChatContext);
  if (!context) {
    throw new Error("useAgentChat must be used within AgentChatProvider");
  }
  return context;
}
