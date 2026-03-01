import type {
    AgentProfile,
    InterAgentMessage,
    NackMessageOptions,
    NackMessageResult,
    ReceiveMessageOptions,
    RouteBinding,
    RunRecord,
    RuntimeRunStatus,
    StateStore,
} from './types';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_PARTITION = '__default__';

type IdempotencyEntry = {
    messageId: string;
    expiresAt: number;
};

export class InMemoryStateStore implements StateStore {
    private readonly profiles = new Map<string, AgentProfile>();
    private readonly runs = new Map<string, RunRecord>();
    private readonly bindings = new Map<string, RouteBinding>();
    private readonly routeSessions = new Map<string, string>();
    private readonly agentSessions = new Map<string, string>();
    private readonly sessionAgents = new Map<string, string>();

    private readonly mailbox = new Map<string, InterAgentMessage[]>();
    private readonly inFlight = new Map<string, Map<string, InterAgentMessage>>();
    private readonly deadLetters = new Map<string, InterAgentMessage[]>();
    private readonly messageIndex = new Map<string, Map<string, InterAgentMessage>>();
    private readonly idempotencyIndex = new Map<string, Map<string, IdempotencyEntry>>();
    private readonly partitionCounters = new Map<string, Map<string, number>>();

    saveAgentProfile(profile: AgentProfile): void {
        this.profiles.set(profile.agentId, { ...profile });
        if (profile.sessionId) {
            this.agentSessions.set(profile.agentId, profile.sessionId);
            this.sessionAgents.set(profile.sessionId, profile.agentId);
        }
    }

    getAgentProfile(agentId: string): AgentProfile | undefined {
        const profile = this.profiles.get(agentId);
        return profile ? { ...profile } : undefined;
    }

    listAgentProfiles(): AgentProfile[] {
        return Array.from(this.profiles.values()).map((profile) => ({ ...profile }));
    }

    saveRun(run: RunRecord): void {
        this.runs.set(run.runId, { ...run });
    }

    updateRun(runId: string, patch: Partial<RunRecord>): RunRecord | undefined {
        const current = this.runs.get(runId);
        if (!current) return undefined;

        const next: RunRecord = { ...current, ...patch };
        this.runs.set(runId, next);
        return { ...next };
    }

    getRun(runId: string): RunRecord | undefined {
        const run = this.runs.get(runId);
        return run ? { ...run } : undefined;
    }

    listRuns(filter?: { agentId?: string; parentRunId?: string; statuses?: RuntimeRunStatus[] }): RunRecord[] {
        let runs = Array.from(this.runs.values());

        if (filter?.agentId) {
            runs = runs.filter((run) => run.agentId === filter.agentId);
        }
        if (filter?.parentRunId) {
            runs = runs.filter((run) => run.parentRunId === filter.parentRunId);
        }
        if (filter?.statuses && filter.statuses.length > 0) {
            runs = runs.filter((run) => filter.statuses!.includes(run.status));
        }

        return runs.map((run) => ({ ...run }));
    }

    saveBinding(binding: RouteBinding): void {
        this.bindings.set(binding.bindingId, { ...binding });
    }

    listBindings(): RouteBinding[] {
        return Array.from(this.bindings.values())
            .map((binding) => ({ ...binding }))
            .sort((a, b) => a.priority - b.priority);
    }

    saveRouteSession(stickyKey: string, agentId: string): void {
        this.routeSessions.set(stickyKey, agentId);
    }

    getRouteSession(stickyKey: string): string | undefined {
        return this.routeSessions.get(stickyKey);
    }

    setAgentSession(agentId: string, sessionId: string): void {
        const previousSessionId = this.agentSessions.get(agentId);
        if (previousSessionId) {
            this.sessionAgents.delete(previousSessionId);
        }
        this.agentSessions.set(agentId, sessionId);
        this.sessionAgents.set(sessionId, agentId);
    }

    getAgentSession(agentId: string): string | undefined {
        return this.agentSessions.get(agentId);
    }

    getAgentIdBySession(sessionId: string): string | undefined {
        return this.sessionAgents.get(sessionId);
    }

    enqueueMessage(agentId: string, message: InterAgentMessage): void {
        const queue = this.mailbox.get(agentId) || [];
        const now = Date.now();
        const partitionKey = this.resolvePartitionKey(message);
        const normalized: InterAgentMessage = {
            ...message,
            partitionKey,
            partitionSeq: message.partitionSeq ?? this.nextPartitionSeq(agentId, partitionKey),
            attempt: message.attempt ?? 0,
            maxAttempts: message.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
            visibleAt: message.visibleAt ?? now,
            status: 'queued',
            leaseUntil: undefined,
        };
        this.insertQueuedMessage(queue, normalized);
        this.mailbox.set(agentId, queue);
        this.indexMessage(agentId, normalized);
    }

    getMessage(agentId: string, messageId: string): InterAgentMessage | undefined {
        const index = this.messageIndex.get(agentId);
        const message = index?.get(messageId);
        return message ? { ...message } : undefined;
    }

