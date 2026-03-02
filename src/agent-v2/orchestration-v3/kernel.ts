import { v4 as uuid } from 'uuid';
import { createDefaultToolRegistry, type ToolRegistry } from '../tool';
import { LocalAgentRuntimeV2 } from '../orchestration-v2/runtime';
import type { AgentProfileV2 } from '../orchestration-v2/types';
import {
    AgentAckMessagesToolV3,
    AgentListDeadLettersToolV3,
    AgentNackMessageToolV3,
    AgentReceiveMessagesToolV3,
    AgentSendMessageToolV3,
    AgentWaitForMessagesToolV3,
} from './messaging-tools';
import { AgentDispatchTaskToolV3 } from './dispatch-tool';
import { AgentGetStatusToolV3 } from './status-tool';
import type {
    AgentRuntimeV3,
    DispatchPortV3,
    DispatchCommandV3,
    InterAgentMessageV3,
    MessagingPortV3,
    NackMessageOptionsV3,
    NackMessageResultV3,
    OrchestratorV3Options,
    ReceiveMessageOptionsV3,
    RunHandleV2,
    RunRecordV2,
    RuntimeRunStatus,
    RunStatusQueryV3,
    RunStatusSnapshotV3,
    StatusPortV3,
    TrackedRunV3,
    WaitForMessagesOptionsV3,
    WaitForMessagesResultV3,
} from './types';

export class OrchestratorKernelV3 {
    private readonly runtime: AgentRuntimeV3;
    private readonly controllerId: string;
    private readonly runs = new Map<string, TrackedRunV3>();
    private readonly statusPort: StatusPortV3;
    private readonly messagingPort: MessagingPortV3;
    private readonly dispatchPort: DispatchPortV3;
    private readonly mailbox = new Map<string, InterAgentMessageV3[]>();
    private readonly inFlight = new Map<string, Map<string, InterAgentMessageV3>>();
    private readonly deadLetters = new Map<string, InterAgentMessageV3[]>();
    private readonly idempotency = new Map<string, Map<string, InterAgentMessageV3>>();
    private readonly runWatchers = new Map<string, { unsubscribe: () => void; poller: NodeJS.Timeout }>();
    private readonly childTerminalNotified = new Set<string>();
    private readonly messageDefaults = {
        maxAttempts: 3,
        leaseMs: 15_000,
    };
    private readonly waitDefaults = {
        waitMs: 30_000,
        pollIntervalMs: 400,
    };
    private readonly watcherDefaults = {
        childStatusPollMs: 600,
    };

    constructor(options: OrchestratorV3Options) {
        this.runtime = options.runtime || new LocalAgentRuntimeV2();
        this.controllerId = options.controllerId;

        const controller = options.agentsConfigs[this.controllerId];
        if (!controller) {
            throw new Error(`controllerId not found in agentsConfigs: ${this.controllerId}`);
        }

        this.statusPort = {
            queryRuns: (query) => this.queryRuns(query),
            getAgentRole: (agentId) => this.runtime.getAgent(agentId)?.role,
        };
        this.messagingPort = {
            sendMessage: (message) => this.sendMessage(message),
            receiveMessages: (agentId, options) => this.receiveMessages(agentId, options),
            waitForMessages: (agentId, options) => this.waitForMessages(agentId, options),
            ackMessage: (agentId, messageId) => this.ackMessage(agentId, messageId),
            nackMessage: (agentId, messageId, options) => this.nackMessage(agentId, messageId, options),
            listDeadLetters: (agentId, limit) => this.listDeadLetters(agentId, limit),
        };
        this.dispatchPort = {
            dispatch: (command) => this.dispatch(command),
            queryRuns: (query) => this.queryRuns(query),
            hasAgent: (agentId) => Boolean(this.runtime.getAgent(agentId)),
            isControllerAgent: (agentId) => agentId === this.controllerId,
        };

        for (const [agentId, config] of Object.entries(options.agentsConfigs)) {
            this.registerAgent(agentId, config);
        }
    }

    async execute(input: DispatchCommandV3['input']): Promise<RunHandleV2> {
        return this.dispatch({
            agentId: this.controllerId,
            input,
        });
    }

