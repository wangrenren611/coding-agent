import { z } from 'zod';
import { Agent } from '../../agent/agent';
import type { BaseTool } from '../base';
import type { IMemoryManager } from '../../memory/types';
import type { Message } from '../../session/types';

export type ToolClassConstructor = new () => BaseTool<z.ZodType>;

export enum SubagentType {
  Bash = 'bash',
  GeneralPurpose = 'general-purpose',
  Explore = 'explore',
  Plan = 'plan',
  UiSketcher = 'ui-sketcher',
  BugAnalyzer = 'bug-analyzer',
  CodeReviewer = 'code-reviewer',
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type BackgroundTaskStatus = 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
export type ModelHint = 'sonnet' | 'opus' | 'haiku';

export interface ManagedTask {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: TaskStatus;
  owner?: string;
  metadata?: Record<string, unknown>;
  blocks: string[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundExecution {
  taskId: string;
  parentSessionId: string;
  childSessionId: string;
  memoryManager?: IMemoryManager;
  storage: 'memory_manager' | 'memory_fallback';
  status: BackgroundTaskStatus;
  createdAt: string;
  startedAt: string;
  finishedAt?: string;
  lastActivityAt?: string;
  lastToolName?: string;
  description: string;
  prompt: string;
  subagentType: SubagentType;
  model?: ModelHint;
  resume?: string;
  output?: string;
  error?: string;
  turns?: number;
  toolsUsed: string[];
  messages: Message[];
  stopRequested: boolean;
  heartbeatTimer?: NodeJS.Timeout;
  lastHeartbeatPersistAt?: number;
  lastPersistedMessageCount?: number;
  agent?: Agent;
  promise?: Promise<void>;
}

export interface SubagentResult {
  status: 'completed' | 'failed' | 'cancelled';
  turns: number;
  toolsUsed: string[];
  output: string;
  messages: Message[];
  errorCode?: string;
  errorMessage?: string;
}

export interface AgentConfig {
  tools: ToolClassConstructor[];
  systemPrompt: string;
  maxRetries?: number;
}

export const JsonObjectSchema = z.record(z.string(), z.unknown());
export const JsonPatchSchema = z.record(z.string(), z.union([z.unknown(), z.null()]));

export const ManagedTaskSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  description: z.string().min(1),
  activeForm: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed']),
  owner: z.string().optional(),
  metadata: JsonObjectSchema.optional(),
  blocks: z.array(z.string().min(1)),
  blockedBy: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();

export const ManagedTaskListSchema = z.array(ManagedTaskSchema);

export const TASK_TOOL_DESCRIPTION = `The Task tool launches specialized agents (subprocesses) that autonomously handle complex
tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- Bash: Command execution specialist for running bash commands.
  Use this for git operations, command execution, and other terminal tasks.
  Tools: Bash

- general-purpose: General-purpose agent for researching complex questions,
  searching code, and executing multi-step tasks.
  When you are searching for a keyword or file and you are not confident that
  you will find the right match in the first few tries use this agent to perform
  the search for you.
  Tools: *

- statusline-setup: Use this agent to configure the user's Claude Code status
  line setting.
  Tools: Read, Edit

- Explore: Fast agent specialized for exploring codebases.
  Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"),
  search code for keywords (eg. "API endpoints"), or answer questions about the codebase
  (eg. "how do API endpoints work?").
  When calling this agent, specify the thoroughness level: "quick" for basic searches,
  "medium" for moderate exploration, or "very thorough" for comprehensive analysis
  across multiple locations and naming conventions.
  Tools: All tools except Task, ExitPlanMode, Edit, Write, NotebookEdit

- Plan: Software architect agent for designing implementation plans.
  Use this when you need to plan the implementation strategy for a task.
  Returns step-by-step plans, identifies critical files, and considers architectural
  trade-offs.
  Tools: All tools except Task, ExitPlanMode, Edit, Write, NotebookEdit

- claude-code-guide: Use this agent when you ask questions (e.g., "Can Claude...",
  "Does Claude...", "How do I...") about: (1) Claude Code (the CLI tool) - features,
  hooks, slash commands, MCP servers, settings, IDE integrations, keyboard shortcuts;
  (2) Claude Agent SDK - building custom agents; (3) Claude API (formerly Anthropic API)
  - API usage, tool use, Anthropic SDK usage.
  IMPORTANT: Before spawning a new agent, check if there is already a running or
  recently completed claude-code-guide agent that you can resume using the "resume" parameter.
  Tools: Glob, Grep, Read, WebFetch, WebSearch

- ui-sketcher: Universal UI Blueprint Engineer that transforms any functional requirement
  into visual ASCII interface designs, user stories, and interaction specifications.
  Excels at converting brief descriptions into comprehensive user journeys with spatial
  layout visualization.
  Tools: Bash, Glob, Grep, Read, WebFetch, TodoWrite, WebSearch, BashOutput, KillShell,
  ListMcpResourcesTool, ReadMcpResourceTool

- bug-analyzer: Expert debugger specialized in deep code execution flow analysis and root
  cause investigation. Use when you need to analyze code execution paths, build execution
  chain diagrams, trace variable state changes, or perform deep root cause analysis.
  Tools: read_file, write_file, run_bash_command, search_files, grep

- code-reviewer: Elite code review expert specializing in modern AI-powered code analysis,
  security vulnerabilities, performance optimization, and production reliability. Masters
  static analysis tools, security scanning, and configuration review with 2024/2025 best
  practices. Open-sourced by @wshonson.
  Use PROACTIVELY for code quality assurance. Open-sourced by @wshonson.
  Tools: All tools

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do.
- Launch multiple agents concurrently for maximum performance.
- If you want to read a specific file path, use the Read or Glob tool instead.
- When NOT to use the Task tool: Direct file operations, single-file code searches.
- IMPORTANT: When searching for a keyword or file and you are not confident you will find
  the right match in the first few tries, use the Task tool.

IMPORTANT: Use the Task tool with subagent_type=Explore instead of running search commands
directly when exploring the codebase to gather context or answer questions that are not a
needle query for a specific file/class/function.

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Glob tool instead
- For direct file operations
- For single-file code searches`;

export const TASK_CREATE_DESCRIPTION = `Use this tool proactively to create a structured task list for your current coding session.
This helps you track progress, organize complex tasks, and demonstrate thoroughness to the
user. It also helps the user understand the progress of the task and overall progress of
their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:
- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide multiple tasks (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do.

## Task Fields

- subject: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- description: Detailed description of what needs to be done, including context and acceptance criteria
- activeForm: Present continuous form shown in spinner when task is in_progress
  (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative
("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are
created with status \`pending\`.`;

export const TASK_GET_DESCRIPTION = `Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- subject: Task title
- description: Detailed requirements and context
- status: 'pending', 'in_progress', or 'completed'
- blocks: Tasks waiting on this one to complete
- blockedBy: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work
- Use TaskList to see all tasks in summary form`;
export const TASK_LIST_DESCRIPTION = `Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task

**Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available,
as earlier tasks often set up context for later ones.

## Output

Returns a summary of each task:
- id: Task identifier (use with TaskGet, TaskUpdate)
- subject: Brief description of the task
- status: 'pending', 'in_progress', or 'completed'
- owner: Agent ID if assigned, empty if available
- blockedBy: List of open task IDs that must be resolved first (tasks with blockedBy
  cannot be claimed until dependencies resolve)`;
export const TASK_UPDATE_DESCRIPTION = `Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to \`deleted\` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- status: The task status (see Status Workflow below)
- subject: Change the task title (imperative form, e.g., "Run tests")
- description: Change the task description
- activeForm: Present continuous form shown in spinner when task is in_progress
  (e.g., "Running tests")
- owner: Change the task owner (agent name)
- metadata: Merge metadata keys into the task (set to null to delete it)
- addBlocks: Mark tasks that cannot start until this one completes
- addBlockedBy: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: \`pending\` → \`in_progress\` → \`completed\`

Use \`deleted\` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using \`TaskGet\` before updating it.

## Examples

Mark task as in progress when starting work:
{"taskId": "1", "status": "in_progress"}

Mark task as completed after finishing work:
{"taskId": "1", "status": "completed"}

Delete a task:
{"taskId": "1", "status": "deleted"}

Claim a task by setting owner:
{"taskId": "1", "owner": "my-name"}

Set up task dependencies:
{"taskId": "2", "addBlockedBy": ["1"]}`;
export const TASK_OUTPUT_DESCRIPTION = `- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions`;
export const TASK_STOP_DESCRIPTION = `- Stops a running background task by its ID
- Takes a task_id parameter identifying the task
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task`;

export const MANAGED_TASK_PARENT_ID = '__task_tool_managed__';
export const MANAGED_TASK_SCHEMA_VERSION = 1;
export const BACKGROUND_HEARTBEAT_INTERVAL_MS = 1000;
export const BACKGROUND_HEARTBEAT_PERSIST_INTERVAL_MS = 1500;

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowMs(): number {
  return Date.now();
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.trim().length > 0)));
}