    findMessageByIdempotency(
        agentId: string,
        idempotencyKey: string,
        now: number = Date.now()
    ): InterAgentMessage | undefined {
        const keys = this.idempotencyIndex.get(agentId);
        if (!keys) return undefined;

        const entry = keys.get(idempotencyKey);
        if (!entry) return undefined;
        if (entry.expiresAt <= now) {
            keys.delete(idempotencyKey);
            return undefined;
        }

        return this.getMessage(agentId, entry.messageId);
    }

    saveIdempotency(agentId: string, idempotencyKey: string, messageId: string, expiresAt: number): void {
        this.cleanupExpiredIdempotency(agentId, Date.now());
        const keys = this.idempotencyIndex.get(agentId) || new Map<string, IdempotencyEntry>();
        keys.set(idempotencyKey, { messageId, expiresAt });
        this.idempotencyIndex.set(agentId, keys);
    }

    receiveMessages(agentId: string, options?: ReceiveMessageOptions): InterAgentMessage[] {
        const now = options?.now ?? Date.now();
        const limit = options?.limit && options.limit > 0 ? options.limit : Number.POSITIVE_INFINITY;
        const leaseMs = options?.leaseMs && options.leaseMs > 0 ? options.leaseMs : DEFAULT_LEASE_MS;

        this.requeueExpiredInFlight(agentId, now);

        const queue = this.mailbox.get(agentId) || [];
        if (queue.length === 0) {
            return [];
        }

        const deliverable: InterAgentMessage[] = [];
        const remaining: InterAgentMessage[] = [];
        const blockedPartitions = this.collectBlockedPartitions(agentId);

        for (const message of queue) {
            const partition = this.resolvePartitionKey(message);

            if (blockedPartitions.has(partition)) {
                remaining.push(message);
                continue;
            }

            if ((message.visibleAt ?? 0) > now) {
                blockedPartitions.add(partition);
                remaining.push(message);
                continue;
            }

            if (deliverable.length >= limit) {
                remaining.push(message);
                continue;
            }

            const nextAttempt = (message.attempt ?? 0) + 1;
            const maxAttempts = message.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
            if (nextAttempt > maxAttempts) {
                this.pushDeadLetter(agentId, {
                    ...message,
                    attempt: nextAttempt,
                    status: 'dead_letter',
                    leaseUntil: undefined,
                    visibleAt: now,
                    lastError: message.lastError || 'Max attempts exceeded before delivery',
                });
                continue;
            }

            const inFlightMessage: InterAgentMessage = {
                ...message,
                partitionKey: partition,
                attempt: nextAttempt,
                maxAttempts,
                status: 'in_flight',
                leaseUntil: now + leaseMs,
                visibleAt: now,
            };
            this.putInFlight(agentId, inFlightMessage);
            this.indexMessage(agentId, inFlightMessage);
            blockedPartitions.add(partition);
            deliverable.push({ ...inFlightMessage });
        }

        this.mailbox.set(agentId, remaining);
        return deliverable;
    }

    ackMessage(agentId: string, messageId: string): boolean {
        const inFlight = this.inFlight.get(agentId);
        if (!inFlight) return false;

        const message = inFlight.get(messageId);
        if (!message) return false;

        inFlight.delete(messageId);
        this.indexMessage(agentId, {
            ...message,
            status: 'acked',
            leaseUntil: undefined,
        });
        return true;
    }

