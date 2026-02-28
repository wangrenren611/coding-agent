import dotenv from 'dotenv';
import { Agent } from './agent-v2/agent/agent';
import { ProviderRegistry } from './providers';

import fs from 'fs';
import { AgentMessage, AgentMessageType, BaseAgentEvent, SubagentEventMessage } from './agent-v2/agent/stream-types';
import { createMemoryManager } from './agent-v2';
import { operatorPrompt } from './agent-v2/prompts/operator';
import { platform } from 'os';
import path from 'path';

dotenv.config({
    path: './.env.development',
});

// ==================== 颜色和样式系统 ====================

const COLORS = {
    // 基础颜色
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',

    // 前景色
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',

    // 背景色
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m',
};

// 子 Agent 专用颜色（用于区分不同类型的子 Agent）
const SUBAGENT_COLORS = [
    '\x1b[38;5;117m', // 亮青色
    '\x1b[38;5;183m', // 亮紫色
    '\x1b[38;5;216m', // 亮橙色
    '\x1b[38;5;150m', // 亮绿色
    '\x1b[38;5;223m', // 亮粉色
    '\x1b[38;5;180m', // 亮黄色
];

// 边框字符
const BOX = {
    tl: '╭',
    tr: '╮',
    bl: '╰',
    br: '╯',
    h: '─',
    v: '│',
    ht: '┬',
    hb: '┴',
    vl: '├',
    vr: '┤',
    cross: '┼',
};

function parseRequestTimeoutMs(envValue: string | undefined): number {
    const parsed = Number(envValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 1000 * 60 * 10; // 10 分钟
    }
    return parsed;
}

// ==================== 子 Agent 输出缓冲系统 ====================

interface SubagentBuffer {
    taskId: string;
    subagentType: string;
    callId?: string;
    childSessionId: string;
    colorIndex: number;
    lines: string[];
    startTime: number;
    status: 'running' | 'completed' | 'failed' | 'aborted';
    depth: number; // 嵌套深度
}

// 子 Agent 输出缓冲区：按 task_id 存储
const subagentBuffers = new Map<string, SubagentBuffer>();

// 待匹配的 task 工具调用
const pendingTaskCallIds: string[] = [];
const taskIdToCallId = new Map<string, string>();

// 活跃子 Agent 任务 ID 列表（按创建顺序）
const activeTaskIds: string[] = [];

// 子 Agent 颜色分配计数器
let subagentColorCounter = 0;

// 状态追踪
let lastStatusSignature = '';

// 全局序号计数器
let globalTaskCounter = 0;

/**
 * 获取子 Agent 的颜色
 */
function getSubagentColor(index: number): string {
    return SUBAGENT_COLORS[index % SUBAGENT_COLORS.length];
}

/**
 * 生成缩进前缀（根据深度）
 */
function getIndent(depth: number): string {
    return '  '.repeat(depth);
}

/**
 * 格式化时间
 */
function formatTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * 绘制分隔线
 */
function drawDivider(char: string = '─', width: number = 60): string {
    return char.repeat(width);
}

/**
 * 移除 ANSI 颜色码（用于计算长度）
 */
function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * 将消息格式化为带缩进的字符串
 */
