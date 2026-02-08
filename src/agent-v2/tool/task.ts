/**
 * Task tools entrypoint
 *
 * Responsibilities in this file:
 * - Tool schemas + tool classes
 * - High-level orchestration across task stores and background runtime
 */

import { z } from 'zod';
import { Agent } from '../agent/agent';
import { LLMProvider } from '../../providers';
import { BaseTool, ToolContext, ToolResult } from './base';
import { ToolRegistry } from './registry';
import type { ToolRegistryConfig } from './registry';
import type { IMemoryManager } from '../memory/types';
import { AGENT_CONFIGS, SubagentTypeSchema } from './task/subagent-config';
import {
  BackgroundExecution,
  JsonObjectSchema,
  JsonPatchSchema,
  ModelHint,
  SubagentResult,
  SubagentType,
  TASK_CREATE_DESCRIPTION,
  TASK_GET_DESCRIPTION,
  TASK_LIST_DESCRIPTION,
  TASK_OUTPUT_DESCRIPTION,
  TASK_STOP_DESCRIPTION,
  TASK_TOOL_DESCRIPTION,
  TASK_UPDATE_DESCRIPTION,
  compareTaskIds,
  createExecutionId,
  extractOpenDependencies,
  extractToolsUsed,
  getMessageCount,
  isStatusTransitionAllowed,
  messageContentToText,
  clearTaskIdCounterState,
  nextTaskId,
  normalizeMessagesForStorage,
  nowIso,
  pickLastToolName,
  toIso,
  unique,
} from './task/shared';
import {
  applyMetadataPatch,
  clearManagedTaskState,
  deleteTaskEntry,
  loadTasks,
  saveTaskEntry,
} from './task/managed-task-store';
import {
  buildSubTaskRunData,
  clearSubTaskRunFallbackStore,
  getSubTaskRunRecord,
  saveSubTaskRunRecord,
} from './task/subtask-run-store';
import {
  clearBackgroundExecutions,
  getBackgroundExecution,
  persistExecutionSnapshot,
  refreshExecutionProgress,
  setBackgroundExecution,
  startExecutionHeartbeat,
  stopExecutionHeartbeat,
  waitWithTimeout,
} from './task/background-runtime';

const taskRunSchema = z.object({
  description: z.string().min(1).max(200).describe('A short (3-5 words) description of the task'),
  prompt: z.string().min(1).describe('The task for the agent to perform'),
  subagent_type: SubagentTypeSchema.describe('The type of specialized agent to use for this task'),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional().describe('Optional model hint for this subagent'),
  resume: z.string().min(1).optional().describe('Optional resume token/id (currently informational)'),
  run_in_background: z.boolean().default(false).describe('Run task in background and return task_id immediately'),
  max_turns: z.number().int().min(1).max(100).optional().describe('Maximum number of agent turns (best-effort)'),
}).strict();

export class TaskTool extends BaseTool<typeof taskRunSchema> {
  name = 'task';
  description = TASK_TOOL_DESCRIPTION;
  schema = taskRunSchema;
  executionTimeoutMs = null;

  private provider: LLMProvider;
  private defaultWorkingDir: string;

  constructor(provider: LLMProvider, workingDir: string = process.cwd()) {
    super();
    this.provider = provider;
    this.defaultWorkingDir = workingDir;
  }

