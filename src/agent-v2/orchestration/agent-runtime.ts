import { v4 as uuid } from 'uuid';
import { Agent } from '../agent/agent';
import type { AgentMessage } from '../agent/stream-types';
import type { MessageContent } from '../../providers';
import type {
    AgentRuntime,
    ExecuteCommand,
    EventStream,
    InterAgentMessage,
    RunHandle,
    RunRecord,
    StateStore,
} from './types';

export interface AgentRuntimeServiceOptions {
    inLoopMessageInjection?: {
        enabled?: boolean;
        receiveLimit?: number;
        leaseMs?: number;
    };
}

export class AgentRuntimeService implements AgentRuntime {
    private readonly stateStore: StateStore;
    private readonly eventStream: EventStream;
    private readonly activeRuns = new Map<string, Agent>();
    private readonly inLoopMessageInjection: Required<
        NonNullable<AgentRuntimeServiceOptions['inLoopMessageInjection']>
    >;

    constructor(stateStore: StateStore, eventStream: EventStream, options?: AgentRuntimeServiceOptions) {
        this.stateStore = stateStore;
        this.eventStream = eventStream;
        this.inLoopMessageInjection = {
            enabled: options?.inLoopMessageInjection?.enabled ?? true,
            receiveLimit:
                options?.inLoopMessageInjection?.receiveLimit && options.inLoopMessageInjection.receiveLimit > 0
                    ? options.inLoopMessageInjection.receiveLimit
                    : 10,
            leaseMs:
                options?.inLoopMessageInjection?.leaseMs && options.inLoopMessageInjection.leaseMs > 0
                    ? options.inLoopMessageInjection.leaseMs
                    : 15_000,
        };
    }

    async execute(command: ExecuteCommand): Promise<RunHandle> {
        const profile = this.stateStore.getAgentProfile(command.agentId);
        if (!profile) {
            throw new Error(`Agent profile not found: ${command.agentId}`);
        }

        const runId = uuid();
        const depth = command.depth ?? 0;
        const createdAt = Date.now();
        const queued: RunRecord = {
            runId,
            agentId: command.agentId,
            parentRunId: command.parentRunId,
            depth,
            status: 'queued',
            input: command.input,
            createdAt,
            metadata: command.metadata,
        };
        this.stateStore.saveRun(queued);
        this.eventStream.publish({
            eventId: uuid(),
            timestamp: createdAt,
            type: 'run.queued',
            runId,
            agentId: command.agentId,
            payload: { depth },
        });

        void this.runAgent(queued, command);

        return {
            runId,
            agentId: command.agentId,
            status: 'queued',
        };
    }

    async abort(runId: string): Promise<void> {
        const running = this.activeRuns.get(runId);
        if (!running) {
            return;
        }
        running.abort();
    }

    stream(runId: string, listener: (event: AgentMessage | import('./types').RuntimeEvent) => void): () => void {
        return this.eventStream.subscribe({ runId }, (event) => {
            if (event.type === 'run.stream' && event.payload?.message) {
                listener(event.payload.message as AgentMessage);
                return;
            }
            listener(event);
        });
    }

    async status(runId: string): Promise<RunRecord | undefined> {
        return this.stateStore.getRun(runId);
    }