function formatMessageWithIndent(message: BaseAgentEvent, indent: string, color: string = COLORS.gray): string[] {
    const lines: string[] = [];
    const msgType = String((message as unknown as { type: string }).type);
    const payload =
        (message as unknown as { payload?: Record<string, unknown> }).payload || ({} as Record<string, unknown>);

    switch (msgType) {
        case AgentMessageType.REASONING_START:
        case 'reasoning-start':
            lines.push(`${indent}${color}💭 ${COLORS.dim}思考中...${COLORS.reset}`);
            break;

        case AgentMessageType.REASONING_DELTA:
        case 'reasoning-delta':
            if (payload.content) {
                // 处理多行内容
                const content = payload.content as string;
                const contentLines = content.split('\n');
                for (const cline of contentLines) {
                    lines.push(`${indent}${color}${COLORS.dim}${cline}${COLORS.reset}`);
                }
            }
            break;

        case AgentMessageType.REASONING_COMPLETE:
        case 'reasoning-complete':
            lines.push(`${indent}${color}${COLORS.dim}✓ 思考完成${COLORS.reset}`);
            lines.push('');
            break;

        case AgentMessageType.TEXT_START:
        case 'text-start':
            lines.push(`${indent}${COLORS.green}▶ 开始回复${COLORS.reset}`);
            break;

        case AgentMessageType.TEXT_DELTA:
        case 'text-delta':
            if (payload.content) {
                const content = payload.content as string;
                const contentLines = content.split('\n');
                for (const cline of contentLines) {
                    lines.push(`${indent}${cline}`);
                }
            }
            break;

        case AgentMessageType.TEXT_COMPLETE:
        case 'text-complete':
            lines.push(`${indent}${COLORS.green}✓ 回复完成${COLORS.reset}`);
            break;

        case AgentMessageType.TOOL_CALL_CREATED:
        case 'tool_call_created': {
            const toolCalls = (payload.tool_calls || []) as Array<{ toolName: string; args: string }>;
            for (const call of toolCalls) {
                const toolName = call.toolName;
                const argsPreview = (call.args || '').slice(0, 60);
                const more = (call.args || '').length > 60 ? '...' : '';
                lines.push(
                    `${indent}${COLORS.yellow}🔧 ${toolName}${COLORS.reset}(${COLORS.dim}${argsPreview}${more}${COLORS.reset})`
                );
            }
            break;
        }

        case AgentMessageType.TOOL_CALL_RESULT:
        case 'tool_call_result': {
            const status = payload.status === 'success' ? `${COLORS.green}✓` : `${COLORS.red}✗`;
            const result = payload.result;
            let resultPreview: string;
            if (typeof result === 'string') {
                resultPreview = result.slice(0, 80);
            } else {
                resultPreview = JSON.stringify(result || {}).slice(0, 80);
            }
            const more =
                (typeof result === 'string' ? result.length : JSON.stringify(result || {}).length) > 80 ? '...' : '';
            lines.push(`${indent}${status}${COLORS.reset} ${COLORS.dim}[${payload.callId}]${COLORS.reset}`);
            lines.push(`${indent}  ${COLORS.dim}${resultPreview}${more}${COLORS.reset}`);
            break;
        }

        case AgentMessageType.STATUS:
        case 'status': {
            const state = payload.state as string | undefined;
            const statusIcons: Record<string, string> = {
                idle: '⏸',
                thinking: '🤔',
                running: '▶',
                completed: `${COLORS.green}✓${COLORS.reset}`,
                failed: `${COLORS.red}✗${COLORS.reset}`,
                aborted: '🛑',
                retrying: '🔄',
            };
            const icon = (state && statusIcons[state]) || '•';
            const msg = payload.message ? ` - ${payload.message}` : '';
            lines.push(`${indent}${icon} ${state || 'unknown'}${msg}`);
            break;
        }

        case AgentMessageType.USAGE_UPDATE:
        case 'usage_update': {
            const usage = payload.usage as
                | { total_tokens: number; prompt_tokens: number; completion_tokens: number }
                | undefined;
            if (usage) {
                lines.push(
                    `${indent}${COLORS.dim}📊 Tokens: ${COLORS.cyan}${usage.total_tokens}${COLORS.reset} ` +
                        `${COLORS.dim}(↑${usage.prompt_tokens} ↓${usage.completion_tokens})${COLORS.reset}`
                );
            }
            break;
        }

        case AgentMessageType.ERROR:
        case 'error':
            lines.push(`${indent}${COLORS.red}✗ 错误: ${payload.error}${COLORS.reset}`);
            if (payload.phase) {
                lines.push(`${indent}  阶段: ${payload.phase}`);
            }
            break;

        case AgentMessageType.CODE_PATCH:
        case 'code_patch':
            lines.push(`${indent}${COLORS.magenta}📝 代码变更: ${payload.path}${COLORS.reset}`);
            break;

        default:
            break;
    }

    return lines;
}