  async execute(args: z.infer<typeof this.schema>, context?: ToolContext): Promise<ToolResult> {
    const { subagent_type, prompt, description, run_in_background, max_turns, model, resume } = args;
    const config = AGENT_CONFIGS[subagent_type];
    if (!config) {
      return this.result({
        success: false,
        metadata: { error: 'INVALID_AGENT_TYPE' } as any,
        output: `Invalid agent type: ${subagent_type}`,
      });
    }

    const parentSessionId = context?.sessionId || `orphan-session-${Date.now()}`;
    const memoryManager = context?.memoryManager;
    const taskId = createExecutionId();
    const childSessionId = `${parentSessionId}::subtask::${taskId}`;
    const startedAt = nowIso();
    let subagent: Agent | undefined;

    try {
      subagent = this.createSubagent(subagent_type, max_turns, {
        memoryManager,
        childSessionId,
      });

      await saveSubTaskRunRecord(memoryManager, buildSubTaskRunData({
        runId: taskId,
        parentSessionId,
        childSessionId,
        mode: run_in_background ? 'background' : 'foreground',
        status: run_in_background ? 'queued' : 'running',
        createdAt: startedAt,
        startedAt,
        lastActivityAt: startedAt,
        description,
        prompt,
        subagentType: subagent_type,
        model,
        resume,
        toolsUsed: [],
        messageCount: 0,
      }));

      if (run_in_background) {
        const backgroundTaskId = await this.launchInBackground({
          taskId,
          subagent,
          parentSessionId,
          childSessionId,
          memoryManager,
          subagentType: subagent_type,
          prompt,
          description,
          model,
          resume,
        });
        const execution = getBackgroundExecution(backgroundTaskId);
        return this.result({
          success: true,
          metadata: {
            task_id: backgroundTaskId,
            status: 'queued',
            parent_session_id: parentSessionId,
            child_session_id: childSessionId,
            subagent_type,
            model,
            resume,
            storage: execution?.storage || 'memory_fallback',
          } as any,
          output: `Task started in background with task_id=${backgroundTaskId}`,
        });
      }

      const result = await this.runSubagent(subagent, prompt);
      const finishedAt = nowIso();
      const storage = await saveSubTaskRunRecord(memoryManager, buildSubTaskRunData({
        runId: taskId,
        parentSessionId,
        childSessionId,
        mode: 'foreground',
        status: result.status,
        createdAt: startedAt,
        startedAt,
        finishedAt,
        lastActivityAt: finishedAt,
        lastToolName: result.toolsUsed[result.toolsUsed.length - 1],
        description,
        prompt,
        subagentType: subagent_type,
        model,
        resume,
        turns: result.turns,
        toolsUsed: result.toolsUsed,
        output: result.output,
        error: result.errorMessage,
        messageCount: getMessageCount(result.messages),
      }));

      return this.result({
        success: result.status === 'completed',
        metadata: {
          task_id: taskId,
          parent_session_id: parentSessionId,
          child_session_id: childSessionId,
          subagent_type,
          status: result.status,
          turns: result.turns,
          toolsUsed: result.toolsUsed,
          error: result.errorCode,
          model,
          resume,
          storage,
        } as any,
        output: result.output,
      });
    } catch (error) {
      const err = error as Error;
      let storage: 'memory_manager' | 'memory_fallback' = 'memory_fallback';
      if (!run_in_background && subagent) {
        const finishedAt = nowIso();
        const rawMessages = subagent.getMessages();
        const toolsUsed = extractToolsUsed(rawMessages);
        const output = `Agent execution failed: ${err.message}`;
        storage = await saveSubTaskRunRecord(memoryManager, buildSubTaskRunData({
          runId: taskId,
          parentSessionId,
          childSessionId,
          mode: 'foreground',
          status: 'failed',
          createdAt: startedAt,
          startedAt,
          finishedAt,
          lastActivityAt: finishedAt,
          lastToolName: toolsUsed[toolsUsed.length - 1],
          description,
          prompt,
          subagentType: subagent_type,
          model,
          resume,
          turns: subagent.getLoopCount(),
          toolsUsed,
          error: err.message,
          output,
          messageCount: getMessageCount(rawMessages),
        }));
      }
      return this.result({
        success: false,
        metadata: {
          error: 'AGENT_EXECUTION_FAILED',
          task_id: taskId,
          parent_session_id: parentSessionId,
          child_session_id: childSessionId,
          storage,
        } as any,
        output: `Agent execution failed: ${err.message}`,
      });
    }
  }

