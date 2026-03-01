import { v4 as uuid } from 'uuid';
import type { AgentOptions } from '../agent/types';
import { createDefaultToolRegistry, createPlanModeToolRegistry, ToolRegistry } from '../tool';
import type { MessageContent } from '../../providers';
import type {
    BudgetPolicy,
    AgentProfile,
    AgentRuntime,
    EventStream,
    InterAgentMessage,
    MessageRuntimeConfig,
    MessagingPolicy,
    NackMessageResult,
    PolicyEngine,
    ReceiveMessageOptions,
    RouteBinding,
    RouteDecision,
    RouteRequest,
    RuntimeEvent,
    RunGraphNode,
    RunHandle,
    SpawnCommand,
    StateStore,
} from './types';
import { AgentRuntimeService } from './agent-runtime';
import { InMemoryEventStream } from './event-stream';
import { GatewayRouter } from './gateway-router';
import {
    AgentAckMessagesTool,
    AgentListDeadLettersTool,
    AgentNackMessageTool,
    AgentReceiveMessagesTool,
    AgentRequeueDeadLetterTool,
    AgentSendMessageTool,
} from './messaging-tools';
import { DefaultPolicyEngine } from './policy-engine';
import { InMemoryStateStore } from './state-store';

interface AgentRuntimeOverrides {
    toolRegistry?: AgentProfile['toolRegistry'];
    memoryManager?: AgentProfile['memoryManager'];
    sessionId?: AgentProfile['sessionId'];
    maxRetries?: AgentProfile['maxRetries'];
    maxLoops?: AgentProfile['maxLoops'];
    requestTimeout?: AgentProfile['requestTimeout'];
    idleTimeout?: AgentProfile['idleTimeout'];
    retryDelayMs?: AgentProfile['retryDelayMs'];
    thinking?: AgentProfile['thinking'];
    planMode?: AgentProfile['planMode'];
    planBaseDir?: AgentProfile['planBaseDir'];
    metadata?: AgentProfile['metadata'];
}

export interface AutoDispatchTrigger {
    messageId: string;
    toAgentId: string;
    fromAgentId?: string;
    topic?: string;
    runId?: string;
    correlationId?: string;
}

export interface AutoDispatchConfig {
    enabled?: boolean;
    debounceMs?: number;
    receiveLimit?: number;
    leaseMs?: number;
    skipIfAgentRunning?: boolean;
    inputBuilder?: (trigger: AutoDispatchTrigger) => MessageContent;
}

export interface AgentConfig extends AgentRuntimeOverrides {
    agentId: string;
    role: string;
    systemPrompt?: string;
    provider?: AgentOptions['provider'];
    bindings?: Array<
        Omit<RouteBinding, 'agentId' | 'bindingId'> & {
            bindingId?: string;
        }
    >;
}

export interface OrchestratorKernelRuntimeOptions {
    runtime: AgentRuntime;
    stateStore: StateStore;
    policyEngine: PolicyEngine;
    eventStream: EventStream;
    router?: GatewayRouter;
    enableMessagingTools?: boolean;
    messageRuntime?: Partial<MessageRuntimeConfig>;
    inLoopMessageInjection?: {
        enabled?: boolean;
        receiveLimit?: number;
        leaseMs?: number;
    };
    autoDispatch?: AutoDispatchConfig;
}

export interface OrchestratorKernelBootstrapOptions extends AgentRuntimeOverrides {
    provider: AgentOptions['provider'];
    systemPrompt: string;
    controllerAgentId?: string;
    controllerRole?: string;
    defaultAgentId?: string;
    budget?: Partial<BudgetPolicy>;
    messagingPolicy?: MessagingPolicy;
    messageRuntime?: Partial<MessageRuntimeConfig>;
    inLoopMessageInjection?: {
        enabled?: boolean;
        receiveLimit?: number;
        leaseMs?: number;
    };
    agentsConfig?: AgentConfig[];
    // Backward-compatible alias for a frequent typo in early design docs.
    agentsCodifg?: AgentConfig[];
    bindings?: RouteBinding[];
    enableMessagingTools?: boolean;
    autoDispatch?: AutoDispatchConfig;
}

export type OrchestratorKernelOptions = OrchestratorKernelRuntimeOptions | OrchestratorKernelBootstrapOptions;