    async dispatch(command: DispatchCommandV3): Promise<RunHandleV2> {
        const handle = await this.runtime.execute({
            agentId: command.agentId,
            input: command.input,
            parentRunId: command.parentRunId,
            timeoutMs: command.timeoutMs,
            options: command.options,
            metadata: command.metadata,
        });

        this.runs.set(handle.runId, {
            runId: handle.runId,
            agentId: handle.agentId,
            parentRunId: command.parentRunId,
            createdAt: Date.now(),
            status: handle.status,
        });

        if (command.parentRunId) {
            this.watchChildRun(command.parentRunId, handle.runId, handle.agentId);
        }

        return handle;
    }

    stream(runId: string, listener: Parameters<AgentRuntimeV3['stream']>[1]): () => void {
        return this.runtime.stream(runId, listener);
    }

    async status(runId: string): Promise<RunRecordV2 | undefined> {
        return this.runtime.status(runId);
    }

    async abort(runId: string): Promise<void> {
        await this.runtime.abort(runId);
    }

    sendMessage(message: Omit<InterAgentMessageV3, 'messageId' | 'timestamp'>): InterAgentMessageV3 {
        const from = this.runtime.getAgent(message.fromAgentId);
        const to = this.runtime.getAgent(message.toAgentId);
        if (!from) {
            throw new Error(`Unknown fromAgentId: ${message.fromAgentId}`);
        }
        if (!to) {
            throw new Error(`Unknown toAgentId: ${message.toAgentId}`);
        }

        const now = Date.now();
        const idempotencyKey = message.idempotencyKey?.trim();
        if (idempotencyKey) {
            const index = this.idempotency.get(message.toAgentId);
            const existing = index?.get(idempotencyKey);
            if (existing) {
                return { ...existing };
            }
        }

        const queued: InterAgentMessageV3 = {
            ...message,
            messageId: uuid(),
            timestamp: now,
            status: 'queued',
            attempt: 0,
            maxAttempts:
                typeof message.maxAttempts === 'number' && message.maxAttempts > 0
                    ? Math.floor(message.maxAttempts)
                    : this.messageDefaults.maxAttempts,
            visibleAt: message.visibleAt ?? now,
            leaseUntil: undefined,
        };

        const queue = this.mailbox.get(message.toAgentId) || [];
        queue.push(queued);
        this.mailbox.set(message.toAgentId, queue);
        if (idempotencyKey) {
            const index = this.idempotency.get(message.toAgentId) || new Map<string, InterAgentMessageV3>();
            index.set(idempotencyKey, queued);
            this.idempotency.set(message.toAgentId, index);
        }

        return { ...queued };
    }

    receiveMessages(agentId: string, options?: ReceiveMessageOptionsV3): InterAgentMessageV3[] {
        const now = options?.now ?? Date.now();
        const limit = options?.limit && options.limit > 0 ? options.limit : 10;
        const leaseMs = options?.leaseMs && options.leaseMs > 0 ? options.leaseMs : this.messageDefaults.leaseMs;

        this.requeueExpiredInFlight(agentId, now);

        const queue = this.mailbox.get(agentId) || [];
        if (queue.length === 0) return [];

        const nextQueue: InterAgentMessageV3[] = [];
        const delivered: InterAgentMessageV3[] = [];
        for (const message of queue) {
            if (delivered.length >= limit || (message.visibleAt ?? 0) > now) {
                nextQueue.push(message);
                continue;
            }

            const attempt = (message.attempt ?? 0) + 1;
            const inFlightMessage: InterAgentMessageV3 = {
                ...message,
                attempt,
                status: 'in_flight',
                visibleAt: now,
                leaseUntil: now + leaseMs,
            };
            const inFlightMap = this.inFlight.get(agentId) || new Map<string, InterAgentMessageV3>();
            inFlightMap.set(inFlightMessage.messageId, inFlightMessage);
            this.inFlight.set(agentId, inFlightMap);
            delivered.push({ ...inFlightMessage });
        }

        this.mailbox.set(agentId, nextQueue);
        return delivered;
    }