    private async runAgent(baseRun: RunRecord, command: ExecuteCommand): Promise<void> {
        const profile = this.stateStore.getAgentProfile(baseRun.agentId);
        if (!profile) {
            this.stateStore.updateRun(baseRun.runId, {
                status: 'failed',
                error: `Agent profile not found during execution: ${baseRun.agentId}`,
                finishedAt: Date.now(),
            });
            this.eventStream.publish({
                eventId: uuid(),
                timestamp: Date.now(),
                type: 'run.failed',
                runId: baseRun.runId,
                agentId: baseRun.agentId,
                payload: { error: `Agent profile not found during execution: ${baseRun.agentId}` },
            });
            return;
        }

        const sessionId = this.stateStore.getAgentSession(profile.agentId) || profile.sessionId;
        const agent = new Agent({
            provider: profile.provider,
            systemPrompt: profile.systemPrompt,
            toolRegistry: profile.toolRegistry,
            memoryManager: profile.memoryManager,
            sessionId,
            maxRetries: profile.maxRetries,
            maxLoops: profile.maxLoops,
            requestTimeout: profile.requestTimeout,
            idleTimeout: profile.idleTimeout,
            retryDelayMs: profile.retryDelayMs,
            thinking: profile.thinking,
            planMode: profile.planMode,
            planBaseDir: profile.planBaseDir,
            stream: true,
            streamCallback: (message) => {
                this.eventStream.publish({
                    eventId: uuid(),
                    timestamp: Date.now(),
                    type: 'run.stream',
                    runId: baseRun.runId,
                    agentId: baseRun.agentId,
                    payload: { message },
                });
            },
            loopBoundaryHook: async ({ appendUserMessage }) => {
                await this.injectMessagesAtLoopBoundary(baseRun.runId, baseRun.agentId, appendUserMessage);
            },
        });

        this.activeRuns.set(baseRun.runId, agent);
        this.stateStore.updateRun(baseRun.runId, {
            status: 'running',
            startedAt: Date.now(),
            sessionId: agent.getSessionId(),
        });
        this.stateStore.setAgentSession(baseRun.agentId, agent.getSessionId());
        this.eventStream.publish({
            eventId: uuid(),
            timestamp: Date.now(),
            type: 'run.started',
            runId: baseRun.runId,
            agentId: baseRun.agentId,
            payload: { sessionId: agent.getSessionId() },
        });

        try {
            const result = await agent.executeWithResult(command.input, command.options);

            this.stateStore.setAgentSession(baseRun.agentId, result.sessionId);

            if (result.status === 'completed') {
                const output = this.messageToText(result.finalMessage?.content);
                this.stateStore.updateRun(baseRun.runId, {
                    status: 'completed',
                    output,
                    sessionId: result.sessionId,
                    finishedAt: Date.now(),
                });
                this.eventStream.publish({
                    eventId: uuid(),
                    timestamp: Date.now(),
                    type: 'run.completed',
                    runId: baseRun.runId,
                    agentId: baseRun.agentId,
                    payload: {
                        sessionId: result.sessionId,
                        output,
                        loopCount: result.loopCount,
                    },
                });
                return;
            }

            const failureMessage = result.failure?.internalMessage || result.failure?.userMessage || 'Unknown failure';
            const status = result.status === 'aborted' ? 'aborted' : 'failed';
            this.stateStore.updateRun(baseRun.runId, {
                status,
                error: failureMessage,
                sessionId: result.sessionId,
                finishedAt: Date.now(),
            });
            this.eventStream.publish({
                eventId: uuid(),
                timestamp: Date.now(),
                type: status === 'aborted' ? 'run.aborted' : 'run.failed',
                runId: baseRun.runId,
                agentId: baseRun.agentId,
                payload: {
                    sessionId: result.sessionId,
                    error: failureMessage,
                    code: result.failure?.code,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.stateStore.updateRun(baseRun.runId, {
                status: 'failed',
                error: message,
                finishedAt: Date.now(),
            });
            this.eventStream.publish({
                eventId: uuid(),
                timestamp: Date.now(),
                type: 'run.failed',
                runId: baseRun.runId,
                agentId: baseRun.agentId,
                payload: { error: message },
            });
        } finally {
            this.activeRuns.delete(baseRun.runId);
            await agent.close().catch(() => undefined);
        }
    }

    private messageToText(content: unknown): string {
        if (typeof content === 'string') {
            return content;
        }
        if (!Array.isArray(content)) {
            return '';
        }
        return content
            .map((part) => {
                if (!part || typeof part !== 'object') return '';
                const typed = part as { type?: string; text?: string };
                if (typed.type === 'text' && typeof typed.text === 'string') {
                    return typed.text;
                }
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }

    private async injectMessagesAtLoopBoundary(
        runId: string,
        agentId: string,
        appendUserMessage: (content: MessageContent) => void
    ): Promise<void> {
        if (!this.inLoopMessageInjection.enabled) {
            return;
        }

        const incoming = this.stateStore.receiveMessages(agentId, {
            limit: this.inLoopMessageInjection.receiveLimit,
            leaseMs: this.inLoopMessageInjection.leaseMs,
        });
        if (incoming.length === 0) {
            return;
        }

        try {
            const messageText = this.serializeIncomingMessages(incoming);
            appendUserMessage(messageText);
            for (const message of incoming) {
                const acked = this.stateStore.ackMessage(agentId, message.messageId);
                if (acked) {
                    this.eventStream.publish({
                        eventId: uuid(),
                        timestamp: Date.now(),
                        type: 'agent.message.acked',
                        runId,
                        agentId,
                        payload: {
                            messageId: message.messageId,
                            topic: message.topic,
                            mode: 'in-loop-injection',
                        },
                    });
                    continue;
                }

                const nack = this.stateStore.nackMessage(agentId, message.messageId, {
                    error: 'Ack failed during in-loop injection',
                    requeueDelayMs: 0,
                });
                this.eventStream.publish({
                    eventId: uuid(),
                    timestamp: Date.now(),
                    type: nack.deadLettered ? 'agent.message.dead_letter' : 'agent.message.nacked',
                    runId,
                    agentId,
                    payload: {
                        messageId: message.messageId,
                        topic: message.topic,
                        error: 'Ack failed during in-loop injection',
                        mode: 'in-loop-injection',
                    },
                });
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            for (const message of incoming) {
                const nack = this.stateStore.nackMessage(agentId, message.messageId, {
                    error: `Loop boundary injection failed: ${reason}`,
                    requeueDelayMs: 0,
                });
                this.eventStream.publish({
                    eventId: uuid(),
                    timestamp: Date.now(),
                    type: nack.deadLettered ? 'agent.message.dead_letter' : 'agent.message.nacked',
                    runId,
                    agentId,
                    payload: {
                        messageId: message.messageId,
                        topic: message.topic,
                        error: `Loop boundary injection failed: ${reason}`,
                        mode: 'in-loop-injection',
                    },
                });
            }
        }
    }

    private serializeIncomingMessages(messages: InterAgentMessage[]): string {
        const normalized = messages.map((message) => ({
            messageId: message.messageId,
            fromAgentId: message.fromAgentId,
            topic: message.topic,
            correlationId: message.correlationId,
            payload: message.payload,
        }));
        return `Inter-agent messages injected at loop boundary:\n${JSON.stringify(normalized, null, 2)}`;
    }
}
