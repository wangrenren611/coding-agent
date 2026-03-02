import type { AgentMessage } from '../agent/stream-types';
import type { AgentOptions } from '../agent/types';
import type { ToolRegistry } from '../tool/registry';
import type { IMemoryManager } from '../memory/types';
import type { LLMGenerateOptions, MessageContent } from '../../providers';

export type RuntimeRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'cancelled';

export interface AgentProfileV2 {
    agentId: string;
    role: string;
    systemPrompt: string;
    provider: AgentOptions['provider'];
    toolRegistry?: ToolRegistry;
    memoryManager?: IMemoryManager;
    sessionId?: string;
    maxRetries?: number;
    maxLoops?: number;
    requestTimeout?: number;
    idleTimeout?: number;
    retryDelayMs?: number;
    thinking?: boolean;
    planMode?: boolean;
    planBaseDir?: string;
    metadata?: Record<string, unknown>;
}

export interface ExecuteCommandV2 {
    agentId: string;
    input: MessageContent;
    options?: LLMGenerateOptions;
    profile?: AgentProfileV2;
    parentRunId?: string;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
}

export interface RunHandleV2 {
    runId: string;
    agentId: string;
    status: RuntimeRunStatus;
}

export interface RunRecordV2 {
    runId: string;
    agentId: string;
    status: RuntimeRunStatus;
    input: MessageContent;
    output?: string;
    error?: string;
    sessionId?: string;
    parentRunId?: string;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    metadata?: Record<string, unknown>;
}

export interface RuntimeEventV2 {
    eventId: string;
    timestamp: number;
    type:
        | 'run.queued'
        | 'run.started'
        | 'run.stream'
        | 'run.completed'
        | 'run.failed'
        | 'run.aborted'
        | 'kernel.goal.started'
        | 'kernel.goal.planned'
        | 'kernel.task.started'
        | 'kernel.task.completed'
        | 'kernel.task.failed'
        | 'kernel.goal.completed'
        | 'kernel.goal.failed'
        | 'agent.message'
        | 'agent.message.acked'
        | 'agent.message.nacked'
        | 'agent.message.dead_letter';
    runId?: string;
    agentId?: string;
    payload?: Record<string, unknown>;
}

export interface InterAgentMessageV2 {
    messageId: string;
    timestamp: number;
    fromAgentId: string;
    toAgentId: string;
    payload: Record<string, unknown>;
    topic?: string;
    correlationId?: string;
    runId?: string;
    idempotencyKey?: string;
    status?: 'queued' | 'in_flight' | 'acked' | 'dead_letter';
    visibleAt?: number;
    leaseUntil?: number;
    attempt?: number;
    maxAttempts?: number;
    lastError?: string;
}

export interface ReceiveMessageOptionsV2 {
    limit?: number;
    leaseMs?: number;
    now?: number;
}

export interface NackMessageOptionsV2 {
    error?: string;
    requeueDelayMs?: number;
}

export interface NackMessageResultV2 {
    requeued: boolean;
    deadLettered: boolean;
    message?: InterAgentMessageV2;
}

export interface AgentRuntimeV2 {
    execute(command: ExecuteCommandV2): Promise<RunHandleV2>;
    abort(runId: string): Promise<void>;
    stream(runId: string, listener: (event: RuntimeEventV2 | AgentMessage) => void): () => void;
    status(runId: string): Promise<RunRecordV2 | undefined>;
    upsertAgent(profile: AgentProfileV2): void;
    getAgent(agentId: string): AgentProfileV2 | undefined;
    listAgents(): AgentProfileV2[];
    getAgentIdBySession(sessionId: string): string | undefined;
}

export interface PlanTaskV2 {
    id: string;
    title: string;
    role: string;
    description: string;
    dependsOn: string[];
    acceptanceCriteria: string[];
}

export interface GoalPlanV2 {
    summary: string;
    tasks: PlanTaskV2[];
}

export interface TaskExecutionResultV2 {
    taskId: string;
    role: string;
    agentId: string;
    status: 'completed' | 'failed';
    runId: string;
    output?: string;
    error?: string;
    attempts: number;
    startedAt: number;
    finishedAt: number;
}

export interface GoalExecutionResultV2 {
    goalRunId: string;
    plannerRunId: string;
    goal: string;
    plan: GoalPlanV2;
    tasks: TaskExecutionResultV2[];
    status: 'completed' | 'failed';
    finalSummary?: string;
    error?: string;
    startedAt: number;
    finishedAt: number;
}

export interface AgentTemplateV2 {
    role: string;
    systemPrompt: string;
    provider?: AgentOptions['provider'];
    toolRegistry?: ToolRegistry;
    memoryManager?: IMemoryManager;
    maxRetries?: number;
    maxLoops?: number;
    requestTimeout?: number;
    idleTimeout?: number;
    retryDelayMs?: number;
    thinking?: boolean;
    metadata?: Record<string, unknown>;
}

export interface OrchestratorV2Options {
    provider: AgentOptions['provider'];
    memoryManager?: IMemoryManager;
    runtime?: AgentRuntimeV2;
    controller: {
        agentId?: string;
        systemPrompt: string;
    };
    templates?: AgentTemplateV2[];
    planner?: {
        maxRepairAttempts?: number;
        timeoutMs?: number;
    };
    scheduler?: {
        maxConcurrentTasks?: number;
        maxTaskRetries?: number;
        taskTimeoutMs?: number;
        failFast?: boolean;
    };
}