/**
 * 缓冲子 Agent 事件
 */
/**
 * 缓冲子 Agent 事件 - 采用完全缓冲模式，完成后再输出
 */
function bufferSubagentEvent(message: SubagentEventMessage, parentDepth: number = 0) {
    const payload = message.payload;
    const { task_id, subagent_type, child_session_id, event } = payload;
    const eventType = String((event as unknown as { type?: string })?.type || '');

    if (!task_id || !event) {
        return;
    }

    // 关联 task_id 和 call_id
    if (!taskIdToCallId.has(task_id) && pendingTaskCallIds.length > 0) {
        const matchedCallId = pendingTaskCallIds.shift();
        if (matchedCallId) {
            taskIdToCallId.set(task_id, matchedCallId);
        }
    }

    // 获取或创建缓冲区
    let buffer = subagentBuffers.get(task_id);

    if (!buffer) {
        buffer = {
            taskId: task_id,
            subagentType: subagent_type,
            callId: taskIdToCallId.get(task_id),
            childSessionId: child_session_id,
            colorIndex: subagentColorCounter++,
            lines: [],
            startTime: Date.now(),
            status: 'running',
            depth: parentDepth + 1,
        };
        subagentBuffers.set(task_id, buffer);
        activeTaskIds.push(task_id);

        // 显示简洁的启动提示（单行，会被完成后覆盖）
        const taskNum = activeTaskIds.length;
        process.stdout.write(`\r${COLORS.dim}⏳ 子任务 #${taskNum} [${subagent_type}] 启动中...${COLORS.reset}`);
    }

    const color = getSubagentColor(buffer.colorIndex);
    const indent = getIndent(buffer.depth);

    // 处理嵌套的子 Agent 事件
    if (eventType === 'subagent_event') {
        // 递归处理嵌套子 Agent，传递当前深度
        const nestedEvent = event as SubagentEventMessage;
        bufferSubagentEvent(nestedEvent, buffer.depth);
    } else {
        // 普通事件 - 缓冲起来，不实时输出
        const lines = formatMessageWithIndent(event as BaseAgentEvent, indent, color);
        buffer.lines.push(...lines);

        // 检查终态
        if (eventType === 'status') {
            const state = (event as unknown as { payload?: { state?: string } }).payload?.state;
            if (state && ['completed', 'failed', 'aborted'].includes(state)) {
                buffer.status = state as 'completed' | 'failed' | 'aborted';

                // 清除启动提示行
                process.stdout.write('\r\x1b[K');

                // 输出完整的子 Agent 报告
                printSubagentReport(buffer);

                // 清理
                subagentBuffers.delete(task_id);
                const idx = activeTaskIds.indexOf(task_id);
                if (idx >= 0) {
                    activeTaskIds.splice(idx, 1);
                }
            }
        }
    }
}

/**
 * 输出子 Agent 完整报告（完成后一次性输出）
 */