    nackMessage(agentId: string, messageId: string, options?: NackMessageOptions): NackMessageResult {
        const inFlight = this.inFlight.get(agentId);
        if (!inFlight) {
            return { requeued: false, deadLettered: false };
        }
        const message = inFlight.get(messageId);
        if (!message) {
            return { requeued: false, deadLettered: false };
        }
        inFlight.delete(messageId);

        const now = Date.now();
        const requeueDelayMs = options?.requeueDelayMs && options.requeueDelayMs > 0 ? options.requeueDelayMs : 0;
        const updatedMessage: InterAgentMessage = {
            ...message,
            leaseUntil: undefined,
            lastError: options?.error,
        };

        if ((updatedMessage.attempt ?? 0) >= (updatedMessage.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
            const deadLetter = {
                ...updatedMessage,
                status: 'dead_letter' as const,
                visibleAt: now,
            };
            this.pushDeadLetter(agentId, deadLetter);
            return { requeued: false, deadLettered: true, message: { ...deadLetter } };
        }

        const queue = this.mailbox.get(agentId) || [];
        const requeued = {
            ...updatedMessage,
            status: 'queued' as const,
            visibleAt: now + requeueDelayMs,
        };
        this.insertQueuedMessage(queue, requeued);
        this.mailbox.set(agentId, queue);
        this.indexMessage(agentId, requeued);
        return { requeued: true, deadLettered: false, message: { ...requeued } };
    }

    listDeadLetters(agentId: string, limit?: number): InterAgentMessage[] {
        const queue = this.deadLetters.get(agentId) || [];
        const count = limit && limit > 0 ? limit : queue.length;
        return queue.slice(0, count).map((message) => ({ ...message }));
    }

    requeueDeadLetter(
        agentId: string,
        messageId: string,
        options?: { delayMs?: number; resetAttempts?: boolean }
    ): boolean {
        const queue = this.deadLetters.get(agentId) || [];
        const index = queue.findIndex((message) => message.messageId === messageId);
        if (index < 0) return false;

        const [message] = queue.splice(index, 1);
        this.deadLetters.set(agentId, queue);

        const now = Date.now();
        const delayMs = options?.delayMs && options.delayMs > 0 ? options.delayMs : 0;
        const nextMessage: InterAgentMessage = {
            ...message,
            status: 'queued',
            leaseUntil: undefined,
            visibleAt: now + delayMs,
            lastError: undefined,
            attempt: options?.resetAttempts ? 0 : message.attempt,
        };
        const pending = this.mailbox.get(agentId) || [];
        this.insertQueuedMessage(pending, nextMessage);
        this.mailbox.set(agentId, pending);
        this.indexMessage(agentId, nextMessage);
        return true;
    }

    drainMessages(agentId: string, limit?: number): InterAgentMessage[] {
        const received = this.receiveMessages(agentId, {
            limit,
            leaseMs: 1,
        });
        for (const message of received) {
            this.ackMessage(agentId, message.messageId);
        }
        return received.map((message) => ({ ...message, status: 'acked', leaseUntil: undefined }));
    }

    private putInFlight(agentId: string, message: InterAgentMessage): void {
        const inFlight = this.inFlight.get(agentId) || new Map<string, InterAgentMessage>();
        inFlight.set(message.messageId, message);
        this.inFlight.set(agentId, inFlight);
    }

    private requeueExpiredInFlight(agentId: string, now: number): void {
        const inFlight = this.inFlight.get(agentId);
        if (!inFlight || inFlight.size === 0) return;

        const queue = this.mailbox.get(agentId) || [];
        for (const message of inFlight.values()) {
            if (!message.leaseUntil || message.leaseUntil > now) continue;

            inFlight.delete(message.messageId);
            if ((message.attempt ?? 0) >= (message.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
                this.pushDeadLetter(agentId, {
                    ...message,
                    status: 'dead_letter',
                    leaseUntil: undefined,
                    visibleAt: now,
                    lastError: message.lastError || 'Max attempts exceeded after lease timeout',
                });
                continue;
            }

            const requeued = {
                ...message,
                status: 'queued' as const,
                leaseUntil: undefined,
                visibleAt: now,
                lastError: message.lastError || 'Lease expired; message requeued',
            };
            this.insertQueuedMessage(queue, requeued);
            this.indexMessage(agentId, requeued);
        }
        this.mailbox.set(agentId, queue);
    }

    private pushDeadLetter(agentId: string, message: InterAgentMessage): void {
        const deadLetters = this.deadLetters.get(agentId) || [];
        const deadMessage = { ...message, status: 'dead_letter' as const, leaseUntil: undefined };
        deadLetters.push(deadMessage);
        this.deadLetters.set(agentId, deadLetters);
        this.indexMessage(agentId, deadMessage);
    }

    private resolvePartitionKey(message: InterAgentMessage): string {
        if (message.partitionKey && message.partitionKey.trim().length > 0) {
            return message.partitionKey.trim();
        }
        if (message.topic && message.topic.trim().length > 0) {
            return message.topic.trim();
        }
        return DEFAULT_PARTITION;
    }

    private nextPartitionSeq(agentId: string, partitionKey: string): number {
        const counters = this.partitionCounters.get(agentId) || new Map<string, number>();
        const next = (counters.get(partitionKey) || 0) + 1;
        counters.set(partitionKey, next);
        this.partitionCounters.set(agentId, counters);
        return next;
    }

    private collectBlockedPartitions(agentId: string): Set<string> {
        const blocked = new Set<string>();
        const inFlight = this.inFlight.get(agentId);
        if (!inFlight) return blocked;

        for (const message of inFlight.values()) {
            blocked.add(this.resolvePartitionKey(message));
        }
        return blocked;
    }

    private insertQueuedMessage(queue: InterAgentMessage[], message: InterAgentMessage): void {
        const partitionKey = this.resolvePartitionKey(message);
        const seq = message.partitionSeq;
        if (typeof seq !== 'number') {
            queue.push(message);
            return;
        }

        const index = queue.findIndex((item) => {
            if (this.resolvePartitionKey(item) !== partitionKey) return false;
            const itemSeq = item.partitionSeq;
            return typeof itemSeq === 'number' && itemSeq > seq;
        });
        if (index < 0) {
            queue.push(message);
            return;
        }
        queue.splice(index, 0, message);
    }

    private indexMessage(agentId: string, message: InterAgentMessage): void {
        const index = this.messageIndex.get(agentId) || new Map<string, InterAgentMessage>();
        index.set(message.messageId, { ...message });
        this.messageIndex.set(agentId, index);
    }

    private cleanupExpiredIdempotency(agentId: string, now: number): void {
        const keys = this.idempotencyIndex.get(agentId);
        if (!keys || keys.size === 0) return;

        for (const [idempotencyKey, entry] of keys.entries()) {
            if (entry.expiresAt <= now) {
                keys.delete(idempotencyKey);
            }
        }
    }
}
