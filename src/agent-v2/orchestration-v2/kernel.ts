import { v4 as uuid } from 'uuid';
import type { MessageContent } from '../../providers';
import { createDefaultToolRegistry, createPlanModeToolRegistry, ToolRegistry } from '../tool';
import {
    AgentAckMessagesToolV2,
    AgentListDeadLettersToolV2,
    AgentNackMessageToolV2,
    AgentReceiveMessagesToolV2,
    AgentSendMessageToolV2,
    type MessagingPortV2,
} from './messaging-tools';
import { LocalAgentRuntimeV2 } from './runtime';
import { parsePlan, planSchemaText } from './plan-schema';
import type {
    AgentProfileV2,
    AgentRuntimeV2,
    AgentTemplateV2,
    GoalExecutionResultV2,
    GoalPlanV2,
    InterAgentMessageV2,
    NackMessageOptionsV2,
    NackMessageResultV2,
    OrchestratorV2Options,
    PlanTaskV2,
    ReceiveMessageOptionsV2,
    RunRecordV2,
    RuntimeEventV2,
    TaskExecutionResultV2,
} from './types';

interface SchedulerConfig {
    maxConcurrentTasks: number;
    maxTaskRetries: number;
    taskTimeoutMs: number;
    failFast: boolean;
}

interface PlannerConfig {
    maxRepairAttempts: number;
    timeoutMs: number;
}

interface EventSubscriber {
    id: string;
    listener: (event: RuntimeEventV2) => void;
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
    maxRepairAttempts: 2,
    timeoutMs: 120_000,
};

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
    maxConcurrentTasks: 3,
    maxTaskRetries: 1,
    taskTimeoutMs: 8 * 60_000,
    failFast: false,
};

const DEFAULT_DYNAMIC_AGENT_PROMPT = [
    '你是一个动态创建的任务执行专家。',
    '职责：根据任务描述交付可验证结果，并显式说明风险与假设。',
    '工具：优先使用本地工程工具完成实现；需要跨 agent 协作时可用以下工具：',
    '- agent_send_message',
    '- agent_receive_messages',
    '- agent_ack_messages',
    '- agent_nack_message',
    '- agent_list_dead_letters',
    '输出要求：给出结果、验证方式、风险与假设，禁止空泛描述。',
].join('\n');

export class OrchestratorKernelV2 {
    private readonly runtime: AgentRuntimeV2;
    private readonly provider: AgentProfileV2['provider'];
    private readonly defaultMemoryManager?: AgentProfileV2['memoryManager'];
    private readonly controllerAgentId: string;
    private readonly plannerConfig: PlannerConfig;
    private readonly schedulerConfig: SchedulerConfig;
    private readonly roleAgentMap = new Map<string, string>();
    private readonly templates = new Map<string, AgentTemplateV2>();
    private readonly subscribers = new Map<string, EventSubscriber>();
    private readonly mailbox = new Map<string, InterAgentMessageV2[]>();
    private readonly inFlight = new Map<string, Map<string, InterAgentMessageV2>>();
    private readonly deadLetters = new Map<string, InterAgentMessageV2[]>();
    private readonly idempotency = new Map<string, Map<string, InterAgentMessageV2>>();
    private readonly messageDefaults = {
        maxAttempts: 3,
        leaseMs: 15_000,
    };
    private dynamicAgentCounter = 0;

    constructor(options: OrchestratorV2Options) {
        this.runtime = options.runtime || new LocalAgentRuntimeV2();
        this.provider = options.provider;
        this.defaultMemoryManager = options.memoryManager;
        this.controllerAgentId = options.controller.agentId?.trim() || 'controller-v2';
        this.plannerConfig = {
            ...DEFAULT_PLANNER_CONFIG,
            ...(options.planner || {}),
        };
        this.schedulerConfig = {
            ...DEFAULT_SCHEDULER_CONFIG,
            ...(options.scheduler || {}),
        };

        const controllerProfile: AgentProfileV2 = {
            agentId: this.controllerAgentId,
            role: 'controller',
            systemPrompt: options.controller.systemPrompt,
            provider: this.provider,
            memoryManager: this.defaultMemoryManager,
        };
        this.runtime.upsertAgent(this.prepareProfileWithMessagingTools(controllerProfile));
        this.roleAgentMap.set(this.normalizeRole('controller'), controllerProfile.agentId);

        for (const template of options.templates || []) {
            this.registerTemplate(template);
        }
    }