function printSubagentReport(buffer: SubagentBuffer) {
    const color = getSubagentColor(buffer.colorIndex);
    const taskNum = ++globalTaskCounter;
    const elapsed = formatTime(Date.now() - buffer.startTime);

    const statusIcon =
        buffer.status === 'completed' ? `${COLORS.green}✓` : buffer.status === 'failed' ? `${COLORS.red}✗` : '🛑';

    // 头部
    console.log('');
    console.log(
        `${color}┌─ ${COLORS.bold}[子任务 #${taskNum}]${COLORS.reset} ${color}${buffer.subagentType}${COLORS.reset} ${statusIcon}${COLORS.reset}`
    );
    console.log(
        `${color}│${COLORS.reset} ${COLORS.dim}task_id: ${buffer.taskId.slice(0, 16)}... | 耗时: ${elapsed}${COLORS.reset}`
    );
    console.log(`${color}├${drawDivider('─', 56)}${COLORS.reset}`);

    // 输出缓冲的内容（过滤掉空行和重复的状态行）
    const seenStatusLines = new Set<string>();
    for (const line of buffer.lines) {
        // 跳过空行
        if (!line.trim()) continue;

        // 对状态行去重
        if (line.includes('running') || line.includes('thinking') || line.includes('completed')) {
            // eslint-disable-next-line no-control-regex
            const key = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
            if (seenStatusLines.has(key)) continue;
            seenStatusLines.add(key);
        }

        console.log(`${color}│${COLORS.reset} ${line}`);
    }

    // 尾部
    console.log(`${color}└${drawDivider('─', 56)}${COLORS.reset}`);
}

/**
 * 刷新所有未完成的子 Agent 缓冲区（兜底机制）
 */
function flushAllPendingBuffers() {
    const pendingTaskIds = [...activeTaskIds];
    for (const taskId of pendingTaskIds) {
        const buffer = subagentBuffers.get(taskId);
        if (buffer && buffer.lines.length > 0) {
            buffer.status = buffer.status === 'running' ? 'completed' : buffer.status;
            printSubagentReport(buffer);
            subagentBuffers.delete(taskId);
        }
    }
    activeTaskIds.length = 0;
}

// 追踪当前是否在输出文本
let isInTextBlock = false;
let isInReasoningBlock = false;

/**
 * 处理主 Agent 事件（实时输出）
 */
