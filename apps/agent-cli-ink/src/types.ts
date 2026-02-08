import type { AgentStatus } from "../../../src/agent-v2/agent/types";
import type { UIMessage } from "./agent-chat-react/types";

export interface CliOptions {
  model: string;
  cwd: string;
  language: string;
  keepLastMessages: number;
}

export type LocalEntryType = "user" | "system";

export interface LocalTimelineEntry {
  id: string;
  type: LocalEntryType;
  text: string;
  createdAt: number;
}

export type TimelineEntry =
  | {
      id: string;
      type: "user";
      text: string;
      createdAt: number;
    }
  | {
      id: string;
      type: "assistant";
      text: string;
      loading: boolean;
      createdAt: number;
    }
  | {
      id: string;
      type: "tool";
      toolName: string;
      args: string;
      loading: boolean;
      status: "success" | "error" | "running";
      output: string;
      createdAt: number;
    }
  | {
      id: string;
      type: "code_patch";
      path: string;
      diff: string;
      createdAt: number;
    }
  | {
      id: string;
      type: "error";
      error: string;
      phase?: string;
      createdAt: number;
    }
  | {
      id: string;
      type: "system";
      text: string;
      createdAt: number;
    };

export type SlashCommandType =
  | "help"
  | "clear"
  | "pause"
  | "resume"
  | "reset"
  | "abort"
  | "exit"
  | "prune";

export interface SlashCommand {
  type: SlashCommandType;
  keepLast?: number;
}

export interface RuntimeSnapshot {
  status: AgentStatus;
  isStreaming: boolean;
  sessionId: string;
  isExecuting: boolean;
  timelineEntries: TimelineEntry[];
  rawMessages: UIMessage[];
}