export class OrchestratorKernel {
    private readonly runtime: AgentRuntime;
    private readonly stateStore: StateStore;
    private readonly policyEngine: PolicyEngine;
    private readonly eventStream: EventStream;
    private readonly router: GatewayRouter;
    private readonly enableMessagingTools: boolean;
    private readonly messageRuntime: MessageRuntimeConfig;
    private readonly autoDispatch: Required<Omit<AutoDispatchConfig, 'inputBuilder'>> & {
        inputBuilder?: AutoDispatchConfig['inputBuilder'];
    };
    private autoDispatchUnsubscribe?: () => void;
    private readonly autoDispatchTimers = new Map<string, NodeJS.Timeout>();
    private readonly autoDispatchInFlight = new Set<string>();
    private readonly autoDispatchTriggers = new Map<string, AutoDispatchTrigger>();

    constructor(options: OrchestratorKernelOptions) {
        if (this.isRuntimeOptions(options)) {
            this.runtime = options.runtime;
            this.stateStore = options.stateStore;
            this.policyEngine = options.policyEngine;
            this.eventStream = options.eventStream;
            this.router = options.router || new GatewayRouter(this.stateStore);
            this.enableMessagingTools = options.enableMessagingTools ?? true;
            this.messageRuntime = this.resolveMessageRuntimeConfig(options.messageRuntime);
            this.autoDispatch = this.resolveAutoDispatchConfig(options.autoDispatch);
            this.setupAutoDispatch();
            return;
        }

        this.stateStore = new InMemoryStateStore();
        this.eventStream = new InMemoryEventStream();
        this.policyEngine = new DefaultPolicyEngine(this.stateStore, {
            budget: options.budget,
            messaging: options.messagingPolicy,
        });
        this.runtime = new AgentRuntimeService(this.stateStore, this.eventStream, {
            inLoopMessageInjection: options.inLoopMessageInjection,
        });

        const controllerAgentId = options.controllerAgentId?.trim() || 'controller';
        this.router = new GatewayRouter(this.stateStore, {
            defaultAgentId: options.defaultAgentId || controllerAgentId,
        });
        this.enableMessagingTools = options.enableMessagingTools ?? true;
        this.messageRuntime = this.resolveMessageRuntimeConfig(options.messageRuntime);
        this.autoDispatch = this.resolveAutoDispatchConfig(options.autoDispatch);

        const controllerProfile: AgentProfile = {
            agentId: controllerAgentId,
            role: options.controllerRole || 'controller',
            systemPrompt: options.systemPrompt,
            provider: options.provider,
            ...this.pickRuntimeOverrides(options),
        };
        this.registerAgent(controllerProfile);

        const subAgentConfigs = options.agentsConfig || options.agentsCodifg || [];
        for (const agentConfig of subAgentConfigs) {
            const profile: AgentProfile = {
                agentId: agentConfig.agentId,
                role: agentConfig.role,
                systemPrompt: agentConfig.systemPrompt || options.systemPrompt,
                provider: agentConfig.provider || options.provider,
                ...this.pickRuntimeOverrides(options),
                ...this.pickRuntimeOverrides(agentConfig),
                metadata: {
                    ...(options.metadata || {}),
                    ...(agentConfig.metadata || {}),
                },
            };
            this.registerAgent(profile);

            for (const binding of agentConfig.bindings || []) {
                this.registerBinding({
                    ...binding,
                    bindingId: binding.bindingId || `${agentConfig.agentId}-${uuid().slice(0, 8)}`,
                    agentId: agentConfig.agentId,
                });
            }
        }

        for (const binding of options.bindings || []) {
            this.registerBinding(binding);
        }

        this.setupAutoDispatch();
    }

    registerAgent(profile: AgentProfile): AgentProfile {
        const normalizedProfile = this.attachMessagingTools(profile);
        this.stateStore.saveAgentProfile(normalizedProfile);
        return normalizedProfile;
    }

    registerBinding(binding: RouteBinding): RouteBinding {
        this.stateStore.saveBinding(binding);
        return binding;
    }

    route(request: RouteRequest): RouteDecision {
        return this.router.route(request);
    }

    async routeAndExecute(request: RouteRequest, input: MessageContent): Promise<RunHandle> {
        const decision = this.route(request);
        return this.execute({
            agentId: decision.agentId,
            input,
            metadata: {
                routeDecision: decision,
                routeRequest: request,
            },
        });
    }