  private createSubagent(
    agentType: SubagentType,
    maxTurns: number | undefined,
    options: { memoryManager?: IMemoryManager; childSessionId: string },
  ): Agent {
    const config = AGENT_CONFIGS[agentType];
    const registryConfig: ToolRegistryConfig = {
      workingDirectory: this.defaultWorkingDir,
    };
    const registry = new ToolRegistry(registryConfig);
    registry.register(config.tools.map((ToolClass) => new ToolClass()));

    return new Agent({
      provider: this.provider,
      systemPrompt: this.buildSubagentSystemPrompt(config.systemPrompt),
      toolRegistry: registry,
      // Note: Agent currently uses this field for retry control, so this is best-effort.
      maxRetries: maxTurns || config.maxRetries || 10,
      stream: false,
      memoryManager: options.memoryManager,
      sessionId: options.childSessionId,
    });
  }

  private buildSubagentSystemPrompt(basePrompt: string): string {
    return `${basePrompt}

Execution context:
- Project root directory: ${this.defaultWorkingDir}
- Use relative paths from the project root whenever possible.
- Never assume the project root is "/workspace".`;
  }

  private async launchInBackground({
    taskId,
    subagent,
    parentSessionId,
    childSessionId,
    memoryManager,
    subagentType,
    prompt,
    description,
    model,
    resume,
  }: {
    taskId: string;
    subagent: Agent;
    parentSessionId: string;
    childSessionId: string;
    memoryManager?: IMemoryManager;
    subagentType: SubagentType;
    prompt: string;
    description: string;
    model?: ModelHint;
    resume?: string;
  }): Promise<string> {
    const createdAt = nowIso();
    const execution: BackgroundExecution = {
      taskId,
      parentSessionId,
      childSessionId,
      memoryManager,
      storage: memoryManager ? 'memory_manager' : 'memory_fallback',
      status: 'queued',
      createdAt,
      startedAt: createdAt,
      lastActivityAt: createdAt,
      description,
      prompt,
      subagentType,
      model,
      resume,
      toolsUsed: [],
      messages: [],
      stopRequested: false,
      agent: subagent,
    };
    setBackgroundExecution(taskId, execution);
    await persistExecutionSnapshot(execution);

    execution.status = 'running';
    execution.startedAt = nowIso();
    execution.lastActivityAt = execution.startedAt;
    execution.output = 'Task is running in background.';
    await persistExecutionSnapshot(execution);
    startExecutionHeartbeat(execution);

    const runPromise = this.runSubagent(subagent, prompt)
      .then(async (result) => {
        execution.turns = result.turns;
        execution.toolsUsed = result.toolsUsed;
        execution.messages = result.messages;
        execution.lastToolName = result.toolsUsed[result.toolsUsed.length - 1];
        execution.lastActivityAt = nowIso();
        execution.status = result.status;
        execution.error = result.errorMessage;
        execution.output = result.output;
        execution.finishedAt = nowIso();
        await persistExecutionSnapshot(execution);
      })
      .catch(async (error) => {
        execution.messages = normalizeMessagesForStorage(execution.agent?.getMessages());
        execution.lastToolName = pickLastToolName(execution.messages);
        execution.lastActivityAt = nowIso();
        if (execution.stopRequested || execution.status === 'cancelling') {
          execution.status = 'cancelled';
          execution.error = 'TASK_CANCELLED';
          execution.output = execution.output || 'Task cancelled by user.';
        } else {
          execution.status = 'failed';
          execution.error = (error as Error).message || String(error);
          execution.output = `Agent execution failed: ${execution.error}`;
        }
        execution.finishedAt = nowIso();
        await persistExecutionSnapshot(execution);
      })
      .finally(() => {
        stopExecutionHeartbeat(execution);
        execution.agent = undefined;
      });

    execution.promise = runPromise;
    void runPromise;
    return taskId;
  }