    registerTemplate(template: AgentTemplateV2): AgentProfileV2 {
        const normalizedRole = this.normalizeRole(template.role);
        const agentId = this.templateAgentId(template.role);
        const profile: AgentProfileV2 = {
            agentId,
            role: template.role,
            systemPrompt: template.systemPrompt,
            provider: template.provider || this.provider,
            toolRegistry: template.toolRegistry,
            memoryManager: template.memoryManager || this.defaultMemoryManager,
            maxRetries: template.maxRetries,
            maxLoops: template.maxLoops,
            requestTimeout: template.requestTimeout,
            idleTimeout: template.idleTimeout,
            retryDelayMs: template.retryDelayMs,
            thinking: template.thinking,
            metadata: template.metadata,
        };

        const prepared = this.prepareProfileWithMessagingTools(profile);
        this.runtime.upsertAgent(prepared);
        this.roleAgentMap.set(normalizedRole, agentId);
        this.templates.set(normalizedRole, template);
        return prepared;
    }

    subscribe(listener: (event: RuntimeEventV2) => void): () => void {
        const id = uuid();
        this.subscribers.set(id, { id, listener });
        return () => {
            this.subscribers.delete(id);
        };
    }

    sendMessage(message: Omit<InterAgentMessageV2, 'messageId' | 'timestamp'>): InterAgentMessageV2 {
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

        const queued: InterAgentMessageV2 = {
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
            const index = this.idempotency.get(message.toAgentId) || new Map<string, InterAgentMessageV2>();
            index.set(idempotencyKey, queued);
            this.idempotency.set(message.toAgentId, index);
        }

        this.emit({
            eventId: uuid(),
            timestamp: now,
            type: 'agent.message',
            runId: message.runId,
            agentId: message.toAgentId,
            payload: {
                messageId: queued.messageId,
                fromAgentId: message.fromAgentId,
                topic: message.topic,
                correlationId: message.correlationId,
                idempotencyKey: idempotencyKey || undefined,
            },
        });

        return { ...queued };
    }

    receiveMessages(agentId: string, options?: ReceiveMessageOptionsV2): InterAgentMessageV2[] {
        const now = options?.now ?? Date.now();
        const limit = options?.limit && options.limit > 0 ? options.limit : 10;
        const leaseMs = options?.leaseMs && options.leaseMs > 0 ? options.leaseMs : this.messageDefaults.leaseMs;

        this.requeueExpiredInFlight(agentId, now);

        const queue = this.mailbox.get(agentId) || [];
        if (queue.length === 0) return [];

        const nextQueue: InterAgentMessageV2[] = [];
        const delivered: InterAgentMessageV2[] = [];
        for (const message of queue) {
            if (delivered.length >= limit || (message.visibleAt ?? 0) > now) {
                nextQueue.push(message);
                continue;
            }

            const attempt = (message.attempt ?? 0) + 1;
            const inFlight: InterAgentMessageV2 = {
                ...message,
                attempt,
                status: 'in_flight',
                visibleAt: now,
                leaseUntil: now + leaseMs,
            };
            const inflightMap = this.inFlight.get(agentId) || new Map<string, InterAgentMessageV2>();
            inflightMap.set(inFlight.messageId, inFlight);
            this.inFlight.set(agentId, inflightMap);
            delivered.push({ ...inFlight });
        }

        this.mailbox.set(agentId, nextQueue);
        return delivered;
    }

    ackMessage(agentId: string, messageId: string): boolean {
        const inflightMap = this.inFlight.get(agentId);
        if (!inflightMap) return false;
        const message = inflightMap.get(messageId);
        if (!message) return false;
        inflightMap.delete(messageId);
        this.emit({
            eventId: uuid(),
            timestamp: Date.now(),
            type: 'agent.message.acked',
            runId: message.runId,
            agentId,
            payload: {
                messageId,
                topic: message.topic,
            },
        });
        return true;
    }