    async waitForMessages(agentId: string, options?: WaitForMessagesOptionsV3): Promise<WaitForMessagesResultV3> {
        const waitMs =
            typeof options?.waitMs === 'number' && options.waitMs >= 0 ? options.waitMs : this.waitDefaults.waitMs;
        const pollIntervalMs =
            typeof options?.pollIntervalMs === 'number' && options.pollIntervalMs > 0
                ? options.pollIntervalMs
                : this.waitDefaults.pollIntervalMs;
        const startedAt = Date.now();
        const deadline = startedAt + waitMs;

        const receiveOptions: ReceiveMessageOptionsV3 = {
            limit: options?.limit,
            leaseMs: options?.leaseMs,
        };

        let messages = this.receiveMessages(agentId, receiveOptions);
        if (messages.length > 0 || waitMs === 0) {
            return {
                timedOut: messages.length === 0,
                waitedMs: Date.now() - startedAt,
                messages,
            };
        }

        while (Date.now() < deadline) {
            await this.sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
            messages = this.receiveMessages(agentId, receiveOptions);
            if (messages.length > 0) {
                return {
                    timedOut: false,
                    waitedMs: Date.now() - startedAt,
                    messages,
                };
            }
        }

        const includeProgress = options?.includeChildProgressOnTimeout !== false;
        const parentRunId = options?.parentRunId || (await this.resolveLatestRunIdByAgent(agentId));
        const childProgress =
            includeProgress && parentRunId
                ? await this.queryRuns({
                      parentRunId,
                      statuses: ['queued', 'running'],
                      limit: 200,
                  })
                : [];

        return {
            timedOut: true,
            waitedMs: Date.now() - startedAt,
            messages: [],
            childProgress,
        };
    }

    ackMessage(agentId: string, messageId: string): boolean {
        const inFlightMap = this.inFlight.get(agentId);
        if (!inFlightMap) return false;
        const message = inFlightMap.get(messageId);
        if (!message) return false;
        inFlightMap.delete(messageId);
        return true;
    }

    nackMessage(agentId: string, messageId: string, options?: NackMessageOptionsV3): NackMessageResultV3 {
        const inFlightMap = this.inFlight.get(agentId);
        if (!inFlightMap) {
            return { requeued: false, deadLettered: false };
        }

        const message = inFlightMap.get(messageId);
        if (!message) {
            return { requeued: false, deadLettered: false };
        }
        inFlightMap.delete(messageId);

        const now = Date.now();
        const maxAttempts = message.maxAttempts ?? this.messageDefaults.maxAttempts;
        const attempt = message.attempt ?? 0;
        const error = options?.error;
        if (attempt >= maxAttempts) {
            const dead: InterAgentMessageV3 = {
                ...message,
                status: 'dead_letter',
                leaseUntil: undefined,
                visibleAt: now,
                lastError: error,
            };
            const list = this.deadLetters.get(agentId) || [];
            list.push(dead);
            this.deadLetters.set(agentId, list);
            return {
                requeued: false,
                deadLettered: true,
                message: { ...dead },
            };
        }

        const requeueDelay = options?.requeueDelayMs && options.requeueDelayMs > 0 ? options.requeueDelayMs : 0;
        const queued: InterAgentMessageV3 = {
            ...message,
            status: 'queued',
            visibleAt: now + requeueDelay,
            leaseUntil: undefined,
            lastError: error,
        };
        const queue = this.mailbox.get(agentId) || [];
        queue.push(queued);
        this.mailbox.set(agentId, queue);
        return {
            requeued: true,
            deadLettered: false,
            message: { ...queued },
        };
    }

    listDeadLetters(agentId: string, limit: number = 20): InterAgentMessageV3[] {
        const list = this.deadLetters.get(agentId) || [];
        return list.slice(0, limit).map((item) => ({ ...item }));
    }