  private async runSubagent(subagent: Agent, prompt: string): Promise<SubagentResult> {
    const execution = await subagent.executeWithResult(prompt);
    const turns = subagent.getLoopCount();
    const rawMessages = subagent.getMessages();
    const toolsUsed = extractToolsUsed(rawMessages);
    const normalizedMessages = normalizeMessagesForStorage(rawMessages);
    const failure = execution.failure;

    if (execution.status !== 'completed') {
      const status = execution.status === 'aborted' ? 'cancelled' : 'failed';
      const output = status === 'cancelled'
        ? (failure?.userMessage || 'Task cancelled by user.')
        : `Agent execution failed: ${failure?.internalMessage || failure?.userMessage || 'Unknown error'}`;
      return {
        status,
        turns,
        toolsUsed,
        output,
        errorCode: failure?.code || (status === 'cancelled' ? 'AGENT_ABORTED' : 'AGENT_RUNTIME_ERROR'),
        errorMessage: failure?.internalMessage || failure?.userMessage,
        messages: normalizedMessages,
      };
    }

    const output = messageContentToText(execution.finalMessage?.content) || 'Task completed with no output';
    return {
      status: 'completed',
      turns,
      toolsUsed,
      output,
      messages: normalizedMessages,
    };
  }
}

const taskCreateSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
  activeForm: z.string().min(1).max(200),
  metadata: JsonObjectSchema.optional(),
}).strict();

export class TaskCreateTool extends BaseTool<typeof taskCreateSchema> {
  name = 'task_create';
  description = TASK_CREATE_DESCRIPTION;
  schema = taskCreateSchema;

  async execute(args: z.infer<typeof this.schema>, context?: ToolContext): Promise<ToolResult> {
    const { subject, description, activeForm, metadata } = args;
    const tasks = await loadTasks(context?.sessionId, context?.memoryManager);

    const now = nowIso();
    const newTask = {
      id: nextTaskId(tasks, context?.sessionId),
      subject,
      description,
      activeForm,
      status: 'pending' as const,
      owner: '',
      metadata,
      blocks: [],
      blockedBy: [],
      createdAt: now,
      updatedAt: now,
    };

    await saveTaskEntry(newTask, context?.sessionId, context?.memoryManager);

    return this.result({
      success: true,
      metadata: newTask as any,
      output: `Created task ${newTask.id}: ${newTask.subject}`,
    });
  }
}

const taskGetSchema = z.object({
  taskId: z.string().min(1),
}).strict();

export class TaskGetTool extends BaseTool<typeof taskGetSchema> {
  name = 'task_get';
  description = TASK_GET_DESCRIPTION;
  schema = taskGetSchema;

  async execute(args: z.infer<typeof this.schema>, context?: ToolContext): Promise<ToolResult> {
    const { taskId } = args;
    const tasks = await loadTasks(context?.sessionId, context?.memoryManager);
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      return this.result({
        success: false,
        metadata: { error: 'TASK_NOT_FOUND' } as any,
        output: `Task not found: ${taskId}`,
      });
    }

    return this.result({
      success: true,
      metadata: task as any,
      output: `Retrieved task ${task.id}`,
    });
  }
}

const taskListSchema = z.object({}).strict();

export class TaskListTool extends BaseTool<typeof taskListSchema> {
  name = 'task_list';
  description = TASK_LIST_DESCRIPTION;
  schema = taskListSchema;

  async execute(_args?: unknown, context?: ToolContext): Promise<ToolResult> {
    const tasks = await loadTasks(context?.sessionId, context?.memoryManager);
    const sorted = [...tasks].sort((a, b) => compareTaskIds(a.id, b.id));

    const summaries = sorted.map((task) => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner || '',
      blockedBy: extractOpenDependencies(tasks, task.blockedBy),
    }));

    return this.result({
      success: true,
      metadata: {
        count: summaries.length,
        tasks: summaries,
      } as any,
      output: `Listed ${summaries.length} task(s)`,
    });
  }
}

const taskUpdateSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']).optional(),
  subject: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  activeForm: z.string().min(1).max(200).optional(),
  owner: z.string().optional(),
  metadata: JsonPatchSchema.optional(),
  addBlocks: z.array(z.string().min(1)).optional(),
  addBlockedBy: z.array(z.string().min(1)).optional(),
}).strict();

export class TaskUpdateTool extends BaseTool<typeof taskUpdateSchema> {
  name = 'task_update';
  description = TASK_UPDATE_DESCRIPTION;
  schema = taskUpdateSchema;

  async execute(args: z.infer<typeof this.schema>, context?: ToolContext): Promise<ToolResult> {
    const { taskId, status, subject, description, activeForm, owner, metadata, addBlocks, addBlockedBy } = args;
    const tasks = await loadTasks(context?.sessionId, context?.memoryManager);
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) {
      return this.result({
        success: false,
        metadata: { error: 'TASK_NOT_FOUND' } as any,
        output: `Task not found: ${taskId}`,
      });
    }

    if (status === 'deleted') {
      const updatedAt = nowIso();
      const touchedTasks = tasks
        .filter((task) => task.id !== taskId)
        .map((task) => {
          const nextBlocks = task.blocks.filter((id) => id !== taskId);
          const nextBlockedBy = task.blockedBy.filter((id) => id !== taskId);
          if (nextBlocks.length === task.blocks.length && nextBlockedBy.length === task.blockedBy.length) {
            return null;
          }
          return {
            ...task,
            blocks: nextBlocks,
            blockedBy: nextBlockedBy,
            updatedAt,
          };
        })
        .filter((task): task is (typeof tasks)[number] => task !== null);

      for (const touchedTask of touchedTasks) {
        await saveTaskEntry(touchedTask, context?.sessionId, context?.memoryManager);
      }
      await deleteTaskEntry(taskId, context?.sessionId, context?.memoryManager);
      return this.result({
        success: true,
        metadata: { taskId, status: 'deleted' } as any,
        output: `Deleted task ${taskId}`,
      });
    }

    const next = tasks.map((task) => ({ ...task, blocks: [...task.blocks], blockedBy: [...task.blockedBy] }));
    const current = next[index];

    if (status && !isStatusTransitionAllowed(current.status, status)) {
      return this.result({
        success: false,
        metadata: { error: 'INVALID_STATUS_TRANSITION' } as any,
        output: `Invalid status transition: ${current.status} -> ${status}`,
      });
    }

    const dependencyIds = unique([...(addBlocks || []), ...(addBlockedBy || [])]);
    const missingDependencies = dependencyIds.filter((depId) => depId === taskId || !next.some((task) => task.id === depId));
    if (missingDependencies.length > 0) {
      return this.result({
        success: false,
        metadata: { error: 'INVALID_DEPENDENCY', missingDependencies } as any,
        output: `Invalid dependency task IDs: ${missingDependencies.join(', ')}`,
      });
    }

    const touched = new Set<string>();
    touched.add(taskId);

    if (status) current.status = status;
    if (subject !== undefined) current.subject = subject;
    if (description !== undefined) current.description = description;
    if (activeForm !== undefined) current.activeForm = activeForm;
    if (owner !== undefined) current.owner = owner;
    if (metadata) current.metadata = applyMetadataPatch(current.metadata, metadata);

    if (addBlocks) {
      for (const blockedTaskId of unique(addBlocks)) {
        const blockedTask = next.find((task) => task.id === blockedTaskId);
        if (!blockedTask) continue;
        current.blocks = unique([...current.blocks, blockedTaskId]);
        blockedTask.blockedBy = unique([...blockedTask.blockedBy, current.id]);
        touched.add(blockedTask.id);
      }
    }