    nackMessage(agentId: string, messageId: string, options?: NackMessageOptionsV2): NackMessageResultV2 {
        const inflightMap = this.inFlight.get(agentId);
        if (!inflightMap) {
            return { requeued: false, deadLettered: false };
        }
        const message = inflightMap.get(messageId);
        if (!message) {
            return { requeued: false, deadLettered: false };
        }
        inflightMap.delete(messageId);

        const now = Date.now();
        const maxAttempts = message.maxAttempts ?? this.messageDefaults.maxAttempts;
        const attempt = message.attempt ?? 0;
        const error = options?.error;
        if (attempt >= maxAttempts) {
            const dead: InterAgentMessageV2 = {
                ...message,
                status: 'dead_letter',
                leaseUntil: undefined,
                visibleAt: now,
                lastError: error,
            };
            const list = this.deadLetters.get(agentId) || [];
            list.push(dead);
            this.deadLetters.set(agentId, list);
            this.emit({
                eventId: uuid(),
                timestamp: now,
                type: 'agent.message.dead_letter',
                runId: message.runId,
                agentId,
                payload: {
                    messageId,
                    topic: message.topic,
                    error: error || 'max attempts exceeded',
                    attempt,
                    maxAttempts,
                },
            });
            return {
                requeued: false,
                deadLettered: true,
                message: { ...dead },
            };
        }

        const requeueDelay = options?.requeueDelayMs && options.requeueDelayMs > 0 ? options.requeueDelayMs : 0;
        const queued: InterAgentMessageV2 = {
            ...message,
            status: 'queued',
            visibleAt: now + requeueDelay,
            leaseUntil: undefined,
            lastError: error,
        };
        const queue = this.mailbox.get(agentId) || [];
        queue.push(queued);
        this.mailbox.set(agentId, queue);
        this.emit({
            eventId: uuid(),
            timestamp: now,
            type: 'agent.message.nacked',
            runId: message.runId,
            agentId,
            payload: {
                messageId,
                topic: message.topic,
                error: error || undefined,
                attempt,
                maxAttempts,
            },
        });

        return {
            requeued: true,
            deadLettered: false,
            message: { ...queued },
        };
    }

    listDeadLetters(agentId: string, limit: number = 20): InterAgentMessageV2[] {
        const list = this.deadLetters.get(agentId) || [];
        return list.slice(0, limit).map((item) => ({ ...item }));
    }

    async execute(goal: MessageContent): Promise<GoalExecutionResultV2> {
        const goalText = this.messageContentToText(goal).trim();
        if (!goalText) {
            throw new Error('Goal input cannot be empty');
        }

        const goalRunId = uuid();
        const startedAt = Date.now();
        this.emit({
            eventId: uuid(),
            timestamp: startedAt,
            type: 'kernel.goal.started',
            runId: goalRunId,
            agentId: this.controllerAgentId,
            payload: { goal: goalText },
        });

        let plannerRunId = '';
        try {
            const planner = await this.planGoal(goalText, goalRunId);
            plannerRunId = planner.runId;
            const plan = planner.plan;

            this.emit({
                eventId: uuid(),
                timestamp: Date.now(),
                type: 'kernel.goal.planned',
                runId: goalRunId,
                agentId: this.controllerAgentId,
                payload: {
                    plannerRunId,
                    taskCount: plan.tasks.length,
                    summary: plan.summary,
                },
            });

            const tasks = await this.executePlanTasks(goalRunId, goalText, plan);
            const hasFailure = tasks.some((task) => task.status === 'failed');
            const status = hasFailure ? 'failed' : 'completed';
            const finalSummary = await this.summarizeGoal(goalText, plan, tasks);

            const finishedAt = Date.now();
            const result: GoalExecutionResultV2 = {
                goalRunId,
                plannerRunId,
                goal: goalText,
                plan,
                tasks,
                status,
                finalSummary,
                startedAt,
                finishedAt,
                error: hasFailure ? 'One or more tasks failed' : undefined,
            };

            this.emit({
                eventId: uuid(),
                timestamp: finishedAt,
                type: status === 'completed' ? 'kernel.goal.completed' : 'kernel.goal.failed',
                runId: goalRunId,
                agentId: this.controllerAgentId,
                payload: {
                    plannerRunId,
                    taskCount: tasks.length,
                    failedTasks: tasks.filter((task) => task.status === 'failed').map((task) => task.taskId),
                },
            });

            return result;
        } catch (error) {
            const finishedAt = Date.now();
            const message = error instanceof Error ? error.message : String(error);
            this.emit({
                eventId: uuid(),
                timestamp: finishedAt,
                type: 'kernel.goal.failed',
                runId: goalRunId,
                agentId: this.controllerAgentId,
                payload: {
                    plannerRunId,
                    error: message,
                },
            });

            return {
                goalRunId,
                plannerRunId,
                goal: goalText,
                plan: {
                    summary: '',
                    tasks: [],
                },
                tasks: [],
                status: 'failed',
                error: message,
                startedAt,
                finishedAt,
            };
        }
    }