    async execute(command: {
        agentId: string;
        input: MessageContent;
        options?: import('../../providers').LLMGenerateOptions;
        parentRunId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<RunHandle> {
        const profile = this.stateStore.getAgentProfile(command.agentId);
        if (!profile) {
            throw new Error(`Agent profile not found: ${command.agentId}`);
        }

        const depth = this.resolveDepth(command.parentRunId);
        const executionPolicy = this.policyEngine.canExecute({
            agentId: command.agentId,
            parentRunId: command.parentRunId,
            depth,
        });
        if (!executionPolicy.allowed) {
            throw new Error(executionPolicy.reason || `Execution denied for agent ${command.agentId}`);
        }

        const requestedModel =
            command.options && typeof command.options.model === 'string' ? command.options.model : undefined;
        const resolvedModel = this.policyEngine.resolveModel(command.agentId, requestedModel);
        const options =
            resolvedModel && resolvedModel !== requestedModel
                ? { ...(command.options || {}), model: resolvedModel }
                : command.options;

        return this.runtime.execute({
            agentId: command.agentId,
            input: command.input,
            options,
            parentRunId: command.parentRunId,
            depth,
            metadata: command.metadata,
        });
    }

    spawn(command: SpawnCommand): AgentProfile {
        const controller = this.stateStore.getAgentProfile(command.controllerAgentId);
        if (!controller) {
            throw new Error(`Controller agent not found: ${command.controllerAgentId}`);
        }

        const spawnPolicy = this.policyEngine.canSpawn({
            controllerAgentId: command.controllerAgentId,
            parentRunId: command.parentRunId,
        });
        if (!spawnPolicy.allowed) {
            throw new Error(spawnPolicy.reason || `Spawn denied for ${command.controllerAgentId}`);
        }

        const childAgentId = command.childAgentId || `agent_${uuid().slice(0, 8)}`;
        const profile: AgentProfile = {
            agentId: childAgentId,
            role: command.role,
            systemPrompt: command.systemPrompt || controller.systemPrompt,
            provider: command.provider || controller.provider,
            toolRegistry: command.toolRegistry || controller.toolRegistry,
            memoryManager: command.memoryManager || controller.memoryManager,
            maxRetries: controller.maxRetries,
            maxLoops: controller.maxLoops,
            requestTimeout: controller.requestTimeout,
            idleTimeout: controller.idleTimeout,
            retryDelayMs: controller.retryDelayMs,
            thinking: controller.thinking,
            planMode: controller.planMode,
            planBaseDir: controller.planBaseDir,
            metadata: command.metadata,
        };

        const registeredProfile = this.registerAgent(profile);
        this.eventStream.publish({
            eventId: uuid(),
            timestamp: Date.now(),
            type: 'agent.spawned',
            agentId: childAgentId,
            payload: {
                controllerAgentId: command.controllerAgentId,
                role: command.role,
                parentRunId: command.parentRunId,
            },
        });

        return registeredProfile;
    }

    sendMessage(message: Omit<InterAgentMessage, 'messageId' | 'timestamp'>): InterAgentMessage {
        const from = this.stateStore.getAgentProfile(message.fromAgentId);
        const to = this.stateStore.getAgentProfile(message.toAgentId);
        if (!from) {
            throw new Error(`Unknown fromAgentId: ${message.fromAgentId}`);
        }
        if (!to) {
            throw new Error(`Unknown toAgentId: ${message.toAgentId}`);
        }

        const inferredTopic =
            typeof message.topic === 'string'
                ? message.topic
                : typeof message.payload?.topic === 'string'
                  ? message.payload.topic
                  : undefined;
        const inferredIdempotencyKey =
            typeof message.idempotencyKey === 'string'
                ? message.idempotencyKey
                : typeof message.payload?.idempotencyKey === 'string'
                  ? message.payload.idempotencyKey
                  : undefined;

        const now = Date.now();
        if (inferredIdempotencyKey && this.messageRuntime.dedupWindowMs > 0) {
            const existing = this.stateStore.findMessageByIdempotency(message.toAgentId, inferredIdempotencyKey, now);
            if (existing) {
                this.eventStream.publish({
                    eventId: uuid(),
                    timestamp: now,
                    type: 'agent.message.deduplicated',
                    runId: message.runId,
                    agentId: message.toAgentId,
                    payload: {
                        messageId: existing.messageId,
                        fromAgentId: message.fromAgentId,
                        idempotencyKey: inferredIdempotencyKey,
                    },
                });
                return existing;
            }
        }

        const partitionKey = this.messageRuntime.enforceTopicPartitionOrder
            ? inferredTopic || '__default__'
            : `${inferredTopic || '__default__'}:${uuid().slice(0, 8)}`;

        const messagePolicy = this.policyEngine.canMessage({
            fromAgentId: message.fromAgentId,
            toAgentId: message.toAgentId,
            topic: inferredTopic,
            runId: message.runId,
        });
        if (!messagePolicy.allowed) {
            throw new Error(messagePolicy.reason || 'Message denied by policy engine');
        }

        const enriched: InterAgentMessage = {
            ...message,
            messageId: uuid(),
            timestamp: now,
            topic: inferredTopic,
            partitionKey,
            idempotencyKey: inferredIdempotencyKey,
            maxAttempts: message.maxAttempts ?? this.messageRuntime.maxAttempts,
        };
        this.stateStore.enqueueMessage(message.toAgentId, enriched);
        if (inferredIdempotencyKey && this.messageRuntime.dedupWindowMs > 0) {
            this.stateStore.saveIdempotency(
                message.toAgentId,
                inferredIdempotencyKey,
                enriched.messageId,
                now + this.messageRuntime.dedupWindowMs
            );
        }

        this.eventStream.publish({
            eventId: uuid(),
            timestamp: Date.now(),
            type: 'agent.message',
            runId: message.runId,
            agentId: message.toAgentId,
            payload: {
                fromAgentId: message.fromAgentId,
                messageId: enriched.messageId,
                correlationId: message.correlationId,
                topic: inferredTopic,
                idempotencyKey: inferredIdempotencyKey,
            },
        });

        return enriched;
    }

    receiveMailbox(agentId: string, options?: Pick<ReceiveMessageOptions, 'limit' | 'leaseMs'>): InterAgentMessage[] {
        return this.stateStore.receiveMessages(agentId, {
            limit: options?.limit,
            leaseMs: options?.leaseMs ?? this.messageRuntime.receiveLeaseMs,
        });
    }

    ackMailboxMessage(agentId: string, messageId: string): boolean {
        const acked = this.stateStore.ackMessage(agentId, messageId);
        if (acked) {
            this.eventStream.publish({
                eventId: uuid(),
                timestamp: Date.now(),
                type: 'agent.message.acked',
                agentId,
                payload: { messageId },
            });
        }
        return acked;
    }

    nackMailboxMessage(
        agentId: string,
        messageId: string,
        options?: { error?: string; requeueDelayMs?: number }
    ): NackMessageResult {
        const result = this.stateStore.nackMessage(agentId, messageId, {
            error: options?.error,
            requeueDelayMs: options?.requeueDelayMs ?? this.messageRuntime.nackRequeueDelayMs,
        });

        if (result.message) {
            this.eventStream.publish({
                eventId: uuid(),
                timestamp: Date.now(),
                type: result.deadLettered ? 'agent.message.dead_letter' : 'agent.message.nacked',
                agentId,
                payload: {
                    messageId,
                    error: options?.error,
                    attempt: result.message.attempt,
                    maxAttempts: result.message.maxAttempts,
                },
            });
        }

        return result;
    }

    listDeadLetters(agentId: string, limit?: number): InterAgentMessage[] {
        return this.stateStore.listDeadLetters(agentId, limit);
    }

    requeueDeadLetter(
        agentId: string,
        messageId: string,
        options?: { delayMs?: number; resetAttempts?: boolean }
    ): boolean {
        return this.stateStore.requeueDeadLetter(agentId, messageId, options);
    }

    drainMailbox(agentId: string, limit?: number): InterAgentMessage[] {
        return this.stateStore.drainMessages(agentId, limit);
    }

    async abort(runId: string): Promise<void> {
        return this.runtime.abort(runId);
    }

    async status(runId: string): Promise<import('./types').RunRecord | undefined> {
        return this.runtime.status(runId);
    }

    listRuns(filter?: {
        agentId?: string;
        parentRunId?: string;
        statuses?: import('./types').RuntimeRunStatus[];
    }): import('./types').RunRecord[] {
        return this.stateStore.listRuns(filter);
    }

    stream(
        runId: string,
        listener: (event: import('./types').RuntimeEvent | import('../agent/stream-types').AgentMessage) => void
    ): () => void {
        return this.runtime.stream(runId, listener);
    }

    close(): void {
        if (this.autoDispatchUnsubscribe) {
            this.autoDispatchUnsubscribe();
            this.autoDispatchUnsubscribe = undefined;
        }
        for (const timer of this.autoDispatchTimers.values()) {
            clearTimeout(timer);
        }
        this.autoDispatchTimers.clear();
        this.autoDispatchInFlight.clear();
        this.autoDispatchTriggers.clear();
    }

    buildRunGraph(rootRunId: string): RunGraphNode | undefined {
        const root = this.stateStore.getRun(rootRunId);
        if (!root) return undefined;

        const buildNode = (runId: string): RunGraphNode | undefined => {
            const run = this.stateStore.getRun(runId);
            if (!run) return undefined;
            const children = this.stateStore
                .listRuns({ parentRunId: runId })
                .map((child) => buildNode(child.runId))
                .filter((node): node is RunGraphNode => Boolean(node));
            return {
                runId: run.runId,
                agentId: run.agentId,
                status: run.status,
                children,
            };
        };

        return buildNode(rootRunId);
    }

    private resolveDepth(parentRunId?: string): number {
        if (!parentRunId) return 0;
        const parent = this.stateStore.getRun(parentRunId);
        if (!parent) return 1;
        return parent.depth + 1;
    }

    private isRuntimeOptions(options: OrchestratorKernelOptions): options is OrchestratorKernelRuntimeOptions {
        return 'runtime' in options && 'stateStore' in options && 'policyEngine' in options && 'eventStream' in options;
    }

    private pickRuntimeOverrides(source: AgentRuntimeOverrides): AgentRuntimeOverrides {
        return {
            toolRegistry: source.toolRegistry,
            memoryManager: source.memoryManager,
            sessionId: source.sessionId,
            maxRetries: source.maxRetries,
            maxLoops: source.maxLoops,
            requestTimeout: source.requestTimeout,
            idleTimeout: source.idleTimeout,
            retryDelayMs: source.retryDelayMs,
            thinking: source.thinking,
            planMode: source.planMode,
            planBaseDir: source.planBaseDir,
            metadata: source.metadata,
        };
    }

    private attachMessagingTools(profile: AgentProfile): AgentProfile {
        if (!this.enableMessagingTools) {
            return { ...profile };
        }

        const toolRegistry = this.ensureToolRegistry(profile);
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_send_message', () => {
            return new AgentSendMessageTool(this.stateStore, this);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_receive_messages', () => {
            return new AgentReceiveMessagesTool(this.stateStore, this);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_ack_messages', () => {
            return new AgentAckMessagesTool(this.stateStore, this);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_nack_message', () => {
            return new AgentNackMessageTool(this.stateStore, this);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_list_dead_letters', () => {
            return new AgentListDeadLettersTool(this.stateStore, this);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_requeue_dead_letter', () => {
            return new AgentRequeueDeadLetterTool(this.stateStore, this);
        });

        return {
            ...profile,
            toolRegistry,
        };
    }