function handleSingleMessage(message: BaseAgentEvent, indent: string = '') {
    switch (message.type) {
        // ==================== 推理/思考内容 (thinking 模式) ====================
        case AgentMessageType.REASONING_START:
            if (!isInReasoningBlock) {
                console.log(`${indent}${COLORS.cyan}╭─ 💭 ${COLORS.bold}思考过程${COLORS.reset}`);
                isInReasoningBlock = true;
            }
            break;

        case AgentMessageType.REASONING_DELTA:
            process.stdout.write(message.payload.content);
            break;

        case AgentMessageType.REASONING_COMPLETE:
            process.stdout.write('\n');
            console.log(`${indent}${COLORS.cyan}╰─ ${COLORS.dim}思考完成${COLORS.reset}`);
            console.log('');
            isInReasoningBlock = false;
            break;

        // ==================== 正式文本回复 ====================
        case AgentMessageType.TEXT_START:
            if (!isInTextBlock) {
                console.log(`${indent}${COLORS.green}╭─ 🤖 ${COLORS.bold}回复${COLORS.reset}`);
                console.log(`${indent}${COLORS.green}│${COLORS.reset} `);
                isInTextBlock = true;
            }
            break;

        case AgentMessageType.TEXT_DELTA:
            process.stdout.write(message.payload.content);
            break;

        case AgentMessageType.TEXT_COMPLETE:
            process.stdout.write('\n');
            console.log(`${indent}${COLORS.green}╰─ ${COLORS.dim}回复完成${COLORS.reset}`);
            isInTextBlock = false;
            break;

        // ==================== 工具调用 ====================
        case AgentMessageType.TOOL_CALL_CREATED: {
            const tools = message.payload.tool_calls;

            for (const call of tools) {
                // 记录 task 类型的工具调用，用于关联子 Agent
                if (call.toolName === 'task') {
                    pendingTaskCallIds.push(call.callId);
                }
            }

            console.log('');
            console.log(`${indent}${COLORS.yellow}╭─ 🔧 ${COLORS.bold}工具调用${COLORS.reset}`);

            for (const call of tools) {
                const argsPreview = call.args.slice(0, 60);
                const more = call.args.length > 60 ? '...' : '';
                console.log(
                    `${indent}${COLORS.yellow}│${COLORS.reset} ${COLORS.bold}${call.toolName}${COLORS.reset}(${COLORS.dim}${argsPreview}${more}${COLORS.reset})`
                );
            }
            break;
        }

        case AgentMessageType.TOOL_CALL_RESULT: {
            const status =
                message.payload.status === 'success'
                    ? `${COLORS.green}✓ 成功${COLORS.reset}`
                    : `${COLORS.red}✗ 失败${COLORS.reset}`;
            const result = message.payload.result;
            let resultPreview: string;

            if (typeof result === 'string') {
                resultPreview = result.slice(0, 100).replace(/\n/g, ' ');
            } else {
                resultPreview = JSON.stringify(result || {}).slice(0, 100);
            }
            const more =
                (typeof result === 'string' ? result.length : JSON.stringify(result || {}).length) > 100 ? '...' : '';

            console.log(
                `${indent}${COLORS.yellow}│${COLORS.reset} ${status} ${COLORS.dim}[${message.payload.callId.slice(0, 8)}]${COLORS.reset}`
            );
            console.log(
                `${indent}${COLORS.yellow}│${COLORS.reset} ${COLORS.dim}${resultPreview}${more}${COLORS.reset}`
            );
            console.log(`${indent}${COLORS.yellow}╰─${COLORS.reset}`);
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
                idle: '⏸',
                thinking: '🤔',
                running: '▶',
                completed: `${COLORS.green}✓${COLORS.reset}`,
                failed: `${COLORS.red}✗${COLORS.reset}`,
                aborted: '🛑',
                retrying: '🔄',
            };
            const icon = statusIcons[state] || '•';
            const msg = message.payload.message ? ` - ${message.payload.message}` : '';

            console.log(`${indent}${icon} ${COLORS.dim}${state}${msg}${COLORS.reset}`);
            break;
        }

        // ==================== Token 使用量更新 ====================
        case AgentMessageType.USAGE_UPDATE: {
            const usage = message.payload.usage;
            const cumulative = message.payload.cumulative;

            let usageText =
                `${indent}${COLORS.dim}📊 Tokens: ${COLORS.cyan}${usage.total_tokens}${COLORS.reset} ` +
                `${COLORS.dim}(↑${usage.prompt_tokens} ↓${usage.completion_tokens})${COLORS.reset}`;

            if (cumulative) {
                usageText += ` ${COLORS.dim}| 累计: ${cumulative.total_tokens}${COLORS.reset}`;
            }

            console.log(usageText);
            break;
        }

        // ==================== 错误处理 ====================
        case AgentMessageType.ERROR:
            console.error(`${indent}${COLORS.red}╭─ ✗ 错误${COLORS.reset}`);
            console.error(`${indent}${COLORS.red}│${COLORS.reset} ${message.payload.error}`);
            if (message.payload.phase) {
                console.error(`${indent}${COLORS.red}│${COLORS.reset} 阶段: ${message.payload.phase}`);
            }
            console.error(`${indent}${COLORS.red}╰─${COLORS.reset}`);
            break;

        // ==================== 代码补丁 ====================
        case AgentMessageType.CODE_PATCH:
            console.log(`${indent}${COLORS.magenta}📝 代码变更: ${COLORS.bold}${message.payload.path}${COLORS.reset}`);
            if (message.payload.language) {
                console.log(`${indent}   语言: ${message.payload.language}`);
            }
            break;

        default:
            break;
    }
}

/**
 * 统一流式消息处理 - 子 Agent 输出缓冲，主 Agent 实时输出
 */
function handleStreamMessage(message: AgentMessage) {
    switch (message.type) {
        // ==================== 子 Agent 事件冒泡（缓冲） ====================
        case AgentMessageType.SUBAGENT_EVENT:
            bufferSubagentEvent(message as SubagentEventMessage);
            break;

        // ==================== 主 Agent 事件（实时输出） ====================
        default:
            handleSingleMessage(message as BaseAgentEvent);
            break;
    }
}