    private async planGoal(goal: string, goalRunId: string): Promise<{ runId: string; plan: GoalPlanV2 }> {
        const plannerInput = this.buildPlannerPrompt(goal);
        const plannerHandle = await this.runtime.execute({
            agentId: this.controllerAgentId,
            parentRunId: goalRunId,
            input: plannerInput,
            timeoutMs: this.plannerConfig.timeoutMs,
            metadata: {
                mode: 'planner',
                goalRunId,
            },
        });

        const plannerRun = await this.waitForTerminal(plannerHandle.runId, this.plannerConfig.timeoutMs);
        if (plannerRun.status !== 'completed') {
            throw new Error(`Planner failed: ${plannerRun.error || plannerRun.status}`);
        }

        const plannerOutput = plannerRun.output?.trim();
        if (!plannerOutput) {
            throw new Error('Planner returned empty output');
        }

        let parseError = '';
        try {
            return {
                runId: plannerHandle.runId,
                plan: parsePlan(plannerOutput),
            };
        } catch (error) {
            parseError = error instanceof Error ? error.message : String(error);
        }

        let raw = plannerOutput;
        for (let attempt = 1; attempt <= this.plannerConfig.maxRepairAttempts; attempt += 1) {
            const repaired = await this.repairPlan(goalRunId, goal, raw, parseError, attempt);
            raw = repaired.raw;
            try {
                return {
                    runId: repaired.runId,
                    plan: parsePlan(raw),
                };
            } catch (error) {
                parseError = error instanceof Error ? error.message : String(error);
            }
        }

        throw new Error(`Planner output invalid after repair attempts: ${parseError}`);
    }

    private async repairPlan(
        goalRunId: string,
        goal: string,
        rawPlan: string,
        parseError: string,
        attempt: number
    ): Promise<{ runId: string; raw: string }> {
        const handle = await this.runtime.execute({
            agentId: this.controllerAgentId,
            parentRunId: goalRunId,
            input: this.buildPlanRepairPrompt(goal, rawPlan, parseError, attempt),
            timeoutMs: this.plannerConfig.timeoutMs,
            metadata: {
                mode: 'planner-repair',
                attempt,
            },
        });
        const run = await this.waitForTerminal(handle.runId, this.plannerConfig.timeoutMs);
        if (run.status !== 'completed') {
            throw new Error(`Planner repair failed: ${run.error || run.status}`);
        }
        return {
            runId: handle.runId,
            raw: run.output || '',
        };
    }

    private async executePlanTasks(
        goalRunId: string,
        goal: string,
        plan: GoalPlanV2
    ): Promise<TaskExecutionResultV2[]> {
        const state = new Map<string, 'pending' | 'running' | 'completed' | 'failed'>();
        for (const task of plan.tasks) {
            state.set(task.id, 'pending');
        }

        const outputs = new Map<string, string>();
        const results = new Map<string, TaskExecutionResultV2>();
        const inFlight = new Map<string, Promise<{ taskId: string; result: TaskExecutionResultV2 }>>();

        const launchTask = (task: PlanTaskV2): void => {
            state.set(task.id, 'running');
            const run = this.executeTaskWithRetries(goalRunId, goal, plan, task, outputs).then((result) => ({
                taskId: task.id,
                result,
            }));
            inFlight.set(task.id, run);
        };

        while (results.size < plan.tasks.length) {
            if (this.schedulerConfig.failFast) {
                const failed = Array.from(results.values()).find((result) => result.status === 'failed');
                if (failed) {
                    break;
                }
            }

            const ready = plan.tasks.filter((task) => {
                if (state.get(task.id) !== 'pending') return false;
                return task.dependsOn.every((dep) => state.get(dep) === 'completed');
            });

            while (ready.length > 0 && inFlight.size < Math.max(1, this.schedulerConfig.maxConcurrentTasks)) {
                const next = ready.shift();
                if (!next) break;
                launchTask(next);
            }

            if (inFlight.size === 0) {
                const pending = plan.tasks.filter((task) => state.get(task.id) === 'pending').map((task) => task.id);
                if (pending.length > 0) {
                    throw new Error(`Task scheduling deadlock; unresolved tasks: ${pending.join(', ')}`);
                }
                break;
            }

            const settled = await Promise.race(inFlight.values());
            inFlight.delete(settled.taskId);
            results.set(settled.taskId, settled.result);
            state.set(settled.taskId, settled.result.status === 'completed' ? 'completed' : 'failed');
            if (settled.result.status === 'completed' && settled.result.output) {
                outputs.set(settled.taskId, settled.result.output);
            }
        }

        for (const [, taskRun] of inFlight) {
            const settled = await taskRun;
            results.set(settled.taskId, settled.result);
            state.set(settled.taskId, settled.result.status === 'completed' ? 'completed' : 'failed');
            if (settled.result.status === 'completed' && settled.result.output) {
                outputs.set(settled.taskId, settled.result.output);
            }
        }

        return plan.tasks
            .map((task) => results.get(task.id))
            .filter((item): item is TaskExecutionResultV2 => Boolean(item));
    }