    private ensureToolRegistry(profile: AgentProfile): ToolRegistry {
        if (profile.toolRegistry) {
            return profile.toolRegistry;
        }

        if (profile.planMode) {
            return createPlanModeToolRegistry(
                {
                    workingDirectory: process.cwd(),
                    planBaseDir: profile.planBaseDir,
                    truncation: true,
                },
                profile.provider
            );
        }

        return createDefaultToolRegistry(
            {
                workingDirectory: process.cwd(),
                planBaseDir: profile.planBaseDir,
                truncation: true,
            },
            profile.provider
        );
    }

    private ensureMessagingToolRegistered(
        toolRegistry: ToolRegistry,
        name: string,
        createTool: () =>
            | AgentSendMessageTool
            | AgentReceiveMessagesTool
            | AgentAckMessagesTool
            | AgentNackMessageTool
            | AgentListDeadLettersTool
            | AgentRequeueDeadLetterTool
    ): void {
        if (toolRegistry.hasTool(name)) {
            return;
        }
        toolRegistry.register([createTool()]);
    }

    private resolveMessageRuntimeConfig(input?: Partial<MessageRuntimeConfig>): MessageRuntimeConfig {
        return {
            maxAttempts: input?.maxAttempts && input.maxAttempts > 0 ? Math.floor(input.maxAttempts) : 3,
            receiveLeaseMs: input?.receiveLeaseMs && input.receiveLeaseMs > 0 ? input.receiveLeaseMs : 60_000,
            nackRequeueDelayMs:
                input?.nackRequeueDelayMs && input.nackRequeueDelayMs >= 0 ? input.nackRequeueDelayMs : 5_000,
            dedupWindowMs: input?.dedupWindowMs && input.dedupWindowMs > 0 ? input.dedupWindowMs : 60_000,
            enforceTopicPartitionOrder: input?.enforceTopicPartitionOrder !== false,
        };
    }

