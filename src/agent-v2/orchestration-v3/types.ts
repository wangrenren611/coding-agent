import type { AgentMessage } from '../agent/stream-types';
import type {
    AgentProfileV2,
    AgentRuntimeV2,
    ExecuteCommandV2,
    RunHandleV2,
    RunRecordV2,
    RuntimeRunStatus,
} from '../orchestration-v2/types';

export type AgentRuntimeV3 = AgentRuntimeV2;
export type RuntimeEventV3 = AgentMessage | { eventId?: string; type?: string; payload?: Record<string, unknown> };

export interface AgentConfigV3 {
    role: string;
    systemPrompt: string;
    provider: AgentProfileV2['provider'];
    toolRegistry?: AgentProfileV2['toolRegistry'];
    memoryManager?: AgentProfileV2['memoryManager'];
    maxRetries?: AgentProfileV2['maxRetries'];
    maxLoops?: AgentProfileV2['maxLoops'];
    requestTimeout?: AgentProfileV2['requestTimeout'];
    idleTimeout?: AgentProfileV2['idleTimeout'];
    retryDelayMs?: AgentProfileV2['retryDelayMs'];
    thinking?: AgentProfileV2['thinking'];
    planMode?: AgentProfileV2['planMode'];
    planBaseDir?: AgentProfileV2['planBaseDir'];
    metadata?: AgentProfileV2['metadata'];
}

export interface OrchestratorV3Options {
    controllerId: string;
    agentsConfigs: Record<string, AgentConfigV3>;
    runtime?: AgentRuntimeV3;
}

export interface DispatchCommandV3 {
    agentId: string;
    input: ExecuteCommandV2['input'];
    parentRunId?: string;
    timeoutMs?: number;
    options?: ExecuteCommandV2['options'];
    metadata?: Record<string, unknown>;
}

export interface TrackedRunV3 {
    runId: string;
    agentId: string;
    parentRunId?: string;
    createdAt: number;
    status: RuntimeRunStatus;
}

export interface RunStatusSnapshotV3 {
    runId: string;
    agentId: string;
    parentRunId?: string;
    status: RuntimeRunStatus;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    output?: string;
}

export interface RunStatusQueryV3 {
    runId?: string;
    agentId?: string;
    parentRunId?: string;
    parentAgentId?: string;
    statuses?: RuntimeRunStatus[];
    limit?: number;
}

export interface StatusPortV3 {
    queryRuns(query: RunStatusQueryV3): Promise<RunStatusSnapshotV3[]>;
    getAgentRole(agentId: string): string | undefined;
}

export interface InterAgentMessageV3 {
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

export interface ReceiveMessageOptionsV3 {
    limit?: number;
    leaseMs?: number;
    now?: number;
}

export interface WaitForMessagesOptionsV3 extends ReceiveMessageOptionsV3 {
    waitMs?: number;
    pollIntervalMs?: number;
    parentRunId?: string;
    includeChildProgressOnTimeout?: boolean;
}

export interface NackMessageOptionsV3 {
    error?: string;
    requeueDelayMs?: number;
}

export interface NackMessageResultV3 {
    requeued: boolean;
    deadLettered: boolean;
    message?: InterAgentMessageV3;
}

export interface WaitForMessagesResultV3 {
    timedOut: boolean;
    waitedMs: number;
    messages: InterAgentMessageV3[];
    childProgress?: RunStatusSnapshotV3[];
}

export interface MessagingPortV3 {
    sendMessage(message: Omit<InterAgentMessageV3, 'messageId' | 'timestamp'>): InterAgentMessageV3;
    receiveMessages(agentId: string, options?: ReceiveMessageOptionsV3): InterAgentMessageV3[];
    waitForMessages(agentId: string, options?: WaitForMessagesOptionsV3): Promise<WaitForMessagesResultV3>;
    ackMessage(agentId: string, messageId: string): boolean;
    nackMessage(agentId: string, messageId: string, options?: NackMessageOptionsV3): NackMessageResultV3;
    listDeadLetters(agentId: string, limit?: number): InterAgentMessageV3[];
}

export interface DispatchPortV3 {
    dispatch(command: DispatchCommandV3): Promise<RunHandleV2>;
    queryRuns(query: RunStatusQueryV3): Promise<RunStatusSnapshotV3[]>;
    hasAgent(agentId: string): boolean;
    isControllerAgent(agentId: string): boolean;
}

export type { RunHandleV2, RunRecordV2, RuntimeRunStatus };
