import type { AgentMessage } from '../agent/stream-types';
import type { AgentOptions } from '../agent/types';
import type { ToolRegistry } from '../tool/registry';
import type { IMemoryManager } from '../memory/types';
import type { LLMGenerateOptions, MessageContent } from '../../providers';

export type RuntimeRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'cancelled';

export interface AgentProfile {
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

export interface RunRecord {
    runId: string;
    agentId: string;
    parentRunId?: string;
    depth: number;
    status: RuntimeRunStatus;
    input: MessageContent;
    output?: string;
    error?: string;
    sessionId?: string;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    metadata?: Record<string, unknown>;
}

export interface RunHandle {
    runId: string;
    agentId: string;
    status: RuntimeRunStatus;
}

export interface ExecuteCommand {
    agentId: string;
    input: MessageContent;
    options?: LLMGenerateOptions;
    parentRunId?: string;
    depth?: number;
    metadata?: Record<string, unknown>;
}

export interface RuntimeEvent {
    eventId: string;
    timestamp: number;
    type:
        | 'run.queued'
        | 'run.started'
        | 'run.stream'
        | 'run.completed'
        | 'run.failed'
        | 'run.aborted'
        | 'agent.spawned'
        | 'agent.message'
        | 'agent.message.acked'
        | 'agent.message.nacked'
        | 'agent.message.dead_letter'
        | 'agent.message.deduplicated';
    runId?: string;
    agentId?: string;
    payload?: Record<string, unknown>;
}

export interface EventFilter {
    runId?: string;
    agentId?: string;
    types?: RuntimeEvent['type'][];
}

export interface RouteBinding {
    bindingId: string;
    agentId: string;
    priority: number;
    enabled?: boolean;
    channel?: string;
    account?: string;
    threadPrefix?: string;
    metadata?: Record<string, unknown>;
}

export interface RouteRequest {
    channel?: string;
    account?: string;
    threadId?: string;
    stickyKey?: string;
    metadata?: Record<string, unknown>;
}

export interface RouteDecision {
    agentId: string;
    bindingId?: string;
    reason: 'sticky' | 'binding' | 'default';
    stickyKey: string;
}

export interface InterAgentMessage {
    messageId: string;
    timestamp: number;
    fromAgentId: string;
    toAgentId: string;
    payload: Record<string, unknown>;
    topic?: string;
    partitionKey?: string;
    partitionSeq?: number;
    idempotencyKey?: string;
    attempt?: number;
    maxAttempts?: number;
    visibleAt?: number;
    leaseUntil?: number;
    status?: 'queued' | 'in_flight' | 'acked' | 'dead_letter';
    lastError?: string;
    correlationId?: string;
    runId?: string;
}

export interface ReceiveMessageOptions {
    limit?: number;
    now?: number;
    leaseMs?: number;
}

export interface NackMessageOptions {
    error?: string;
    requeueDelayMs?: number;
}

export interface NackMessageResult {
    requeued: boolean;
    deadLettered: boolean;
    message?: InterAgentMessage;
}

export interface SpawnCommand {
    controllerAgentId: string;
    parentRunId?: string;
    childAgentId?: string;
    role: string;
    systemPrompt?: string;
    provider?: AgentOptions['provider'];
    toolRegistry?: ToolRegistry;
    memoryManager?: IMemoryManager;
    metadata?: Record<string, unknown>;
}

export interface RunGraphNode {
    runId: string;
    agentId: string;
    status: RuntimeRunStatus;
    children: RunGraphNode[];
}

export interface BudgetPolicy {
    maxConcurrentRuns: number;
    maxDepth: number;
    maxChildrenPerRun: number;
}

export interface PolicyDecision {
    allowed: boolean;
    reason?: string;
}

export interface ExecutionPolicyContext {
    agentId: string;
    parentRunId?: string;
    depth: number;
}

export interface SpawnPolicyContext {
    controllerAgentId: string;
    parentRunId?: string;
}

export interface MessagingRule {
    fromAgentId: string;
    toAgentId: string;
    topics?: string[];
}

export interface MessagingPolicy {
    allowedTopics?: string[];
    allowedRules?: MessagingRule[];
    blockedRules?: Array<Pick<MessagingRule, 'fromAgentId' | 'toAgentId'>>;
}

export interface MessageRuntimeConfig {
    maxAttempts: number;
    receiveLeaseMs: number;
    nackRequeueDelayMs: number;
    dedupWindowMs: number;
    enforceTopicPartitionOrder: boolean;
}

export interface MessagingPolicyContext {
    fromAgentId: string;
    toAgentId: string;
    topic?: string;
    runId?: string;
}

export interface EventStream {
    publish(event: RuntimeEvent): void;
    subscribe(filter: EventFilter, listener: (event: RuntimeEvent) => void): () => void;
    replay(filter?: EventFilter): RuntimeEvent[];
}

export interface StateStore {
    saveAgentProfile(profile: AgentProfile): void;
    getAgentProfile(agentId: string): AgentProfile | undefined;
    listAgentProfiles(): AgentProfile[];

    saveRun(run: RunRecord): void;
    updateRun(runId: string, patch: Partial<RunRecord>): RunRecord | undefined;
    getRun(runId: string): RunRecord | undefined;
    listRuns(filter?: { agentId?: string; parentRunId?: string; statuses?: RuntimeRunStatus[] }): RunRecord[];

    saveBinding(binding: RouteBinding): void;
    listBindings(): RouteBinding[];

    saveRouteSession(stickyKey: string, agentId: string): void;
    getRouteSession(stickyKey: string): string | undefined;

    setAgentSession(agentId: string, sessionId: string): void;
    getAgentSession(agentId: string): string | undefined;
    getAgentIdBySession(sessionId: string): string | undefined;

    enqueueMessage(agentId: string, message: InterAgentMessage): void;
    getMessage(agentId: string, messageId: string): InterAgentMessage | undefined;
    findMessageByIdempotency(agentId: string, idempotencyKey: string, now?: number): InterAgentMessage | undefined;
    saveIdempotency(agentId: string, idempotencyKey: string, messageId: string, expiresAt: number): void;
    receiveMessages(agentId: string, options?: ReceiveMessageOptions): InterAgentMessage[];
    ackMessage(agentId: string, messageId: string): boolean;
    nackMessage(agentId: string, messageId: string, options?: NackMessageOptions): NackMessageResult;
    listDeadLetters(agentId: string, limit?: number): InterAgentMessage[];
    requeueDeadLetter(
        agentId: string,
        messageId: string,
        options?: { delayMs?: number; resetAttempts?: boolean }
    ): boolean;
    drainMessages(agentId: string, limit?: number): InterAgentMessage[];
}

export interface PolicyEngine {
    canExecute(context: ExecutionPolicyContext): PolicyDecision;
    canSpawn(context: SpawnPolicyContext): PolicyDecision;
    canMessage(context: MessagingPolicyContext): PolicyDecision;
    resolveModel(agentId: string, requestedModel?: string): string | undefined;
}

export interface AgentRuntime {
    execute(command: ExecuteCommand): Promise<RunHandle>;
    abort(runId: string): Promise<void>;
    stream(runId: string, listener: (event: RuntimeEvent | AgentMessage) => void): () => void;
    status(runId: string): Promise<RunRecord | undefined>;
}
