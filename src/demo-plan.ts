/**
 * ============================================================================
 * Plan Agent Demo - 演示 Plan 功能的完整工作流程
 * ============================================================================
 *
 * 工作流程：
 * 1. Plan 模式阶段 (planMode: true)
 *    - 只读操作：探索代码库、搜索文件
 *    - 使用 plan_create 创建 Markdown 文档
 *    - 系统提示词包含 Plan Mode 指令
 *
 * 2. 执行模式阶段 (planMode: false)
 *    - 读取 Plan Markdown 文档
 *    - Agent 自己决定如何执行
 *
 * 使用方法：
 *   pnpm dev:plan "实现用户认证功能"
 *   pnpm dev:plan  # 使用默认查询
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import { Agent } from './agent-v2/agent/agent';
import { ProviderRegistry } from './providers';
import { createMemoryManager } from './agent-v2';
import { operatorPrompt } from './agent-v2/prompts/operator';
import { AgentMessage, AgentMessageType, BaseAgentEvent, SubagentEventMessage } from './agent-v2/agent/stream-types';
import { createPlanStorage } from './agent-v2/plan';

dotenv.config({ path: './.env.development' });

// ==================== 颜色常量 ====================

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// ==================== 配置 ====================

const MEMORY_PATH = '/Users/wrr/work/coding-agent-data/agent-memory';

// ==================== 辅助函数 ====================

function parseRequestTimeoutMs(envValue: string | undefined): number {
    const parsed = Number(envValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 1000 * 60 * 10; // 10 分钟
    }
    return parsed;
}

let lastStatusSignature = '';
const SUBAGENT_PREFIX = '  ';
const pendingTaskCallIds: string[] = [];
const taskIdToCallId = new Map<string, string>();
const openedSubagentTasks = new Set<string>();
const closedSubagentTasks = new Set<string>();

function handleSingleMessage(message: BaseAgentEvent, indent: string = '') {
    switch (message.type) {
        case AgentMessageType.REASONING_START:
            process.stdout.write(`${indent}${GRAY}┌─ 💭 思考过程${RESET}\n`);
            process.stdout.write(`${indent}${GRAY}│${RESET} `);
            break;

        case AgentMessageType.REASONING_DELTA:
            process.stdout.write(message.payload.content);
            break;

        case AgentMessageType.REASONING_COMPLETE:
            process.stdout.write('\n');
            process.stdout.write(`${indent}${GRAY}└─ 思考完成${RESET}\n\n`);
            break;

        case AgentMessageType.TEXT_START:
            process.stdout.write(`${indent}${GREEN}┌─ 🤖 回复${RESET}\n`);
            process.stdout.write(`${indent}${GREEN}│${RESET} `);
            break;

        case AgentMessageType.TEXT_DELTA:
            process.stdout.write(message.payload.content);
            break;

        case AgentMessageType.TEXT_COMPLETE:
            process.stdout.write('\n');
            process.stdout.write(`${indent}${GREEN}└─ 回复完成${RESET}\n`);
            break;

        case AgentMessageType.TOOL_CALL_CREATED: {
            const tools = message.payload.tool_calls.map(
                (call) => `${call.toolName}(${call.args.slice(0, 50)}${call.args.length > 50 ? '...' : ''})`
            );
            for (const call of message.payload.tool_calls) {
                if (call.toolName === 'task') {
                    pendingTaskCallIds.push(call.callId);
                }
            }
            process.stdout.write('\n');
            console.log(`${indent}${YELLOW}🔧 工具调用:${RESET}`, tools.join(', '));
            break;
        }

        case AgentMessageType.TOOL_CALL_RESULT: {
            const status = message.payload.status === 'success' ? '✅' : '❌';
            const resultPreview =
                typeof message.payload.result === 'string'
                    ? message.payload.result.slice(0, 100)
                    : JSON.stringify(message.payload.result).slice(0, 100);
            console.log(`\n${indent}${status} 工具结果 [${message.payload.callId}]:`, resultPreview);
            break;
        }

        case AgentMessageType.STATUS: {
            const state = message.payload.state;
            const signature = `${indent}|${state}|${message.payload.message || ''}`;
            if (signature === lastStatusSignature) break;
            lastStatusSignature = signature;

            const statusIcons: Record<string, string> = {
                idle: '⏸️',
                thinking: '🤔',
                running: '▶️',
                completed: '✅',
                failed: '❌',
                aborted: '🛑',
                retrying: '🔄',
            };
            const icon = statusIcons[state] || '📋';
            console.log(
                `${indent}\n${icon} 状态: ${state}${message.payload.message ? ` - ${message.payload.message}` : ''}`
            );
            break;
        }

        case AgentMessageType.USAGE_UPDATE: {
            const usage = message.payload.usage;
            process.stdout.write('\n');
            console.log(
                `${indent}${GRAY}📊 Token 使用: ` +
                    `${CYAN}${usage.total_tokens}${RESET} ` +
                    `(输入: ${usage.prompt_tokens}, 输出: ${usage.completion_tokens})`
            );
            break;
        }

        case AgentMessageType.ERROR:
            console.error(`${indent}\n❌ 错误: ${message.payload.error}`);
            if (message.payload.phase) {
                console.error(`${indent}   阶段: ${message.payload.phase}`);
            }
            break;

        case AgentMessageType.CODE_PATCH:
            console.log(`${indent}\n📝 代码变更: ${message.payload.path}`);
            break;
    }
}

function handleSubagentEvent(message: SubagentEventMessage, indent: string = '') {
    const { task_id, subagent_type, child_session_id, event } = message.payload;

    if (!taskIdToCallId.has(task_id) && pendingTaskCallIds.length > 0) {
        const matchedCallId = pendingTaskCallIds.shift();
        if (matchedCallId) {
            taskIdToCallId.set(task_id, matchedCallId);
        }
    }

    if (!openedSubagentTasks.has(task_id)) {
        const linkedCallId = taskIdToCallId.get(task_id);
        process.stdout.write('\n');
        console.log(`${indent}${BLUE}┌─ 🔄 子 Agent [${subagent_type}]${RESET}`);
        console.log(`${indent}${BLUE}│ task_id: ${task_id}${RESET}`);
        if (linkedCallId) {
            console.log(`${indent}${BLUE}│ tool_call: ${linkedCallId}${RESET}`);
        }
        console.log(`${indent}${BLUE}│ child_session: ${child_session_id}${RESET}`);
        console.log(`${indent}${BLUE}├─────────────────────────────────────────${RESET}`);
        openedSubagentTasks.add(task_id);
    }

    const childIndent = indent + SUBAGENT_PREFIX;

    if (event.type === AgentMessageType.SUBAGENT_EVENT) {
        handleSubagentEvent(event as SubagentEventMessage, childIndent);
    } else {
        handleSingleMessage(event as BaseAgentEvent, childIndent);

        if (
            event.type === AgentMessageType.STATUS &&
            !closedSubagentTasks.has(task_id) &&
            ['completed', 'failed', 'aborted'].includes(event.payload.state)
        ) {
            console.log(`${indent}${BLUE}└─────────────────────────────────────────${RESET}`);
            closedSubagentTasks.add(task_id);
        }
    }
}

function handleStreamMessage(message: AgentMessage) {
    switch (message.type) {
        case AgentMessageType.SUBAGENT_EVENT:
            handleSubagentEvent(message);
            break;
        default:
            handleSingleMessage(message as BaseAgentEvent);
            break;
    }
}

// ==================== Plan Agent Demo ====================

async function runPlanDemo() {
    console.log('='.repeat(60));
    console.log(`${MAGENTA}📋 Plan Agent Demo${RESET}`);
    console.log('='.repeat(60));
    console.log();

    // 初始化 MemoryManager
    fs.mkdirSync(MEMORY_PATH, { recursive: true });
    fs.accessSync(MEMORY_PATH, fs.constants.W_OK);

    const memoryManager = createMemoryManager({
        type: 'file',
        connectionString: MEMORY_PATH,
    });
    await memoryManager.initialize();

    // 初始化 Plan 存储
    // createPlanStorage(baseDir) - 在指定目录下创建 plans/ 子目录
    // 统一使用 MEMORY_PATH 作为存储目录
    const planStorage = createPlanStorage(MEMORY_PATH);

    const query = process.argv[2] || '分析 src/agent-v2/plan 目录的代码结构，并创建一个实现计划';

    try {
        // ==================== 阶段 1: Plan 模式 ====================
        console.log(`\n${MAGENTA}══════════════════════════════════════════════════════════${RESET}`);
        console.log(`${MAGENTA}📌 阶段 1: Plan 模式 - 分析需求并创建计划${RESET}`);
        console.log(`${MAGENTA}══════════════════════════════════════════════════════════${RESET}\n`);

        // Plan 模式使用 operatorPrompt({ planMode: true })
        // 系统提示词会自动包含 Plan Mode 指令
        const planSystemPrompt = operatorPrompt({
            directory: process.cwd(),
            language: 'Chinese',
            planMode: true, // 🔑 自动追加 Plan Mode 指令
        });

        const planAgent = new Agent({
            provider: ProviderRegistry.createFromEnv('qwen3.5-plus', { temperature: 0.1 }),
            systemPrompt: planSystemPrompt,
            planMode: true, // 🔑 启用 Plan 模式（只读工具 + plan_create）
            planBaseDir: MEMORY_PATH, // 🔑 Plan 存储目录
            requestTimeout: parseRequestTimeoutMs(process.env.AGENT_REQUEST_TIMEOUT_MS),
            stream: true,
            thinking: true,
            enableCompaction: true,
            compactionConfig: { keepMessagesNum: 40, triggerRatio: 0.9 },
            memoryManager,
            streamCallback: handleStreamMessage,
        });
        await planAgent.initialize();

        console.log(`${CYAN}Plan 模式 Session:${RESET} ${planAgent.getSessionId()}`);
        console.log(`${CYAN}查询:${RESET} ${query}\n`);

        // 执行 Plan 模式 - Agent 创建计划
        await planAgent.execute(query);

        console.log('\n' + '-'.repeat(60));
        console.log(`${GREEN}✅ Plan 模式完成${RESET}`);
        console.log('-'.repeat(60));

        // ==================== 获取 Plan 文档 ====================
        // 使用 getBySession(sessionId) O(1) 查询
        const sessionId = planAgent.getSessionId();
        const plan = await planStorage.getBySession(sessionId);

        if (!plan) {
            console.log(`${YELLOW}⚠️ 未找到 Plan 文档${RESET}`);
            console.log(`${YELLOW}可能是 Agent 没有调用 plan_create 工具${RESET}`);
            return;
        }

        console.log(`\n${GREEN}📄 找到 Plan:${RESET}`);
        console.log(`   ID: ${plan.meta.id}`);
        console.log(`   Session: ${plan.meta.sessionId}`);
        console.log(`   标题: ${plan.meta.title}`);
        console.log(`   文件: ${plan.meta.filePath}`);

        // ==================== 阶段 2: 执行模式 ====================
        console.log(`\n${MAGENTA}══════════════════════════════════════════════════════════${RESET}`);
        console.log(`${MAGENTA}🚀 阶段 2: 执行模式 - Agent 根据 Plan 执行${RESET}`);
        console.log(`${MAGENTA}══════════════════════════════════════════════════════════${RESET}\n`);

        // 执行模式使用 operatorPrompt({ planMode: false }) 或不传 planMode
        const executionSystemPrompt = operatorPrompt({
            directory: process.cwd(),
            language: 'Chinese',
            planMode: false, // 不包含 Plan Mode 指令
        });

        const executionAgent = new Agent({
            provider: ProviderRegistry.createFromEnv('qwen3.5-plus', { temperature: 0.1 }),
            systemPrompt: executionSystemPrompt,
            // planMode: false, // 默认就是执行模式（完整工具）
            requestTimeout: parseRequestTimeoutMs(process.env.AGENT_REQUEST_TIMEOUT_MS),
            stream: true,
            thinking: true,
            enableCompaction: true,
            compactionConfig: { keepMessagesNum: 40, triggerRatio: 0.9 },
            memoryManager,
            streamCallback: handleStreamMessage,
        });
        await executionAgent.initialize();

        console.log(`${CYAN}执行模式 Session:${RESET} ${executionAgent.getSessionId()}`);
        console.log(`${CYAN}Plan 文档内容预览:${RESET}`);
        console.log(`${GRAY}${plan.content.slice(0, 500)}...${RESET}\n`);

        // Agent 读取 Plan 并执行
        await executionAgent.execute(`
请按照以下计划执行：

---
${plan.content}
---

**重要**:
1. 按照计划的步骤执行
2. 完成后报告结果
`);

        // ==================== 完成 ====================
        console.log(`\n${MAGENTA}══════════════════════════════════════════════════════════${RESET}`);
        console.log(`${GREEN}🎉 计划执行完成！${RESET}`);
        console.log(`${MAGENTA}══════════════════════════════════════════════════════════${RESET}\n`);

        console.log(`${GRAY}────────────────────────────────────────────────────────${RESET}`);
        console.log(`${GRAY}Plan Session: ${planAgent.getSessionId()}${RESET}`);
        console.log(`${GRAY}Execution Session: ${executionAgent.getSessionId()}${RESET}`);
        console.log(`${GRAY}Plan File: ${plan.meta.filePath}${RESET}`);
    } catch (error) {
        console.error(`${RED}\n❌ Plan Demo 执行失败:${RESET}`, error);
    } finally {
        await memoryManager.close();
    }
}

// ==================== 入口 ====================

runPlanDemo().catch((error) => {
    console.error('❌ Plan Demo 未捕获异常:', error);
    process.exit(1);
});