/**
 * 打印用户输入框
 */
function printUserInput(query: string) {
    const maxLineLen = 70;
    const lines: string[] = [];

    // 分行长文本
    const words = query.split('');
    let currentLine = '';
    for (const char of words) {
        if (char === '\n' || stripAnsi(currentLine).length >= maxLineLen) {
            lines.push(currentLine);
            currentLine = char === '\n' ? '' : char;
        } else {
            currentLine += char;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }

    const width = Math.min(Math.max(...lines.map((l) => stripAnsi(l).length), 20) + 4, 76);

    console.log('');
    console.log(`${COLORS.bgBlue}${COLORS.white}${COLORS.bold} 用户输入 ${COLORS.reset}`);
    console.log(`${COLORS.blue}╭${BOX.h.repeat(width - 2)}╮${COLORS.reset}`);

    for (const line of lines) {
        const lineLen = stripAnsi(line).length;
        const padding = width - 4 - lineLen;
        console.log(
            `${COLORS.blue}│${COLORS.reset} ${line}${' '.repeat(Math.max(0, padding))} ${COLORS.blue}│${COLORS.reset}`
        );
    }

    console.log(`${COLORS.blue}╰${BOX.h.repeat(width - 2)}╯${COLORS.reset}`);
    console.log('');
}

/**
 * 打印会话信息
 */
function printSessionInfo(sessionId: string, messageCount: number, restored: boolean = false) {
    console.log('');
    console.log(`${COLORS.dim}${drawDivider('─')}${COLORS.reset}`);
    console.log(`${COLORS.cyan}📋 会话信息${COLORS.reset}`);
    console.log(`${COLORS.dim}  会话 ID: ${sessionId}${COLORS.reset}`);
    console.log(`${COLORS.dim}  消息数: ${messageCount}${COLORS.reset}`);
    if (restored) {
        console.log(`${COLORS.green}  ✓ 已恢复历史会话${COLORS.reset}`);
    }
    console.log(`${COLORS.dim}${drawDivider('─')}${COLORS.reset}`);
}

/**
 * 响应结果接口
 */
interface AgentResponse {
    role?: string;
    type?: string;
    finish_reason?: string | null;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * 打印最终响应
 */
function printFinalResponse(response: AgentResponse) {
    console.log('');
    console.log(`${COLORS.dim}${drawDivider('═')}${COLORS.reset}`);
    console.log(`${COLORS.green}${COLORS.bold}📋 最终响应${COLORS.reset}`);
    console.log(`${COLORS.dim}${drawDivider('═')}${COLORS.reset}`);

    if (response.finish_reason) {
        const reasonColors: Record<string, string> = {
            stop: COLORS.green,
            tool_calls: COLORS.yellow,
            length: COLORS.yellow,
            content_filter: COLORS.red,
        };
        const reasonColor = reasonColors[response.finish_reason] || COLORS.white;
        console.log(`  结束原因: ${reasonColor}${response.finish_reason}${COLORS.reset}`);
    }

    if (response.usage) {
        console.log(`  Token 使用:`);
        console.log(`    - 输入: ${response.usage.prompt_tokens}`);
        console.log(`    - 输出: ${response.usage.completion_tokens}`);
        console.log(`    - 总计: ${COLORS.cyan}${response.usage.total_tokens}${COLORS.reset}`);
    }

    console.log(`${COLORS.dim}${drawDivider('═')}${COLORS.reset}`);
}

/**
 * 解析命令行参数
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
                console.error(`${COLORS.red}错误: --session-id 需要提供一个会话 ID${COLORS.reset}`);
                process.exit(1);
            }
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
${COLORS.cyan}用法:${COLORS.reset} pnpm demo1 [选项] [问题]

${COLORS.cyan}选项:${COLORS.reset}
  -s, --session-id <id>  指定会话 ID，用于恢复之前的会话
  -h, --help             显示此帮助信息

${COLORS.cyan}示例:${COLORS.reset}
  pnpm demo1 "分析当前项目结构"
  pnpm demo1 --session-id agent-44 "继续之前的问题"
  pnpm demo1 -s agent-44 "继续之前的问题"
`);
            process.exit(0);
        } else {
            queryParts.push(arg);
        }
    }

    const query = queryParts.join(' ');

    return { sessionId, query };
}

async function demo1() {
    // 重置全局状态
    subagentBuffers.clear();
    pendingTaskCallIds.length = 0;
    taskIdToCallId.clear();
    activeTaskIds.length = 0;
    subagentColorCounter = 0;
    globalTaskCounter = 0;
    lastStatusSignature = '';
    isInTextBlock = false;
    isInReasoningBlock = false;

    // 解析命令行参数
    const { sessionId: cliSessionId, query: cliQuery } = parseCliArgs();

    // 打印标题
    console.log('');
    console.log(`${COLORS.cyan}${COLORS.bold}${drawDivider('═', 60)}${COLORS.reset}`);
    console.log(
        `${COLORS.cyan}${COLORS.bold}│${COLORS.reset}${' '.repeat(18)}${COLORS.cyan}${COLORS.bold}🤖 Agent Demo${COLORS.reset}${' '.repeat(18)}${COLORS.cyan}${COLORS.bold}│${COLORS.reset}`
    );
    console.log(
        `${COLORS.cyan}${COLORS.bold}│${COLORS.reset}${' '.repeat(14)}${COLORS.dim}支持 Thinking 模式 • 子 Agent 可视化${COLORS.reset}${' '.repeat(13)}${COLORS.cyan}${COLORS.bold}│${COLORS.reset}`
    );
    console.log(`${COLORS.cyan}${COLORS.bold}${drawDivider('═', 60)}${COLORS.reset}`);

    if (cliSessionId) {
        console.log(`${COLORS.yellow}📋 恢复会话: ${cliSessionId}${COLORS.reset}`);
    }

    const preferredMemoryPath =
        platform() === 'win32'
            ? 'D:/work/coding-agent-data/agent-memory'
            : '/Users/wrr/work/coding-agent-data/agent-memory';

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
            systemPrompt: operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
            }),
            requestTimeout: parseRequestTimeoutMs(process.env.AGENT_REQUEST_TIMEOUT_MS),
            ...(cliSessionId ? { sessionId: cliSessionId } : {}),
            stream: true,
            thinking: true,
            enableCompaction: true,
            compactionConfig: {
                keepMessagesNum: 40,
                triggerRatio: 0.9,
            },
            memoryManager,
            streamCallback: handleStreamMessage,
        });

        // 执行查询
        let query = cliQuery;

        if (!query) {
            query = fs.readFileSync(path.join(process.cwd(), 'src/query.text'), 'utf-8');
        }

        if (query.trim().length === 0) {
            console.error(`${COLORS.red}错误: 查询内容不能为空${COLORS.reset}`);
            process.exit(1);
        }

        printUserInput(query);

        const response = await agent.execute(query);

        // 兜底：刷新所有未完成的子 Agent 缓冲区
        flushAllPendingBuffers();

        // 打印最终响应
        printFinalResponse(response);

        // 输出会话信息
        printSessionInfo(agent.getSessionId(), agent.getMessages().length, !!cliSessionId);
    } catch (error) {
        console.error(`\n${COLORS.red}${COLORS.bold}✗ demo1 执行失败:${COLORS.reset}`);
        console.error(error);
    } finally {
        await memoryManager.close();
    }
}

demo1().catch((error) => {
    console.error(`${COLORS.red}✗ demo1 未捕获异常:${COLORS.reset}`, error);
    process.exit(1);
});