export function compareTaskIds(a: string, b: string): number {
  const numA = /^\d+$/.test(a) ? Number.parseInt(a, 10) : Number.NaN;
  const numB = /^\d+$/.test(b) ? Number.parseInt(b, 10) : Number.NaN;
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
    return numA - numB;
  }
  if (!Number.isNaN(numA)) return -1;
  if (!Number.isNaN(numB)) return 1;
  return a.localeCompare(b);
}

const taskIdCounters = new Map<string, number>();

function taskCounterKey(sessionId?: string): string {
  return sessionId || '__memory__';
}

export function nextTaskId(tasks: ManagedTask[], sessionId?: string): string {
  let maxId = 0;
  for (const task of tasks) {
    if (/^\d+$/.test(task.id)) {
      maxId = Math.max(maxId, Number.parseInt(task.id, 10));
    }
  }

  const counterKey = taskCounterKey(sessionId);
  const lastIssued = taskIdCounters.get(counterKey) ?? 0;
  const nextId = Math.max(maxId, lastIssued) + 1;
  taskIdCounters.set(counterKey, nextId);
  return String(nextId);
}

export function clearTaskIdCounterState(sessionId?: string): void {
  if (!sessionId) {
    taskIdCounters.clear();
    return;
  }

  taskIdCounters.delete(taskCounterKey(sessionId));
}

