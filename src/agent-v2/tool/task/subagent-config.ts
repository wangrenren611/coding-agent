import { z } from 'zod';
import BashTool from '../bash';
import GlobTool from '../glob';
import GrepTool from '../grep';
import { ReadFileTool, WriteFileTool } from '../file';
import { SurgicalEditTool } from '../surgical';
import { BatchReplaceTool } from '../batch-replace';
import { LspTool } from '../lsp';
import { WebSearchTool } from '../web-search';
import { WebFetchTool } from '../web-fetch';
import { AgentConfig, SubagentType } from './shared';

export const SubagentTypeSchema = z.enum([
  SubagentType.Bash,
  SubagentType.GeneralPurpose,
  SubagentType.Explore,
  SubagentType.Plan,
  SubagentType.ClaudeCodeGuide,
  SubagentType.UiSketcher,
  SubagentType.BugAnalyzer,
  SubagentType.CodeReviewer,
]);

export const AGENT_CONFIGS: Record<SubagentType, AgentConfig> = {
  [SubagentType.Bash]: {
    tools: [BashTool],
    systemPrompt: `You are a shell execution specialist.
Run commands safely and explain outcomes clearly.
Prefer concise outputs and avoid unrelated work.`,
    maxRetries: 5,
  },
  [SubagentType.GeneralPurpose]: {
    tools: [BashTool, GlobTool, GrepTool, ReadFileTool, WriteFileTool, SurgicalEditTool, BatchReplaceTool, LspTool, WebSearchTool, WebFetchTool],
    systemPrompt: `You are a general software engineering sub-agent.
Handle multi-step tasks pragmatically, verify your work, and keep responses concise.`,
    maxRetries: 10,
  },
  [SubagentType.Explore]: {
    tools: [GlobTool, GrepTool, ReadFileTool, WebSearchTool, WebFetchTool],
    systemPrompt: `You are a codebase exploration specialist.
Focus on discovery, structure, and evidence-backed findings.
Do not modify files.`,
    maxRetries: 8,
  },
  [SubagentType.Plan]: {
    tools: [GlobTool, GrepTool, ReadFileTool, LspTool, WebSearchTool, WebFetchTool],
    systemPrompt: `You are a software architecture planner.
Produce concrete implementation plans with tradeoffs, risks, and sequencing.`,
    maxRetries: 8,
  },
  [SubagentType.ClaudeCodeGuide]: {
    tools: [GlobTool, GrepTool, ReadFileTool, WebSearchTool, WebFetchTool],
    systemPrompt: `You are a Claude Code usage expert.
Answer feature, API, and workflow questions with practical examples.`,
    maxRetries: 6,
  },
  [SubagentType.UiSketcher]: {
    tools: [BashTool, GlobTool, GrepTool, ReadFileTool, WebSearchTool, WebFetchTool],
    systemPrompt: `You are a UI sketching specialist.
Translate requirements into clear, textual interface concepts and layout structures.`,
    maxRetries: 6,
  },
  [SubagentType.BugAnalyzer]: {
    tools: [BashTool, GlobTool, GrepTool, ReadFileTool, WriteFileTool, LspTool],
    systemPrompt: `You are a debugging specialist.
Trace execution paths, identify root causes, and propose minimal-risk fixes.`,
    maxRetries: 10,
  },
  [SubagentType.CodeReviewer]: {
    tools: [BashTool, GlobTool, GrepTool, ReadFileTool, LspTool, WebSearchTool, WebFetchTool],
    systemPrompt: `You are an elite code reviewer.
Prioritize correctness, security, performance, and reliability findings.`,
    maxRetries: 8,
  },
};