    private resolveAutoDispatchConfig(input?: AutoDispatchConfig): Required<
        Omit<AutoDispatchConfig, 'inputBuilder'>
    > & {
        inputBuilder?: AutoDispatchConfig['inputBuilder'];
    } {
        return {
            enabled: input?.enabled ?? false,
            debounceMs: input?.debounceMs && input.debounceMs >= 0 ? input.debounceMs : 250,
            receiveLimit: input?.receiveLimit && input.receiveLimit > 0 ? input.receiveLimit : 10,
            leaseMs: input?.leaseMs && input.leaseMs > 0 ? input.leaseMs : this.messageRuntime.receiveLeaseMs,
            skipIfAgentRunning: input?.skipIfAgentRunning !== false,
            inputBuilder: input?.inputBuilder,
        };
    }

    private setupAutoDispatch(): void {
        if (!this.autoDispatch.enabled) {
            return;
        }

        this.autoDispatchUnsubscribe = this.eventStream.subscribe({ types: ['agent.message'] }, (event) => {
            this.onAgentMessageEvent(event);
        });
    }

    private onAgentMessageEvent(event: RuntimeEvent): void {
        const toAgentId = event.agentId;
        if (!toAgentId) {
            return;
        }

        const payload = event.payload || {};
        const trigger: AutoDispatchTrigger = {
            messageId: typeof payload.messageId === 'string' ? payload.messageId : `${event.eventId}:${Date.now()}`,
            toAgentId,
            fromAgentId: typeof payload.fromAgentId === 'string' ? payload.fromAgentId : undefined,
            topic: typeof payload.topic === 'string' ? payload.topic : undefined,
            runId: event.runId,
            correlationId: typeof payload.correlationId === 'string' ? payload.correlationId : undefined,
        };
        this.autoDispatchTriggers.set(toAgentId, trigger);
        this.scheduleAutoDispatch(toAgentId);
    }