    async queryRuns(query: RunStatusQueryV3): Promise<RunStatusSnapshotV3[]> {
        let tracked = Array.from(this.runs.values());

        if (query.runId) {
            tracked = tracked.filter((item) => item.runId === query.runId);
        }
        if (query.agentId) {
            tracked = tracked.filter((item) => item.agentId === query.agentId);
        }
        if (query.parentRunId) {
            tracked = tracked.filter((item) => item.parentRunId === query.parentRunId);
        }
        if (query.parentAgentId) {
            const parentRunIds = new Set(
                Array.from(this.runs.values())
                    .filter((item) => item.agentId === query.parentAgentId)
                    .map((item) => item.runId)
            );
            tracked = tracked.filter((item) => item.parentRunId && parentRunIds.has(item.parentRunId));
        }

        const snapshots: RunStatusSnapshotV3[] = [];
        for (const item of tracked) {
            const live = await this.runtime.status(item.runId);
            const snapshot: RunStatusSnapshotV3 = {
                runId: item.runId,
                agentId: item.agentId,
                parentRunId: item.parentRunId,
                status: live?.status || item.status,
                createdAt: item.createdAt,
                startedAt: live?.startedAt,
                finishedAt: live?.finishedAt,
                error: live?.error,
                output: live?.output,
            };
            if (query.statuses && query.statuses.length > 0 && !query.statuses.includes(snapshot.status)) {
                continue;
            }
            snapshots.push(snapshot);
        }

        snapshots.sort((a, b) => b.createdAt - a.createdAt);
        const limit = query.limit && query.limit > 0 ? query.limit : 50;
        return snapshots.slice(0, limit);
    }

    private watchChildRun(parentRunId: string, childRunId: string, childAgentId: string): void {
        if (this.runWatchers.has(childRunId)) {
            return;
        }

        const parent = this.runs.get(parentRunId);
        if (!parent) {
            return;
        }

        const finalizeWatcher = async (statusHint?: RuntimeRunStatus): Promise<void> => {
            if (this.childTerminalNotified.has(childRunId)) {
                return;
            }

            const run = await this.runtime.status(childRunId);
            const terminalStatus = this.resolveTerminalStatus(statusHint || run?.status);
            if (!terminalStatus) {
                return;
            }

            this.childTerminalNotified.add(childRunId);
            this.cleanupWatcher(childRunId);
            this.updateTrackedRunStatus(childRunId, terminalStatus);

            const parentRun = this.runs.get(parentRunId);
            if (!parentRun) {
                return;
            }

            const topic = terminalStatus === 'completed' ? 'child-task-completed' : 'child-task-terminal';
            const payload: Record<string, unknown> = {
                runId: childRunId,
                parentRunId,
                status: terminalStatus,
                output: run?.output,
                error: run?.error,
                finishedAt: run?.finishedAt,
            };

            this.sendMessage({
                fromAgentId: childAgentId,
                toAgentId: parentRun.agentId,
                topic,
                payload,
                correlationId: parentRunId,
                runId: childRunId,
                idempotencyKey: `child-terminal:${childRunId}:${terminalStatus}`,
            });
        };

        const unsubscribe = this.runtime.stream(childRunId, (event) => {
            const status = this.statusFromRuntimeEventType((event as { type?: string })?.type);
            if (!status) return;
            void finalizeWatcher(status);
        });
        const poller = setInterval(() => {
            void finalizeWatcher();
        }, this.watcherDefaults.childStatusPollMs);

        this.runWatchers.set(childRunId, { unsubscribe, poller });
    }

    private cleanupWatcher(runId: string): void {
        const watcher = this.runWatchers.get(runId);
        if (!watcher) return;
        watcher.unsubscribe();
        clearInterval(watcher.poller);
        this.runWatchers.delete(runId);
    }

    private statusFromRuntimeEventType(eventType?: string): RuntimeRunStatus | undefined {
        if (eventType === 'run.completed') return 'completed';
        if (eventType === 'run.failed') return 'failed';
        if (eventType === 'run.aborted') return 'aborted';
        return undefined;
    }

    private resolveTerminalStatus(status?: RuntimeRunStatus): RuntimeRunStatus | undefined {
        if (!status) return undefined;
        if (status === 'completed' || status === 'failed' || status === 'aborted' || status === 'cancelled') {
            return status;
        }
        return undefined;
    }

    private updateTrackedRunStatus(runId: string, status: RuntimeRunStatus): void {
        const current = this.runs.get(runId);
        if (!current) return;
        this.runs.set(runId, {
            ...current,
            status,
        });
    }