    private async executeTaskWithRetries(
        goalRunId: string,
        goal: string,
        plan: GoalPlanV2,
        task: PlanTaskV2,
        outputs: Map<string, string>
    ): Promise<TaskExecutionResultV2> {
        const agentId = await this.resolveAgentForRole(goalRunId, task.role);
        const maxAttempts = Math.max(1, this.schedulerConfig.maxTaskRetries + 1);

        let lastError = 'unknown error';
        let lastRunId = '';
        const taskStartedAt = Date.now();

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            this.emit({
                eventId: uuid(),
                timestamp: Date.now(),
                type: 'kernel.task.started',
                runId: goalRunId,
                agentId,
                payload: {
                    taskId: task.id,
                    role: task.role,
                    attempt,
                    maxAttempts,
                },
            });

            const handle = await this.runtime.execute({
                agentId,
                parentRunId: goalRunId,
                input: this.buildTaskPrompt(goal, plan, task, outputs),
                timeoutMs: this.schedulerConfig.taskTimeoutMs,
                metadata: {
                    mode: 'task',
                    taskId: task.id,
                    role: task.role,
                    attempt,
                },
            });
            lastRunId = handle.runId;

            const run = await this.waitForTerminal(handle.runId, this.schedulerConfig.taskTimeoutMs);
            if (run.status === 'completed') {
                const finishedAt = Date.now();
                const result: TaskExecutionResultV2 = {
                    taskId: task.id,
                    role: task.role,
                    agentId,
                    status: 'completed',
                    runId: handle.runId,
                    output: run.output,
                    attempts: attempt,
                    startedAt: taskStartedAt,
                    finishedAt,
                };

                this.emit({
                    eventId: uuid(),
                    timestamp: finishedAt,
                    type: 'kernel.task.completed',
                    runId: goalRunId,
                    agentId,
                    payload: {
                        taskId: task.id,
                        attempt,
                    },
                });
                return result;
            }

            lastError = run.error || run.status;
        }

        const failedAt = Date.now();
        const failed: TaskExecutionResultV2 = {
            taskId: task.id,
            role: task.role,
            agentId,
            status: 'failed',
            runId: lastRunId,
            error: lastError,
            attempts: maxAttempts,
            startedAt: taskStartedAt,
            finishedAt: failedAt,
        };

        this.emit({
            eventId: uuid(),
            timestamp: failedAt,
            type: 'kernel.task.failed',
            runId: goalRunId,
            agentId,
            payload: {
                taskId: task.id,
                error: lastError,
                attempts: maxAttempts,
            },
        });

