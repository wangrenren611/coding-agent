import dotenv from 'dotenv';
import { Agent } from './agent-v2/agent/agent';
import { ProviderRegistry } from './providers';

import fs from 'fs';
import { AgentMessage, AgentMessageType, BaseAgentEvent, SubagentEventMessage } from './agent-v2/agent/stream-types';
import { createMemoryManager } from './agent-v2';
import { operatorPrompt } from './agent-v2/prompts/operator';

dotenv.config({
    path: './.env.development',
});

// ANSI 颜色
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function parseRequestTimeoutMs(envValue: string | undefined): number {
    const parsed = Number(envValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 1000 * 60 * 10; // 10 分钟
    }
    return parsed;
}

// 状态追踪
let lastStatusSignature = '';

// 子 Agent 缩进前缀
const SUBAGENT_PREFIX = '  '; // 2 空格缩进

// 子 Agent 渲染状态：按 task_id 聚合打印
const pendingTaskCallIds: string[] = [];
const taskIdToCallId = new Map<string, string>();
const openedSubagentTasks = new Set<string>();
const closedSubagentTasks = new Set<string>();

/**
 * 处理单个事件消息
 * @param message 事件消息
 * @param indent 缩进级别（用于子 Agent 事件）
 */
function handleSingleMessage(message: BaseAgentEvent, indent: string = '') {
    switch (message.type) {
        // ==================== 推理/思考内容 (thinking 模式) ====================
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

        // ==================== 正式文本回复 ====================
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

        // ==================== 工具调用 ====================
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

        // case AgentMessageType.TOOL_CALL_STREAM:
        //     // 工具执行中的流式输出（如终端输出）
        //     if (message.payload.output) {
        //         process.stdout.write(`${indent}${GRAY}${message.payload.output}${RESET}`);
        //     }
        //     break;

        case AgentMessageType.TOOL_CALL_RESULT: {
            const status = message.payload.status === 'success' ? '✅' : '❌';
            const resultPreview =
                typeof message.payload.result === 'string'
                    ? message.payload.result.slice(0, 100)
                    : JSON.stringify(message.payload.result).slice(0, 100);
            console.log(`\n${indent}${status} 工具结果 [${message.payload.callId}]:`, resultPreview);
            break;
        }

        // ==================== 状态更新 ====================
        case AgentMessageType.STATUS: {
            const state = message.payload.state;
            const signature = `${indent}|${state}|${message.payload.message || ''}|${message.payload.meta?.retry?.attempt || 0}`;
            if (signature === lastStatusSignature) {
                break;
            }
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

        // ==================== Token 使用量更新 ====================
        case AgentMessageType.USAGE_UPDATE: {
            const usage = message.payload.usage;
            const cumulative = message.payload.cumulative;

            process.stdout.write('\n');
            console.log(
                `${indent}${GRAY}📊 Token 使用: ` +
                    `${CYAN}${usage.total_tokens}${RESET} ` +
                    `(输入: ${usage.prompt_tokens}, 输出: ${usage.completion_tokens})` +
                    (cumulative ? ` | 累计: ${cumulative.total_tokens}` : '')
            );
            break;
        }

        // ==================== 错误处理 ====================
        case AgentMessageType.ERROR:
            console.error(`${indent}\n❌ 错误: ${message.payload.error}`);
            if (message.payload.phase) {
                console.error(`${indent}   阶段: ${message.payload.phase}`);
            }
            break;

        // ==================== 代码补丁 ====================
        case AgentMessageType.CODE_PATCH:
            console.log(`${indent}\n📝 代码变更: ${message.payload.path}`);
            if (message.payload.language) {
                console.log(`${indent}   语言: ${message.payload.language}`);
            }
            break;

        default:
            // 未处理的消息类型
            break;
    }
}

/**
 * 处理子 Agent 事件冒泡
 */
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

    // 处理内部事件
    if (event.type === AgentMessageType.SUBAGENT_EVENT) {
        // 如果内部事件也是 SUBAGENT_EVENT，递归处理
        handleSubagentEvent(event as SubagentEventMessage, childIndent);
    } else {
        // 普通事件，带缩进处理
        handleSingleMessage(event as BaseAgentEvent, childIndent);

        // 子 Agent 事件尾（在终态时打印）
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

/**
 * 统一流式消息处理 - 支持推理内容和子 Agent 事件
 */
function handleStreamMessage(message: AgentMessage) {
    switch (message.type) {
        // ==================== 子 Agent 事件冒泡 ====================
        case AgentMessageType.SUBAGENT_EVENT:
            handleSubagentEvent(message);
            break;

        // ==================== 其他事件（主 Agent） ====================
        default:
            handleSingleMessage(message as BaseAgentEvent);
            break;
    }
}

/**
 * 解析命令行参数
 * 支持的参数：
 *   --session-id, -s <id>  指定会话 ID（用于恢复会话）
 *   --help, -h             显示帮助信息
 *
 * 示例：
 *   pnpm demo1 "你的问题"
 *   pnpm demo1 --session-id agent-44 "继续之前的问题"
 *   pnpm demo1 -s agent-44 "继续之前的问题"
 */
function parseCliArgs(): { sessionId?: string; query: string } {
    const args = process.argv.slice(2);
    let sessionId: string | undefined;
    const queryParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--session-id' || arg === '-s') {
            sessionId = args[++i];
            if (!sessionId) {
                console.error('错误: --session-id 需要提供一个会话 ID');
                process.exit(1);
            }
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
用法: pnpm demo1 [选项] [问题]

选项:
  -s, --session-id <id>  指定会话 ID，用于恢复之前的会话
  -h, --help             显示此帮助信息

示例:
  pnpm demo1 "分析当前项目结构"
  pnpm demo1 --session-id agent-44 "继续之前的问题"
  pnpm demo1 -s agent-44 "继续之前的问题"
`);
            process.exit(0);
        } else {
            // 其他参数作为问题的一部分
            queryParts.push(arg);
        }
    }

    const query = queryParts.join(' ');

    return { sessionId, query };
}

async function demo1() {
    // 解析命令行参数
    const { sessionId: cliSessionId, query: cliQuery } = parseCliArgs();

    console.log('='.repeat(60));
    console.log('🤖 Agent Demo - 支持 Thinking 模式');
    if (cliSessionId) {
        console.log(`📋 恢复会话: ${cliSessionId}`);
    }
    console.log('='.repeat(60));
    console.log();

    const preferredMemoryPath = '/Users/wrr/work/coding-agent-data/agent-memory';

    fs.mkdirSync(preferredMemoryPath, { recursive: true });
    fs.accessSync(preferredMemoryPath, fs.constants.W_OK);

    const memoryManager = createMemoryManager({
        type: 'file',
        connectionString: preferredMemoryPath,
    });

    await memoryManager.initialize();

    let agent: Agent | undefined;
    try {
        agent = new Agent({
            provider: ProviderRegistry.createFromEnv('glm-5', {
                temperature: 0.3,
            }),
            //  planMode: true,
            systemPrompt: operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
            }),
            // 单次 LLM 请求超时（默认 5 分钟，可用 AGENT_REQUEST_TIMEOUT_MS 覆盖）
            requestTimeout: parseRequestTimeoutMs(process.env.AGENT_REQUEST_TIMEOUT_MS),
            // 通过命令行参数 --session-id 或 -s 指定会话 ID
            ...(cliSessionId ? { sessionId: cliSessionId } : {}),

            stream: true,
            thinking: true, // 启用 thinking 模式，支持推理内容
            enableCompaction: true, // 启用上下文压缩
            compactionConfig: {
                keepMessagesNum: 40, // 保留最近 40 条消息
                triggerRatio: 0.9, // Token 使用达 90% 时触发压缩
            },
            memoryManager,
            streamCallback: handleStreamMessage,
        });

        // EventBus 监听重试事件
        // agent.on(EventType.TASK_RETRY, (data) => {
        //     console.log('🔄 任务重试中:', data);
        // });

        // 执行查询
        const query =
            cliQuery || '处理问题,先复现问题再修改代码，可以先写测试用例复现问题，相关执行信息："./query.text"';
        console.log(`${CYAN}❯${RESET} ${query}\n`);

        const response = await agent.execute(query);

        console.log('\n' + '='.repeat(60));
        console.log('📋 最终响应:');
        console.log('='.repeat(60));
        console.log(`角色: ${response.role}`);
        console.log(`类型: ${response.type}`);
        if (response.finish_reason) {
            console.log(`结束原因: ${response.finish_reason}`);
        }
        if (response.usage) {
            console.log(
                `Token 使用: prompt=${response.usage.prompt_tokens}, completion=${response.usage.completion_tokens}, total=${response.usage.total_tokens}`
            );
        }

        // 输出会话信息
        console.log('\n' + '='.repeat(60));
        console.log('📋 会话信息:');
        console.log('='.repeat(60));
        console.log(`会话 ID: ${agent.getSessionId()}`);
        console.log(`消息数: ${agent.getMessages().length}`);
    } catch (error) {
        console.error('\n❌ demo1 执行失败:', error);
        // process.exitCode = 1;
    } finally {
        await memoryManager.close();
    }
}

demo1().catch((error) => {
    console.error('❌ demo1 未捕获异常:', error);
    process.exit(1);
});