    if (addBlockedBy) {
      for (const blockerTaskId of unique(addBlockedBy)) {
        const blockerTask = next.find((task) => task.id === blockerTaskId);
        if (!blockerTask) continue;
        current.blockedBy = unique([...current.blockedBy, blockerTaskId]);
        blockerTask.blocks = unique([...blockerTask.blocks, current.id]);
        touched.add(blockerTask.id);
      }
    }

    const updatedAt = nowIso();
    for (const task of next) {
      if (touched.has(task.id)) {
        task.updatedAt = updatedAt;
      }
    }

    const touchedTasks = next.filter((task) => touched.has(task.id));
    for (const touchedTask of touchedTasks) {
      await saveTaskEntry(touchedTask, context?.sessionId, context?.memoryManager);
    }
    const updated = next.find((task) => task.id === taskId);
    return this.result({
      success: true,
      metadata: updated as any,
      output: `Updated task ${taskId}`,
    });
  }
}

const taskOutputSchema = z.object({
  task_id: z.string().min(1),
  block: z.boolean().default(true),
  timeout: z.number().int().min(1).max(600000).default(30000),
}).strict();

export class TaskOutputTool extends BaseTool<typeof taskOutputSchema> {
  name = 'task_output';
  description = TASK_OUTPUT_DESCRIPTION;
  schema = taskOutputSchema;

  async execute(args: z.infer<typeof this.schema>, context?: ToolContext): Promise<ToolResult> {
    const { task_id, block, timeout } = args;
    const execution = getBackgroundExecution(task_id);
    const runRecord = await getSubTaskRunRecord(context?.memoryManager, task_id);
    if (!execution && !runRecord) {
      return this.result({
        success: false,
        metadata: { error: 'TASK_NOT_FOUND' } as any,
        output: `Task not found: ${task_id}`,
      });
    }

    if (execution) {
      await refreshExecutionProgress(execution, true);
    }

    let waitTimeoutReached = false;
    if (block && execution && (execution.status === 'queued' || execution.status === 'running' || execution.status === 'cancelling') && execution.promise) {
      const waitResult = await waitWithTimeout(execution.promise, timeout);
      waitTimeoutReached = waitResult.timedOut;
      await refreshExecutionProgress(execution, true);
    }

    const latestRun = execution
      ? await getSubTaskRunRecord(execution.memoryManager || context?.memoryManager, task_id)
      : runRecord;
    const status = execution?.status || latestRun?.status || 'failed';
    const messageCount = latestRun?.messageCount ?? latestRun?.messages?.length ?? execution?.messages?.length ?? 0;
    const lastActivityAt = execution?.lastActivityAt
      || toIso(latestRun?.lastActivityAt)
      || (latestRun?.updatedAt ? toIso(latestRun.updatedAt) : undefined);
    const lastToolName = execution?.lastToolName || latestRun?.lastToolName;
    const storage =
      execution?.storage ||
      (context?.memoryManager ? 'memory_manager' : 'memory_fallback');

    let output = execution?.output || latestRun?.output;
    if (!output) {
      if (status === 'queued' || status === 'running' || status === 'cancelling') {
        if (waitTimeoutReached) {
          output = `Wait timeout reached after ${timeout}ms. Task is still ${status}. Continue polling with task_output(block=false).`;
        } else {
          output = `Task is currently ${status}. Use task_output(block=false) to poll progress.`;
        }
      } else if (status === 'cancelled') {
        output = 'Task cancelled by user.';
      } else {
        output = latestRun?.error || 'Task finished with no output.';
      }
    }

    return this.result({
      success: true,
      metadata: {
        task_id: task_id,
        parent_session_id: execution?.parentSessionId || latestRun?.parentSessionId,
        child_session_id: execution?.childSessionId || latestRun?.childSessionId,
        status,
        turns: execution?.turns || latestRun?.turns,
        toolsUsed: execution?.toolsUsed || latestRun?.toolsUsed || [],
        error: execution?.error || latestRun?.error,
        storage,
        message_count: messageCount,
        progress: {
          message_count: messageCount,
          last_activity_at: lastActivityAt,
          last_tool_name: lastToolName,
        },
        wait: {
          block_requested: block,
          timeout_ms: timeout,
          timeout_reached: waitTimeoutReached,
        },
        createdAt: execution?.createdAt || (latestRun ? new Date(latestRun.createdAt).toISOString() : undefined),
        startedAt: execution?.startedAt || (latestRun ? new Date(latestRun.startedAt).toISOString() : undefined),
        finishedAt: execution?.finishedAt || (latestRun?.finishedAt ? new Date(latestRun.finishedAt).toISOString() : undefined),
      } as any,
      output,
    });
  }
}