    private scheduleAutoDispatch(agentId: string): void {
        const existing = this.autoDispatchTimers.get(agentId);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.autoDispatchTimers.delete(agentId);
            void this.runAutoDispatch(agentId);
        }, this.autoDispatch.debounceMs);
        this.autoDispatchTimers.set(agentId, timer);
    }

    private async runAutoDispatch(agentId: string): Promise<void> {
        if (this.autoDispatchInFlight.has(agentId)) {
            return;
        }

        const trigger = this.autoDispatchTriggers.get(agentId);
        if (!trigger) {
            return;
        }

        if (this.autoDispatch.skipIfAgentRunning) {
            const activeRuns = this.stateStore.listRuns({
                agentId,
                statuses: ['queued', 'running'],
            });
            if (activeRuns.length > 0) {
                this.scheduleAutoDispatch(agentId);
                return;
            }
        }

        this.autoDispatchInFlight.add(agentId);
        try {
            const input =
                this.autoDispatch.inputBuilder?.(trigger) || this.buildDefaultAutoDispatchInput(agentId, trigger);
            await this.execute({
                agentId,
                parentRunId: trigger.runId,
                input,
                metadata: {
                    autoDispatch: true,
                    trigger,
                },
            });
            this.autoDispatchTriggers.delete(agentId);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.eventStream.publish({
                eventId: uuid(),
                timestamp: Date.now(),
                type: 'run.failed',
                agentId,
                runId: trigger.runId,
                payload: {
                    error: `auto-dispatch failed: ${message}`,
                    trigger,
                },
            });
            this.scheduleAutoDispatch(agentId);
        } finally {
            this.autoDispatchInFlight.delete(agentId);
        }
    }

    private buildDefaultAutoDispatchInput(agentId: string, trigger: AutoDispatchTrigger): MessageContent {
        return `系统自动调度：你收到了来自 ${trigger.fromAgentId || 'unknown-agent'} 的新消息（topic=${trigger.topic || '-'}）。
请执行以下步骤：
1. 调用 agent_receive_messages(limit=${this.autoDispatch.receiveLimit}, leaseMs=${this.autoDispatch.leaseMs}) 拉取邮箱消息；
2. 逐条处理：成功则使用 agent_ack_messages 确认，失败则使用 agent_nack_message（附错误原因）；
3. 如发现死信，使用 agent_list_dead_letters 检查并决定是否 agent_requeue_dead_letter；
4. 输出处理结论与后续动作。当前 agent: ${agentId}。`;
    }
}
