#!/usr/bin/env tsx
/**
 * Multi-Agent Runtime Example
 *
 * 演示如何使用 OrchestratorKernel 构建多 Agent 运行时
 */

import {
    OrchestratorKernel,
    AgentConfig,
    RunRecord,
    RuntimeEvent,
    InterAgentMessage,
    InMemoryStateStore,
    DefaultPolicyEngine,
    InMemoryEventStream,
    GatewayRouter,
} from '../agent-v2/orchestration';
import { AgentRuntimeService } from '../agent-v2/orchestration/agent-runtime';
import { OpenAICompatibleProvider } from '../providers';
import { createDefaultToolRegistry } from '../agent-v2/tool';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_TIMEOUT_MS = 60_000;

async function main() {
    const provider = new OpenAICompatibleProvider({
        name: 'glm',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: process.env.GLM_API_KEY || '',
        model: 'glm-4-flash',
        max_tokens: 4096,
        LLMMAX_TOKENS: 128000,
        temperature: 0.7,
    });

    const toolRegistry = createDefaultToolRegistry(
        {
            workingDirectory: process.cwd(),
        },
        provider
    );

    const stateStore = new InMemoryStateStore();
    const eventStream = new InMemoryEventStream();
    const policyEngine = new DefaultPolicyEngine(stateStore);
    const gatewayRouter = new GatewayRouter(stateStore);

    const agentRuntime = new AgentRuntimeService(stateStore, eventStream);

    const kernel = new OrchestratorKernel({
        runtime: agentRuntime,
        stateStore,
        policyEngine,
        eventStream,
        router: gatewayRouter,
        provider,
        systemPrompt: '你是一个专业的编程助手。',
        toolRegistry,
    });

    const controllerAgentId = 'controller-001';

    const controllerProfile: AgentConfig = {
        agentId: controllerAgentId,
        role: 'controller',
        systemPrompt:
            '你是一个项目协调员，负责任务分解和协调。你需要：1. 理解用户需求 2. 分解任务 3. 分配给合适的角色 4. 整合结果',
    };

    kernel.registerAgent({
        ...controllerProfile,
        systemPrompt: controllerProfile.systemPrompt || '你是一个专业的编程助手。',
        provider,
        toolRegistry,
    });

    process.stdout.write(`[spawn] controller agent=${controllerAgentId}\n`);

    const userRequest = '帮我创建一个简单的 TypeScript 项目，包含 package.json 和 tsconfig.json';

    process.stdout.write(`\n[user] ${userRequest}\n`);

    const stepTitle = 'Controller Execution';
    const result = await runWithProgress(kernel, controllerAgentId, userRequest, stepTitle);

    if (result.status === 'completed') {
        process.stdout.write('\n[success] 任务完成!\n');
    } else {
        process.stdout.write(`\n[error] 任务失败：${result.error || '未知错误'}\n`);
    }

    const graph = kernel.buildRunGraph(controllerAgentId);
    if (graph) {
        process.stdout.write('\n[run-graph]\n');
        printRunGraph(graph);
    }

    process.stdout.write('\n[example-end]\n');
}