const taskStopSchema = z.object({
  task_id: z.string().min(1),
  shell_id: z.string().min(1).optional(),
}).strict();

export class TaskStopTool extends BaseTool<typeof taskStopSchema> {
  name = 'task_stop';
  description = TASK_STOP_DESCRIPTION;
  schema = taskStopSchema;

  async execute(args: z.infer<typeof this.schema>, context?: ToolContext): Promise<ToolResult> {
    const taskId = args.task_id || args.shell_id;
    const execution = taskId ? getBackgroundExecution(taskId) : undefined;
    const runRecord = taskId ? await getSubTaskRunRecord(context?.memoryManager, taskId) : null;
    if (!execution && !runRecord) {
      return this.result({
        success: false,
        metadata: { error: 'TASK_NOT_FOUND' } as any,
        output: `Background task not found: ${taskId || '<empty>'}`,
      });
    }

    if (!execution || (execution.status !== 'queued' && execution.status !== 'running' && execution.status !== 'cancelling')) {
      return this.result({
        success: true,
        metadata: {
          task_id: taskId,
          status: runRecord?.status || execution?.status || 'unknown',
          storage: runRecord ? 'memory_manager' : execution?.storage || 'memory_fallback',
        } as any,
        output: `Task ${taskId} is already ${runRecord?.status || execution?.status || 'finished'}`,
      });
    }

    execution.stopRequested = true;
    execution.status = 'cancelling';
    execution.error = 'TASK_CANCELLING';
    execution.output = 'Cancellation requested.';
    execution.lastActivityAt = nowIso();
    await refreshExecutionProgress(execution, true);
    await persistExecutionSnapshot(execution);
    execution.agent?.abort();

    if (execution.promise) {
      const waitResult = await waitWithTimeout(execution.promise, 2000);
      if (waitResult.timedOut && (execution.status === 'queued' || execution.status === 'running' || execution.status === 'cancelling')) {
        execution.status = 'cancelled';
        execution.finishedAt = nowIso();
        execution.error = 'TASK_CANCELLED';
        execution.output = 'Task cancelled by user.';
        execution.lastActivityAt = execution.finishedAt;
        await refreshExecutionProgress(execution, true);
        await persistExecutionSnapshot(execution);
      }
    }

    const finalStatus = execution.status;
    const finalOutput = finalStatus === 'cancelling'
      ? `Cancellation requested for task ${execution.taskId}`
      : finalStatus === 'cancelled'
        ? `Cancelled task ${execution.taskId}`
        : `Task ${execution.taskId} is ${finalStatus}`;

    return this.result({
      success: true,
      metadata: {
        task_id: execution.taskId,
        status: finalStatus,
        parent_session_id: execution.parentSessionId,
        child_session_id: execution.childSessionId,
        storage: execution.storage,
      } as any,
      output: finalOutput,
    });
  }
}

export function clearTaskState(sessionId?: string): void {
  clearTaskIdCounterState(sessionId);
  clearManagedTaskState(sessionId);
  clearSubTaskRunFallbackStore(sessionId);
  clearBackgroundExecutions(sessionId);
}

export default TaskTool;
export { SubagentType };
