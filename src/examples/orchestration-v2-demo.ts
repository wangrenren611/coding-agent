#!/usr/bin/env tsx

import dotenv from 'dotenv';
import fs from 'fs';
import { platform } from 'os';
import { createMemoryManager } from '../agent-v2';
import {
    buildControllerPrompt,
    buildWorkerPrompt,
    LocalAgentRuntimeV2,
    OrchestratorKernelV2,
} from '../agent-v2/orchestration-v2';
import { ProviderRegistry, type ModelId } from '../providers';

dotenv.config({
    path: './.env.development',
});

function resolveModelId(): ModelId {
    const candidate = (process.env.ORCHESTRATION_V2_MODEL || 'qwen3.5-plus').trim();
    const supported = new Set(ProviderRegistry.getModelIds());
    if (!supported.has(candidate as ModelId)) {
        throw new Error(`Unknown ORCHESTRATION_V2_MODEL: ${candidate}`);
    }
    return candidate as ModelId;
}

function resolveMemoryPath(): string {
    if (process.env.ORCHESTRATION_V2_MEMORY_PATH?.trim()) {
        return process.env.ORCHESTRATION_V2_MEMORY_PATH.trim();
    }
    return platform() === 'win32'
        ? 'D:/work/coding-agent-data/orchestration-v2-memory'
        : '/Users/wrr/work/coding-agent-data/orchestration-v2-memory';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
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
        const plannerTimeoutMs = parsePositiveInt(process.env.ORCHESTRATION_V2_PLANNER_TIMEOUT_MS, 180_000);
        const taskTimeoutMs = parsePositiveInt(process.env.ORCHESTRATION_V2_TASK_TIMEOUT_MS, 180_000);

        const provider = ProviderRegistry.createFromEnv(modelId, {
            temperature: 0.3,
        });

        const runtime = new LocalAgentRuntimeV2();
        const goal = '帮我创建一个个人博客';
        const promptOptions = {
            directory: process.cwd(),
            language: 'Chinese',
            productContext: '个人博客系统（前端展示 + 后端 API + 管理能力 + 部署）',
        } as const;

        const kernel = new OrchestratorKernelV2({
            runtime,
            provider,
            memoryManager,
            controller: {
                agentId: 'controller',
                systemPrompt: buildControllerPrompt(promptOptions),
            },
            templates: [
                {
                    role: 'frontend-coder',
                    systemPrompt: buildWorkerPrompt('frontend-coder', promptOptions),
                },
                {
                    role: 'backend-coder',
                    systemPrompt: buildWorkerPrompt('backend-coder', promptOptions),
                },
                {
                    role: 'reviewer',
                    systemPrompt: buildWorkerPrompt('reviewer', promptOptions),
                },
            ],
            planner: {
                timeoutMs: plannerTimeoutMs,
                maxRepairAttempts: 2,
            },
            scheduler: {
                maxConcurrentTasks: 2,
                maxTaskRetries: 1,
                taskTimeoutMs,
                failFast: false,
            },
        });

        kernel.subscribe((event) => {
            if (event.type.startsWith('kernel.')) {
                process.stdout.write(
                    `[event] ${event.type} run=${event.runId || '-'} agent=${event.agentId || '-'} payload=${JSON.stringify(event.payload || {})}\n`
                );
            }
        });

        const result = await kernel.execute(goal);

        process.stdout.write('\n[plan]\n');
        process.stdout.write(`${result.plan.summary}\n`);
        for (const task of result.plan.tasks) {
            process.stdout.write(`- ${task.id} role=${task.role} deps=[${task.dependsOn.join(',')}]\n`);
        }

        process.stdout.write('\n[tasks]\n');
        for (const task of result.tasks) {
            process.stdout.write(
                `- ${task.taskId} role=${task.role} agent=${task.agentId} status=${task.status} attempts=${task.attempts}\n`
            );
        }

        process.stdout.write(`\n[result] status=${result.status}\n`);
        if (result.finalSummary) {
            process.stdout.write(`[summary] ${result.finalSummary}\n`);
        }

        process.stdout.write('\n[messaging-demo]\n');
        const sent = kernel.sendMessage({
            fromAgentId: 'template-reviewer',
            toAgentId: 'template-frontend-coder',
            topic: 'peer-review',
            payload: { verdict: 'need refactor', actions: ['extract hook', 'add loading state'] },
            correlationId: result.goalRunId,
        });
        process.stdout.write(`[send] messageId=${sent.messageId} topic=${sent.topic}\n`);
        const received = kernel.receiveMessages('template-frontend-coder', { limit: 10, leaseMs: 15_000 });
        process.stdout.write(`[receive] count=${received.length}\n`);
        if (received[0]) {
            const acked = kernel.ackMessage('template-frontend-coder', received[0].messageId);
            process.stdout.write(`[ack] messageId=${received[0].messageId} acked=${acked}\n`);
        }
    } finally {
        await memoryManager.close();
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[orchestration-v2-demo] fatal: ${message}\n`);
    process.exitCode = 1;
});