async function runWithProgress(
    kernel: OrchestratorKernel,
    agentId: string,
    userMessage: string,
    stepTitle: string
): Promise<RunRecord> {
    process.stdout.write(`\n[${stepTitle}] agent=${agentId}\n`);

    const handle = await kernel.execute({
        agentId,
        input: userMessage,
    });

    process.stdout.write(`[${stepTitle}] run=${handle.runId} status=${handle.status}\n`);

    const result = await waitForTerminalStatus(kernel, handle.runId);
    process.stdout.write(`[${stepTitle}] final-status=${result.status}\n`);
    if (result.error) {
        process.stdout.write(`[${stepTitle}] error=${result.error}\n`);
    }
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function waitForRunning(kernel: OrchestratorKernel, runId: string, timeoutMs: number = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const run = await kernel.status(runId);
        if (run?.status === 'running') return;
        if (run && TERMINAL_STATUSES.has(run.status)) return;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`waitForRunning timeout: ${runId}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function watchRunWithStream(
    kernel: OrchestratorKernel,
    runId: string,
    stepTitle: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ result: RunRecord; events: Array<RuntimeEvent | InterAgentMessage> }> {
    process.stdout.write(`\n[${stepTitle}] run=${runId}\n`);
    const events: Array<RuntimeEvent | InterAgentMessage> = [];
    const unsubscribe = kernel.stream(runId, (event) => {
        if ((event as RuntimeEvent).eventId !== undefined) {
            events.push(event as RuntimeEvent);
            printStream(runId, event as RuntimeEvent);
        }
    });

    try {
        const result = await waitForTerminalStatus(kernel, runId, timeoutMs);
        process.stdout.write(`[${stepTitle}] status=${result.status}\n`);
        if (result.error) {
            process.stdout.write(`[${stepTitle}] error=${result.error}\n`);
        }
        return { result, events };
    } finally {
        unsubscribe();
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function hasInLoopInjectedAck(events: Array<RuntimeEvent | InterAgentMessage>): boolean {
    return events.some((event) => {
        if ((event as RuntimeEvent).eventId === undefined) return false;
        const runtimeEvent = event as RuntimeEvent;
        if (runtimeEvent.type !== 'agent.message.acked') return false;
        if (!runtimeEvent.payload || typeof runtimeEvent.payload !== 'object') return false;
        return (runtimeEvent.payload as { mode?: string }).mode === 'in-loop-injection';
    });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function printDeadLetters(kernel: OrchestratorKernel, agentId: string): void {
    const deadLetters = kernel.listDeadLetters(agentId, 20);
    process.stdout.write(`[dead-letter] agent=${agentId} count=${deadLetters.length}\n`);
    for (const message of deadLetters) {
        process.stdout.write(
            `[dead-letter] id=${message.messageId} topic=${message.topic || '-'} attempts=${message.attempt}/${message.maxAttempts} error=${message.lastError || '-'}\n`
        );
    }
}

function printRunGraph(node: ReturnType<OrchestratorKernel['buildRunGraph']>, indent: string = ''): void {
    if (!node) return;
    process.stdout.write(`${indent}- run=${node.runId} agent=${node.agentId} status=${node.status}\n`);
    for (const child of node.children) {
        printRunGraph(child, `${indent}  `);
    }
}

function printStream(runId: string, event: RuntimeEvent): void {
    if ((event as RuntimeEvent).eventId !== undefined) {
        const runtimeEvent = event as RuntimeEvent;
        if (runtimeEvent.type === 'run.started') {
            process.stdout.write(`[stream] ${runId} run.started\n`);
        } else if (runtimeEvent.type === 'run.completed') {
            process.stdout.write(`[stream] ${runId} run.completed\n`);
        } else if (runtimeEvent.type === 'run.failed') {
            process.stdout.write(`[stream] ${runId} run.failed error=${runtimeEvent.payload?.error}\n`);
        } else if (runtimeEvent.type === 'agent.spawned') {
            process.stdout.write(
                `[stream] ${runId} agent.spawned agent=${runtimeEvent.agentId} role=${runtimeEvent.payload?.role}\n`
            );
        } else if (runtimeEvent.type === 'agent.message.acked') {
            process.stdout.write(
                `[stream] ${runId} agent.message.acked topic=${(runtimeEvent.payload as { topic?: string })?.topic || '-'}\n`
            );
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function printFlowGuide(): void {
    process.stdout.write('\n[flow]\n');
    process.stdout.write('1) 用户入口只执行一次 controller 任务\n');
    process.stdout.write('2) controller 之后由 kernel 动态 spawn coder/reviewer\n');
    process.stdout.write('3) controller 负责整合结果并返回给用户\n');
    process.stdout.write('4) kernel 负责路由、隔离、重试、降级\n');
}

async function waitForTerminalStatus(
    kernel: OrchestratorKernel,
    runId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<RunRecord> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const run = await kernel.status(runId);
        if (run && TERMINAL_STATUSES.has(run.status)) {
            return run;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const finalRun = await kernel.status(runId);
    return (
        finalRun || {
            runId,
            agentId: 'unknown',
            depth: 0,
            input: '',
            status: 'failed',
            error: 'waitForTerminalStatus timeout',
            createdAt: Date.now(),
        }
    );
}

main().catch((error) => {
    process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
