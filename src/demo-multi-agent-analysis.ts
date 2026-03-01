import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';

import { Agent } from './agent-v2/agent/agent';
import { createMemoryManager } from './agent-v2';
import { operatorPrompt } from './agent-v2/prompts/operator';
import { AgentMessage, AgentMessageType, SubagentEventMessage } from './agent-v2/agent/stream-types';
import { MessageContent, ModelId, ProviderRegistry } from './providers';

dotenv.config({ path: './.env.development' });

const DEFAULT_MODEL: ModelId = 'qwen-glm-5';
const DEFAULT_SESSION_PREFIX = 'multi-agent-analysis';
const DEFAULT_MEMORY_DIR = path.resolve(process.cwd(), '.memory');
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), 'docs');

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function todayTag(): string {
    return new Date().toISOString().slice(0, 10);
}

function resolveModelId(rawValue: string | undefined): ModelId {
    if (!rawValue) return DEFAULT_MODEL;
    const allModelIds = ProviderRegistry.getModelIds();
    if (allModelIds.includes(rawValue as ModelId)) {
        return rawValue as ModelId;
    }
    process.stderr.write(`[multi-agent-analysis] Unknown model "${rawValue}", fallback to "${DEFAULT_MODEL}".\n`);
    return DEFAULT_MODEL;
}

function stringifyContent(content: MessageContent): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return String(content ?? '');

    const textParts: string[] = [];
    for (const part of content) {
        if (typeof part === 'string') {
            textParts.push(part);
            continue;
        }
        if (part && typeof part === 'object') {
            const maybeText = (part as { text?: unknown }).text;
            if (typeof maybeText === 'string') {
                textParts.push(maybeText);
                continue;
            }
        }
    }
    return textParts.join('\n').trim();
}

function printToolCreated(message: AgentMessage): void {
    if (message.type !== AgentMessageType.TOOL_CALL_CREATED) return;
    const toolNames = message.payload.tool_calls.map((call) => call.toolName).join(', ');
    process.stdout.write(`[tool] created: ${toolNames}\n`);
}

function printTaskResult(message: AgentMessage): void {
    if (message.type !== AgentMessageType.TOOL_CALL_RESULT) return;
    const result = message.payload.result;
    if (typeof result !== 'object' || result === null) return;

    const typedResult = result as { metadata?: { task_id?: string; status?: string }; output?: string };
    const taskId = typedResult.metadata?.task_id;
    const status = typedResult.metadata?.status;
    if (!taskId && !status) return;
    process.stdout.write(`[task] id=${taskId ?? '-'} status=${status ?? '-'}\n`);
}

function printStatus(message: AgentMessage): void {
    if (message.type !== AgentMessageType.STATUS) return;
    process.stdout.write(
        `[status] ${message.payload.state}${message.payload.message ? ` - ${message.payload.message}` : ''}\n`
    );
}

function printSubagentStatus(message: AgentMessage): void {
    if (message.type !== AgentMessageType.SUBAGENT_EVENT) return;
    const subagentEvent = message as SubagentEventMessage;
    const nested = subagentEvent.payload.event;
    if (nested.type !== AgentMessageType.STATUS) return;

    process.stdout.write(
        `[subagent:${subagentEvent.payload.subagent_type}] task=${subagentEvent.payload.task_id} state=${nested.payload.state}\n`
    );
}

function buildPrompt(userObjective: string): string {
    return `
你是当前仓库的主协调 Agent。目标是执行一次“多智能体深度分析启动”，并输出可落地的启动结论。

必须动作：
1. 使用 task 工具并行启动至少 4 个子 Agent，角色必须包含：
   - explore：产出代码架构与模块边界图（文本）
   - code-reviewer：定位 correctness / security / performance 风险
   - bug-analyzer：做关键执行链路根因分析
   - plan：产出 2 周执行路线图（按优先级和里程碑）
2. 每个子 Agent 使用 run_in_background=true，并通过 task_output 轮询到完成状态。
3. 汇总输出必须包含：
   - 系统分层与关键数据流
   - 风险清单（严重级别、影响面、文件路径）
   - 当前质量基线（测试、类型、静态检查）
   - P0/P1/P2 的执行清单
   - 一份“多智能体分析项目启动计划”

本次额外目标：${userObjective}
`.trim();
}

async function writeReport(reportContent: string, reportPath: string): Promise<void> {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, reportContent, 'utf-8');
}

async function run(): Promise<void> {
    const modelId = resolveModelId(process.env.MULTI_AGENT_ANALYSIS_MODEL);
    const requestTimeoutMs = parsePositiveInt(process.env.AGENT_REQUEST_TIMEOUT_MS, 10 * 60 * 1000);
    const userObjective = process.argv.slice(2).join(' ').trim() || '深度分析当前项目并启动多智能体分析项目';
    const sessionId = `${DEFAULT_SESSION_PREFIX}-${todayTag()}`;
    const reportPath = path.join(DEFAULT_REPORT_DIR, `MULTI_AGENT_ANALYSIS_REPORT_${todayTag()}.md`);

    const memoryManager = createMemoryManager({
        type: 'file',
        connectionString: DEFAULT_MEMORY_DIR,
    });
    await memoryManager.initialize();

    const provider = ProviderRegistry.createFromEnv(modelId, { temperature: 0.2 });
    const systemPrompt = operatorPrompt({
        directory: process.cwd(),
        language: 'Chinese',
    });

    const agent = new Agent({
        provider,
        systemPrompt,
        stream: true,
        sessionId,
        memoryManager,
        requestTimeout: requestTimeoutMs,
        maxLoops: 800,
        streamCallback: (message) => {
            printStatus(message);
            printSubagentStatus(message);
            printToolCreated(message);
            printTaskResult(message);
        },
    });

    const startedAt = new Date().toISOString();
    const execution = await agent.executeWithResult(buildPrompt(userObjective));
    const finishedAt = new Date().toISOString();
    const finalText = execution.finalMessage ? stringifyContent(execution.finalMessage.content) : '';

    const report = `# Multi-Agent Analysis Report

- Session: ${sessionId}
- Model: ${modelId}
- StartedAt: ${startedAt}
- FinishedAt: ${finishedAt}
- Status: ${execution.status}
- LoopCount: ${execution.loopCount}
- RetryCount: ${execution.retryCount}

## Objective
${userObjective}

## Result
${finalText || '(No final text output)'}
`;

    await writeReport(report, reportPath);

    process.stdout.write(`\n[multi-agent-analysis] status=${execution.status}\n`);
    process.stdout.write(`[multi-agent-analysis] session=${sessionId}\n`);
    process.stdout.write(`[multi-agent-analysis] report=${reportPath}\n`);

    if (execution.status !== 'completed') {
        const failureMessage =
            execution.failure?.userMessage || execution.failure?.internalMessage || 'Unknown failure';
        process.stderr.write(`[multi-agent-analysis] failed: ${failureMessage}\n`);
        process.exitCode = 1;
    }

    await agent.close();
    await memoryManager.close();
}

void run().catch((error: unknown) => {
    const err = error as Error;
    process.stderr.write(`[multi-agent-analysis] fatal error: ${err.message}\n`);
    process.exitCode = 1;
});
