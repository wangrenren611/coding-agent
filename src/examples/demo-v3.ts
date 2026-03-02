#!/usr/bin/env tsx

import dotenv from 'dotenv';
import fs from 'fs';
import { platform } from 'os';
import {
    createMemoryManager,
    LocalAgentRuntimeV2,
    OrchestratorKernelV3,
    type RunRecordV3,
    type RuntimeEventV3,
    type RuntimeRunStatusV3,
} from '../agent-v2';
import { operatorPrompt } from '../agent-v2/prompts/operator';
import { ProviderRegistry, type ModelId } from '../providers';

dotenv.config({
    path: './.env.development',
});

const TERMINAL_STATUSES = new Set<RuntimeRunStatusV3>(['completed', 'failed', 'aborted', 'cancelled']);

function resolveModelId(): ModelId {
    const candidate = (process.env.ORCHESTRATION_V3_MODEL || 'qwen3.5-plus').trim();
    const supported = new Set(ProviderRegistry.getModelIds());
    if (!supported.has(candidate as ModelId)) {
        throw new Error(`Unknown ORCHESTRATION_V3_MODEL: ${candidate}`);
    }
    return candidate as ModelId;
}

function resolveMemoryPath(): string {
    if (process.env.ORCHESTRATION_V3_MEMORY_PATH?.trim()) {
        return process.env.ORCHESTRATION_V3_MEMORY_PATH.trim();
    }
    return platform() === 'win32'
        ? 'D:/work/coding-agent-data/orchestration-v3-memory'
        : '/Users/wrr/work/coding-agent-data/orchestration-v3-memory';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function buildControllerPrompt(directory: string): string {
    return `${operatorPrompt({ directory, language: 'Chinese' })}

[角色]
你是 controller（主控智能体），负责任务分解、监督、容错、总结。

[你可调用的关键工具]
- agent_dispatch_task: 创建子 agent run（controller 主动分发）
- agent_get_status: 查询子任务运行状态
- agent_wait_for_messages: 等待消息窗口，可超时返回子任务进度
- agent_receive_messages / agent_ack_messages / agent_nack_message: 消息收取与确认
- agent_send_message: 向其他 agent 发指令

[执行协议]
1. 优先结构化输出：任务拆分、当前状态、阻塞项、下一步。
2. 若进入监督阶段，必须循环等待消息，不要立即结束。
3. wait 超时后必须执行状态巡检并给出简短调度结论。`;
}

function buildCoderPrompt(directory: string): string {
    return `${operatorPrompt({ directory, language: 'Chinese' })}

[角色]
你是 coding-agent，负责商城系统代码实现。

[执行要求]
1. 收到任务后先输出实现计划；
2. 完成后向 controller 发送 implementation-completed；
3. 输出要包含模块、接口、测试要点。`;
}

function buildReviewerPrompt(directory: string): string {
    return `${operatorPrompt({ directory, language: 'Chinese' })}

[角色]
你是 review-agent，负责方案审查与风险识别。

[执行要求]
1. 收到任务后给出评审结论；
2. 发现高风险时向 coding-agent 发送 bug-report；
3. 最终向 controller 发送 review-completed。`;
}

function subscribeRun(kernel: OrchestratorKernelV3, runId: string, label: string): () => void {
    return kernel.stream(runId, (event: RuntimeEventV3) => {
        const eventType = String((event as { type?: string }).type || '');
        if (!eventType) {
            return;
        }

        if (eventType.startsWith('run.')) {
            const payload = (event as { payload?: Record<string, unknown> }).payload || {};
            process.stdout.write(`[stream:${label}] ${eventType} payload=${JSON.stringify(payload)}\n`);
            return;
        }

        if (eventType === 'tool_call_created') {
            const payload = (event as { payload?: { tool_calls?: Array<{ toolName?: string }> } }).payload;
            const tools = (payload?.tool_calls || []).map((item) => item.toolName || '-').join(',');
            process.stdout.write(`[stream:${label}] tool_call_created tools=[${tools}]\n`);
            return;
        }

        if (eventType === 'status') {
            const payload = (event as { payload?: { state?: string; message?: string } }).payload;
            process.stdout.write(`[stream:${label}] status=${payload?.state || '-'} msg=${payload?.message || '-'}\n`);
        }
    });
}

async function waitForTerminalStatus(
    kernel: OrchestratorKernelV3,
    runId: string,
    timeoutMs: number
): Promise<RunRecordV3> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const run = await kernel.status(runId);
        if (run && TERMINAL_STATUSES.has(run.status)) {
            return run;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const last = await kernel.status(runId);
    return (
        last || {
            runId,
            agentId: 'unknown',
            status: 'failed',
            input: '',
            error: 'waitForTerminalStatus timeout',
            createdAt: Date.now(),
        }
    );
}

function printRunResult(title: string, result: RunRecordV3): void {
    process.stdout.write(`\n[${title}] status=${result.status}\n`);
    if (result.error) {
        process.stdout.write(`[${title}] error=${result.error}\n`);
    }
    if (result.output) {
        process.stdout.write(`[${title}] output=${result.output.slice(0, 1200)}\n`);
    }
}

async function main(): Promise<void> {
    const modelId = resolveModelId();
    const modelConfig = ProviderRegistry.getModelConfig(modelId);
    if (!process.env[modelConfig.envApiKey]) {
        throw new Error(`Missing API key env: ${modelConfig.envApiKey}`);
    }

    const memoryPath = resolveMemoryPath();
    fs.mkdirSync(memoryPath, { recursive: true });
    fs.accessSync(memoryPath, fs.constants.W_OK);

    const memoryManager = createMemoryManager({
        type: 'file',
        connectionString: memoryPath,
    });
    await memoryManager.initialize();

    try {
        const runTimeoutMs = parsePositiveInt(process.env.ORCHESTRATION_V3_RUN_TIMEOUT_MS, 180_000);

        const provider = ProviderRegistry.createFromEnv(modelId, {
            temperature: 0.3,
        });
        const runtime = new LocalAgentRuntimeV2();

        const kernel = new OrchestratorKernelV3({
            runtime,
            controllerId: 'controller',
            agentsConfigs: {
                controller: {
                    role: 'controller',
                    systemPrompt: buildControllerPrompt(process.cwd()),
                    provider,
                    memoryManager,
                    maxLoops: 24,
                    requestTimeout: runTimeoutMs,
                },
                'coding-agent': {
                    role: 'coder',
                    systemPrompt: buildCoderPrompt(process.cwd()),
                    provider,
                    memoryManager,
                    maxLoops: 20,
                    requestTimeout: runTimeoutMs,
                },
                'review-agent': {
                    role: 'reviewer',
                    systemPrompt: buildReviewerPrompt(process.cwd()),
                    provider,
                    memoryManager,
                    maxLoops: 20,
                    requestTimeout: runTimeoutMs,
                },
            },
        });

        const goal = process.env.ORCHESTRATION_V3_GOAL?.trim() || '实现一个商场系统（商品、购物车、订单、支付）';
        process.stdout.write(`[goal] ${goal}\n`);

        const controllerRun = await kernel.execute(
            `用户需求：${goal}
要求：
1) 先做任务分解；
2) 必须调用 agent_dispatch_task 分别分发给 coding-agent 和 review-agent；
3) 分发后用 agent_wait_for_messages + agent_get_status 做监督；
4) 最后汇总子任务状态并给出最终结论。`
        );
        const unwatchController = subscribeRun(kernel, controllerRun.runId, 'controller');
        const controllerResult = await waitForTerminalStatus(kernel, controllerRun.runId, runTimeoutMs);
        unwatchController();
        printRunResult('controller', controllerResult);

        const children = await kernel.queryRuns({
            parentRunId: controllerRun.runId,
            limit: 50,
        });
        process.stdout.write(`\n[children] count=${children.length}\n`);
    } finally {
        await memoryManager.close();
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[orchestration-v3-demo] fatal: ${message}\n`);
    process.exitCode = 1;
});