        return failed;
    }

    private async resolveAgentForRole(goalRunId: string, role: string): Promise<string> {
        const normalized = this.normalizeRole(role);
        const existing = this.roleAgentMap.get(normalized);
        if (existing) {
            return existing;
        }

        const dynamicAgentId = `dynamic-${this.safeRoleToken(role)}-${++this.dynamicAgentCounter}`;
        const generatedPrompt = await this.generateDynamicAgentPrompt(goalRunId, role).catch(
            () => DEFAULT_DYNAMIC_AGENT_PROMPT
        );

        const profile: AgentProfileV2 = {
            agentId: dynamicAgentId,
            role,
            systemPrompt: generatedPrompt,
            provider: this.provider,
            memoryManager: this.defaultMemoryManager,
            metadata: {
                dynamic: true,
                sourceRole: role,
            },
        };

        this.runtime.upsertAgent(this.prepareProfileWithMessagingTools(profile));
        this.roleAgentMap.set(normalized, dynamicAgentId);
        return dynamicAgentId;
    }

    private async generateDynamicAgentPrompt(goalRunId: string, role: string): Promise<string> {
        const handle = await this.runtime.execute({
            agentId: this.controllerAgentId,
            parentRunId: goalRunId,
            input:
                `请为角色「${role}」生成一段高质量系统提示词，输出纯文本（不要 markdown）。\n` +
                `必须包含以下内容：\n` +
                `1. 该角色的职责边界与交付目标；\n` +
                `2. 工具使用策略：本地工程工具优先，跨 agent 协作时可用 agent_send_message/agent_receive_messages/agent_ack_messages/agent_nack_message/agent_list_dead_letters；\n` +
                `3. 输出规范：结果 + 验证方式 + 风险与假设；\n` +
                `4. 约束：不伪造事实，不输出无法验证的结论。`,
            timeoutMs: this.plannerConfig.timeoutMs,
            metadata: {
                mode: 'agent-prompt-generation',
                role,
            },
        });

        const run = await this.waitForTerminal(handle.runId, this.plannerConfig.timeoutMs);
        if (run.status !== 'completed' || !run.output?.trim()) {
            throw new Error(run.error || 'Failed to generate dynamic agent prompt');
        }

        return run.output.trim();
    }

    private async summarizeGoal(
        goal: string,
        plan: GoalPlanV2,
        tasks: TaskExecutionResultV2[]
    ): Promise<string | undefined> {
        const successful = tasks
            .filter((task) => task.status === 'completed')
            .map((task) => `- ${task.taskId}(${task.role}): ${task.output || '(no output)'}`)
            .join('\n');
        const failed = tasks
            .filter((task) => task.status === 'failed')
            .map((task) => `- ${task.taskId}(${task.role}): ${task.error || '(unknown)'}`)
            .join('\n');

        const handle = await this.runtime.execute({
            agentId: this.controllerAgentId,
            input:
                `目标：${goal}\n` +
                `计划摘要：${plan.summary}\n` +
                `已完成任务：\n${successful || '(none)'}\n` +
                `失败任务：\n${failed || '(none)'}\n\n` +
                '请输出最终总结：1) 交付了什么 2) 还缺什么 3) 下一步建议（最多3条）。',
            timeoutMs: this.plannerConfig.timeoutMs,
            metadata: {
                mode: 'goal-summary',
            },
        });

        const run = await this.waitForTerminal(handle.runId, this.plannerConfig.timeoutMs);
        if (run.status !== 'completed') {
            return undefined;
        }
        return run.output?.trim() || undefined;
    }

    private async waitForTerminal(runId: string, timeoutMs: number): Promise<RunRecordV2> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const run = await this.runtime.status(runId);
            if (!run) {
                await this.sleep(100);
                continue;
            }
            if (['completed', 'failed', 'aborted', 'cancelled'].includes(run.status)) {
                return run;
            }
            await this.sleep(150);
        }

        await this.runtime.abort(runId).catch(() => undefined);
        throw new Error(`Run timeout waiting terminal status: ${runId}`);
    }

    private buildPlannerPrompt(goal: string): string {
        return (
            `你是多智能体编排主脑。\n` +
            `目标：${goal}\n\n` +
            `请把目标分解为可执行任务 DAG，并输出严格 JSON（不要解释文字）。\n` +
            `要求：\n` +
            `1. tasks 至少 1 个，最多 8 个；\n` +
            `2. dependsOn 只引用已存在任务 id；\n` +
            `3. role 要具体（如 frontend-coder/backend-coder/reviewer）；\n` +
            `4. acceptanceCriteria 可验证。\n\n` +
            `JSON schema: \n${planSchemaText()}`
        );
    }

    private buildPlanRepairPrompt(goal: string, rawPlan: string, parseError: string, attempt: number): string {
        return (
            `目标：${goal}\n` +
            `你上次的计划 JSON 无法解析。\n` +
            `错误：${parseError}\n` +
            `修复轮次：${attempt}\n\n` +
            `请输出“仅 JSON”，严格符合下方 schema。不要解释。\n` +
            `schema:\n${planSchemaText()}\n\n` +
            `原始输出：\n${rawPlan}`
        );
    }

    private buildTaskPrompt(goal: string, plan: GoalPlanV2, task: PlanTaskV2, outputs: Map<string, string>): string {
        const dependencyOutputs = task.dependsOn
            .map((dep) => `- ${dep}: ${outputs.get(dep) || '(dependency output missing)'}`)
            .join('\n');

        return (
            `全局目标：${goal}\n` +
            `计划摘要：${plan.summary}\n` +
            `当前任务：${task.id} / ${task.title}\n` +
            `角色：${task.role}\n` +
            `任务描述：${task.description}\n` +
            `依赖任务：${task.dependsOn.join(', ') || 'none'}\n` +
            `依赖输出：\n${dependencyOutputs || '(none)'}\n` +
            `验收标准：\n${task.acceptanceCriteria.map((item) => `- ${item}`).join('\n') || '- 完成任务目标'}\n\n` +
            `请输出：\n` +
            `1) 结果内容；\n` +
            `2) 如何验证；\n` +
            `3) 风险与假设。`
        );
    }

    private requeueExpiredInFlight(agentId: string, now: number): void {
        const inflightMap = this.inFlight.get(agentId);
        if (!inflightMap || inflightMap.size === 0) return;
        const queue = this.mailbox.get(agentId) || [];
        for (const message of inflightMap.values()) {
            if (!message.leaseUntil || message.leaseUntil > now) continue;
            inflightMap.delete(message.messageId);
            const queued: InterAgentMessageV2 = {
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

    private prepareProfileWithMessagingTools(profile: AgentProfileV2): AgentProfileV2 {
        const toolRegistry = profile.toolRegistry || this.createToolRegistry(profile);
        const port: MessagingPortV2 = {
            sendMessage: (message) => this.sendMessage(message),
            receiveMessages: (agentId, options) => this.receiveMessages(agentId, options),
            ackMessage: (agentId, messageId) => this.ackMessage(agentId, messageId),
            nackMessage: (agentId, messageId, options) => this.nackMessage(agentId, messageId, options),
            listDeadLetters: (agentId, limit) => this.listDeadLetters(agentId, limit),
        };

        this.ensureMessagingToolRegistered(toolRegistry, 'agent_send_message', () => {
            return new AgentSendMessageToolV2(this.runtime, port);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_receive_messages', () => {
            return new AgentReceiveMessagesToolV2(this.runtime, port);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_ack_messages', () => {
            return new AgentAckMessagesToolV2(this.runtime, port);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_nack_message', () => {
            return new AgentNackMessageToolV2(this.runtime, port);
        });
        this.ensureMessagingToolRegistered(toolRegistry, 'agent_list_dead_letters', () => {
            return new AgentListDeadLettersToolV2(this.runtime, port);
        });

        return {
            ...profile,
            toolRegistry,
        };
    }

    private createToolRegistry(profile: AgentProfileV2): ToolRegistry {
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
            | AgentSendMessageToolV2
            | AgentReceiveMessagesToolV2
            | AgentAckMessagesToolV2
            | AgentNackMessageToolV2
            | AgentListDeadLettersToolV2
    ): void {
        if (toolRegistry.hasTool(name)) {
            return;
        }
        toolRegistry.register([createTool()]);
    }

    private templateAgentId(role: string): string {
        return `template-${this.safeRoleToken(role)}`;
    }

    private normalizeRole(role: string): string {
        return role.trim().toLowerCase();
    }

    private safeRoleToken(role: string): string {
        const normalized = role
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        if (normalized.length > 0) return normalized;

        let hash = 0;
        for (let i = 0; i < role.length; i += 1) {
            hash = (hash * 31 + role.charCodeAt(i)) >>> 0;
        }
        return `role-${hash}`;
    }

    private messageContentToText(content: MessageContent): string {
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
                return typed.type === 'text' && typeof typed.text === 'string' ? typed.text : '';
            })
            .filter(Boolean)
            .join('\n');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private emit(event: RuntimeEventV2): void {
        for (const subscriber of this.subscribers.values()) {
            subscriber.listener(event);
        }
    }
}