export function isStatusTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  const transitions: Record<TaskStatus, TaskStatus[]> = {
    pending: ['in_progress'],
    in_progress: ['completed'],
    completed: [],
  };
  return transitions[from].includes(to);
}

export function extractOpenDependencies(tasks: ManagedTask[], blockedBy: string[]): string[] {
  const openSet = new Set(
    tasks
      .filter((t) => t.status !== 'completed')
      .map((t) => t.id),
  );
  return unique(blockedBy).filter((id) => openSet.has(id));
}

export function createExecutionId(): string {
  return `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function buildSubTaskSessionId(parentSessionId: string, taskId: string): string {
  return `${parentSessionId}::subtask::${taskId}`;
}

export function normalizeMessagesForStorage(messages: unknown): Message[] {
  try {
    if (!Array.isArray(messages)) return [];
    return JSON.parse(JSON.stringify(messages)) as Message[];
  } catch {
    return [];
  }
}

export function getMessageCount(messages: unknown): number {
  return Array.isArray(messages) ? messages.length : 0;
}

export function toIso(ts?: number): string | undefined {
  return ts ? new Date(ts).toISOString() : undefined;
}

export function pickLastToolName(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = messages[i]?.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (let j = calls.length - 1; j >= 0; j--) {
      const name = calls[j]?.function?.name;
      if (name) return name;
    }
  }
  return undefined;
}

export function toRunTimestamps(createdAtIso: string, startedAtIso: string, finishedAtIso?: string): {
  createdAt: number;
  startedAt: number;
  finishedAt?: number;
} {
  return {
    createdAt: new Date(createdAtIso).getTime(),
    startedAt: new Date(startedAtIso).getTime(),
    ...(finishedAtIso ? { finishedAt: new Date(finishedAtIso).getTime() } : {}),
  };
}

export function extractToolsUsed(messages: Array<{ tool_calls?: Array<{ function?: { name?: string } }> }>): string[] {
  const tools = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      const name = call?.function?.name;
      if (name) tools.add(name);
    }
  }
  return Array.from(tools);
}

export function messageContentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object' || !('type' in part)) {
        return '';
      }

      const typedPart = part as {
        type?: string;
        text?: string;
        image_url?: { url?: string };
        file?: { filename?: string; file_id?: string };
        input_audio?: unknown;
        input_video?: { url?: string; file_id?: string };
      };

      switch (typedPart.type) {
        case 'text':
          return typedPart.text || '';
        case 'image_url':
          return `[image] ${typedPart.image_url?.url || ''}`.trim();
        case 'file':
          return `[file] ${typedPart.file?.filename || typedPart.file?.file_id || ''}`.trim();
        case 'input_audio':
          return '[audio]';
        case 'input_video':
          return `[video] ${typedPart.input_video?.url || typedPart.input_video?.file_id || ''}`.trim();
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}