    private async resolveLatestRunIdByAgent(agentId: string): Promise<string | undefined> {
        const candidates = Array.from(this.runs.values())
            .filter((item) => item.agentId === agentId)
            .sort((a, b) => b.createdAt - a.createdAt);
        for (const candidate of candidates) {
            const live = await this.runtime.status(candidate.runId);
            if (live?.status === 'running' || live?.status === 'queued') {
                return candidate.runId;
            }
        }
        return candidates[0]?.runId;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private requeueExpiredInFlight(agentId: string, now: number): void {
        const inFlightMap = this.inFlight.get(agentId);
        if (!inFlightMap || inFlightMap.size === 0) return;
        const queue = this.mailbox.get(agentId) || [];
        for (const message of inFlightMap.values()) {
            if (!message.leaseUntil || message.leaseUntil > now) continue;
            inFlightMap.delete(message.messageId);
            const queued: InterAgentMessageV3 = {
                ...message,
                status: 'queued',
                leaseUntil: undefined,
                visibleAt: now,
                lastError: message.lastError || 'lease expired',
            };
            queue.push(queued);
        }
        this.mailbox.set(agentId, queue);
    }

    private registerAgent(agentId: string, config: OrchestratorV3Options['agentsConfigs'][string]): void {
        const toolRegistry =
            config.toolRegistry ||
            createDefaultToolRegistry(
                {
                    workingDirectory: process.cwd(),
                    truncation: true,
                },
                config.provider
            );

        this.ensureToolRegistered(toolRegistry, 'agent_get_status', () => {
            return new AgentGetStatusToolV3(this.runtime, this.statusPort);
        });
        if (agentId === this.controllerId) {
            this.ensureToolRegistered(toolRegistry, 'agent_dispatch_task', () => {
                return new AgentDispatchTaskToolV3(this.runtime, this.dispatchPort);
            });
        }
        this.ensureToolRegistered(toolRegistry, 'agent_send_message', () => {
            return new AgentSendMessageToolV3(this.runtime, this.messagingPort);
        });
        this.ensureToolRegistered(toolRegistry, 'agent_receive_messages', () => {
            return new AgentReceiveMessagesToolV3(this.runtime, this.messagingPort);
        });
        this.ensureToolRegistered(toolRegistry, 'agent_wait_for_messages', () => {
            return new AgentWaitForMessagesToolV3(this.runtime, this.messagingPort);
        });
        this.ensureToolRegistered(toolRegistry, 'agent_ack_messages', () => {
            return new AgentAckMessagesToolV3(this.runtime, this.messagingPort);
        });
        this.ensureToolRegistered(toolRegistry, 'agent_nack_message', () => {
            return new AgentNackMessageToolV3(this.runtime, this.messagingPort);
        });
        this.ensureToolRegistered(toolRegistry, 'agent_list_dead_letters', () => {
            return new AgentListDeadLettersToolV3(this.runtime, this.messagingPort);
        });

        const profile: AgentProfileV2 = {
            agentId,
            role: config.role,
            systemPrompt: config.systemPrompt,
            provider: config.provider,
            toolRegistry,
            memoryManager: config.memoryManager,
            maxRetries: config.maxRetries,
            maxLoops: config.maxLoops,
            requestTimeout: config.requestTimeout,
            idleTimeout: config.idleTimeout,
            retryDelayMs: config.retryDelayMs,
            thinking: config.thinking,
            planMode: config.planMode,
            planBaseDir: config.planBaseDir,
            metadata: config.metadata,
        };
        this.runtime.upsertAgent(profile);
    }

    private ensureToolRegistered(
        toolRegistry: ToolRegistry,
        toolName: string,
        factory: () =>
            | AgentGetStatusToolV3
            | AgentDispatchTaskToolV3
            | AgentSendMessageToolV3
            | AgentReceiveMessagesToolV3
            | AgentWaitForMessagesToolV3
            | AgentAckMessagesToolV3
            | AgentNackMessageToolV3
            | AgentListDeadLettersToolV3
    ): void {
        if (toolRegistry.hasTool(toolName)) {
            return;
        }
        toolRegistry.register([factory()]);
    }
}
