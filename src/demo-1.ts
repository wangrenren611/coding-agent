import dotenv from 'dotenv';
import { Agent } from './agent-v2/agent/agent';
import { ModelId, ProviderRegistry } from './providers';

import fs from 'fs';
import {
    AgentMessage,
    AgentMessageType,
    BaseAgentEvent,
    PermissionRequestMessage,
    SubagentEventMessage,
} from './agent-v2/agent/stream-types';
import { createMemoryManager } from './agent-v2';
import { initializeMcp, disconnectMcp, getConfigSearchPaths } from './agent-v2/mcp';
import { operatorPrompt } from './agent-v2/prompts/operator';
import { platform } from 'os';
import path from 'path';
import readline from 'readline/promises';
import { parseFilePaths, createFileSummary, type ParsedFileInput } from './cli/utils/file';
import type { InputContentPart } from './providers/types/api';
import type { McpManager } from './agent-v2/mcp';
import type { PermissionAskContext } from './agent-v2/agent/types';

// const model = 'wr-claude-4.6';
const model: ModelId = 'glm-5';
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

    // 前景色 - 优化配色方案
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

    // 语义化颜色
    primary: '\x1b[38;5;75m', // 主色调 - 亮蓝色
    secondary: '\x1b[38;5;141m', // 次要色 - 紫色
    success: '\x1b[38;5;78m', // 成功 - 绿色
    warning: '\x1b[38;5;221m', // 警告 - 黄色
    error: '\x1b[38;5;204m', // 错误 - 红色
    info: '\x1b[38;5;117m', // 信息 - 青色
    muted: '\x1b[38;5;245m', // 弱化 - 灰色

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

// 工具图标映射
const TOOL_ICONS: Record<string, string> = {
    bash: '⚡',
    write_file: '📝',
    read_file: '📖',
    list_directory: '📁',
    search: '🔍',
    task: '🎯',
    default: '🔧',
};

function parseRequestTimeoutMs(envValue: string | undefined): number {
    const parsed = Number(envValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 1000 * 60 * 10; // 10 分钟
    }
    return parsed;
}

async function askPermissionFromTerminal(context: PermissionAskContext): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return false;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        console.log(
            `\n${COLORS.warning}◆ 权限确认${COLORS.reset} ${COLORS.muted}(ticket=${context.ticketId}, tool=${context.toolName})${COLORS.reset}`
        );
        console.log(`${COLORS.muted}  原因: ${context.reason}${COLORS.reset}`);
        while (true) {
            const answer = await rl.question(`${COLORS.primary}  是否允许执行？(yes/no): ${COLORS.reset}`);
            const normalized = answer.trim().toLowerCase();
            if (['y', 'yes', '是', '允许', 'ok'].includes(normalized)) {
                return true;
            }
            if (['n', 'no', '否', '拒绝'].includes(normalized)) {
                return false;
            }
            console.log(`${COLORS.warning}  请输入 yes 或 no（也支持 是/否）${COLORS.reset}`);
        }
    } finally {
        rl.close();
    }
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
let currentAgent: Agent | undefined;
let permissionPromptChain: Promise<void> = Promise.resolve();

// 全局序号计数器
let globalTaskCounter = 0;

function queuePermissionDecision(message: PermissionRequestMessage): void {
    permissionPromptChain = permissionPromptChain
        .then(async () => {
            if (!currentAgent) return;
            const approved = await askPermissionFromTerminal({
                ticketId: message.payload.ticketId,
                toolName: message.payload.toolName,
                reason: message.payload.reason,
                source: message.payload.source,
                args: message.payload.args,
                messageId: message.msgId || `permission-${message.timestamp}`,
            });
            const accepted = currentAgent.resolvePermission(message.payload.ticketId, approved);
            if (!accepted) {
                console.log(
                    `${COLORS.warning}  [warn] 权限请求已失效或已处理: ticket=${message.payload.ticketId}${COLORS.reset}`
                );
            }
        })
        .catch((error) => {
            console.error(`${COLORS.error}  权限确认处理失败: ${String(error)}${COLORS.reset}`);
            currentAgent?.resolvePermission(message.payload.ticketId, false);
        });
}

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
 * 移除 ANSI 颜色码（用于计算长度）
 */
function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * 获取工具图标
 */
function getToolIcon(toolName: string): string {
    return TOOL_ICONS[toolName] || TOOL_ICONS.default;
}

/**
 * 格式化工具参数（智能截断和美化）
 */
function formatToolArgs(args: string, maxLength: number = 80): string {
    try {
        const parsed = JSON.parse(args);

        // 如果是简单的对象，格式化为单行
        if (typeof parsed === 'object' && parsed !== null) {
            const keys = Object.keys(parsed);
            if (keys.length === 0) return '{}';

            if (keys.length === 1) {
                const key = keys[0];
                const value = parsed[key];
                const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
                const result = `${key}: ${valueStr}`;
                return result.length > maxLength ? result.slice(0, maxLength) + '...' : result;
            }

            // 多个参数，显示关键信息
            const preview = keys
                .slice(0, 2)
                .map((k) => {
                    const v = parsed[k];
                    const vStr = typeof v === 'string' ? v : JSON.stringify(v);
                    return `${k}: ${vStr.slice(0, 20)}`;
                })
                .join(', ');

            const more = keys.length > 2 ? ` +${keys.length - 2} more` : '';
            return (preview + more).slice(0, maxLength);
        }

        return args.slice(0, maxLength);
    } catch {
        return args.slice(0, maxLength);
    }
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
            lines.push(`${indent}${COLORS.muted}⏳ 思考中...${COLORS.reset}`);
            break;

        case AgentMessageType.REASONING_DELTA:
        case 'reasoning-delta':
            // 子 Agent 的思考内容不输出，保持简洁
            break;

        case AgentMessageType.REASONING_COMPLETE:
        case 'reasoning-complete':
            lines.push(`${indent}${COLORS.success}✓${COLORS.reset} ${COLORS.muted}思考完成${COLORS.reset}`);
            break;

        case AgentMessageType.TEXT_START:
        case 'text-start':
            break;

        case AgentMessageType.TEXT_DELTA:
        case 'text-delta':
            if (payload.content) {
                const content = payload.content as string;
                const contentLines = content.split('\n');
                for (const cline of contentLines) {
                    if (cline.trim()) {
                        lines.push(`${indent}${cline}`);
                    }
                }
            }
            break;

        case AgentMessageType.TEXT_COMPLETE:
        case 'text-complete':
            break;

        case AgentMessageType.TOOL_CALL_CREATED:
        case 'tool_call_created': {
            const toolCalls = (payload.tool_calls || []) as Array<{ toolName: string; args: string }>;
            for (const call of toolCalls) {
                const icon = getToolIcon(call.toolName);
                const argsFormatted = formatToolArgs(call.args, 50);
                lines.push(`${indent}${icon} ${color}${call.toolName}${COLORS.reset}`);
                if (argsFormatted) {
                    lines.push(`${indent}  ${COLORS.muted}${argsFormatted}${COLORS.reset}`);
                }
            }
            break;
        }

        case AgentMessageType.TOOL_CALL_RESULT:
        case 'tool_call_result': {
            const status = payload.status === 'success' ? `${COLORS.success}✓` : `${COLORS.error}✗`;
            const result = payload.result;
            let resultPreview: string;
            if (typeof result === 'string') {
                resultPreview = result.slice(0, 60).replace(/\n/g, ' ');
            } else {
                resultPreview = JSON.stringify(result || {}).slice(0, 60);
            }
            const more =
                (typeof result === 'string' ? result.length : JSON.stringify(result || {}).length) > 60 ? '...' : '';

            if (resultPreview.trim()) {
                lines.push(`${indent}${status}${COLORS.reset} ${COLORS.muted}${resultPreview}${more}${COLORS.reset}`);
            } else {
                lines.push(`${indent}${status}${COLORS.reset}`);
            }
            break;
        }

        case AgentMessageType.STATUS:
        case 'status': {
            const state = payload.state as string | undefined;
            // 只显示重要状态
            if (state && ['completed', 'failed', 'aborted'].includes(state)) {
                const statusIcons: Record<string, string> = {
                    completed: `${COLORS.success}✓${COLORS.reset}`,
                    failed: `${COLORS.error}✗${COLORS.reset}`,
                    aborted: '🛑',
                };
                const icon = statusIcons[state] || '•';
                lines.push(`${indent}${icon} ${COLORS.muted}${state}${COLORS.reset}`);
            }
            break;
        }

        case AgentMessageType.USAGE_UPDATE:
        case 'usage_update': {
            // 子 Agent 的 token 使用量不显示，避免信息过载
            break;
        }

        case AgentMessageType.ERROR:
        case 'error':
            lines.push(`${indent}${COLORS.error}✗ ${payload.error}${COLORS.reset}`);
            break;

        case AgentMessageType.CODE_PATCH:
        case 'code_patch':
            lines.push(`${indent}${COLORS.secondary}📝 ${payload.path}${COLORS.reset}`);
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
        const color = getSubagentColor(buffer.colorIndex);
        process.stdout.write(
            `\r${COLORS.muted}⏳ 子任务 #${taskNum}${COLORS.reset} ${color}${subagent_type}${COLORS.reset} ${COLORS.muted}启动中...${COLORS.reset}`
        );
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
        buffer.status === 'completed' ? `${COLORS.success}✓` : buffer.status === 'failed' ? `${COLORS.error}✗` : '🛑';

    // 头部 - 更简洁的设计
    process.stdout.write('');
    process.stdout.write(
        `${COLORS.muted}┌─ 子任务 #${taskNum}${COLORS.reset} ${color}${buffer.subagentType}${COLORS.reset} ${statusIcon}${COLORS.reset} ${COLORS.muted}${elapsed}${COLORS.reset}`
    );

    // 输出缓冲的内容（过滤掉空行和重复的状态行）
    const seenStatusLines = new Set<string>();
    let hasContent = false;

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

        if (!hasContent) {
            hasContent = true;
        }

        process.stdout.write(`${COLORS.muted}│${COLORS.reset} ${line}`);
    }

    // 底部
    process.stdout.write(`${COLORS.muted}└─${COLORS.reset}`);
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
            isInReasoningBlock = true;
            process.stdout.write(`\n${indent}${COLORS.muted}💭 思考中...${COLORS.reset}\n`);
            break;

        case AgentMessageType.REASONING_DELTA:
            // 输出思考内容，使用弱化的颜色
            process.stdout.write(`${COLORS.dim}${message.payload.content}${COLORS.reset}`);
            break;

        case AgentMessageType.REASONING_COMPLETE:
            isInReasoningBlock = false;
            process.stdout.write(
                `\n${indent}${COLORS.success}✓${COLORS.reset} ${COLORS.muted}思考完成${COLORS.reset}\n`
            );
            break;

        // ==================== 正式文本回复 ====================
        case AgentMessageType.TEXT_START:
            if (!isInTextBlock) {
                process.stdout.write(`\n${indent}${COLORS.primary}━━━ 回复 ━━━${COLORS.reset}\n`);
                isInTextBlock = true;
            }
            break;

        case AgentMessageType.TEXT_DELTA:
            process.stdout.write(message.payload.content);
            break;

        case AgentMessageType.TEXT_COMPLETE:
            process.stdout.write('\n');
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

            process.stdout.write(`\n${indent}${COLORS.primary}━━━ 工具调用 ━━━${COLORS.reset}\n`);

            for (const call of tools) {
                const icon = getToolIcon(call.toolName);
                const argsFormatted = formatToolArgs(call.args, 60);

                process.stdout.write(`${indent}${icon} ${COLORS.bold}${COLORS.info}${call.toolName}${COLORS.reset}`);
                if (argsFormatted) {
                    process.stdout.write(`${indent}  ${COLORS.muted}${argsFormatted}${COLORS.reset}`);
                }
            }
            console.log('');
            break;
        }

        case AgentMessageType.TOOL_CALL_RESULT: {
            const status =
                message.payload.status === 'success'
                    ? `${COLORS.success}✓${COLORS.reset}`
                    : `${COLORS.error}✗${COLORS.reset}`;
            const result = message.payload.result;
            let resultPreview: string;

            if (typeof result === 'string') {
                resultPreview = result.slice(0, 100).replace(/\n/g, ' ');
            } else {
                resultPreview = JSON.stringify(result || {}).slice(0, 100);
            }
            const more =
                (typeof result === 'string' ? result.length : JSON.stringify(result || {}).length) > 100 ? '...' : '';

            console.log(`${indent}${status} ${COLORS.muted}结果${COLORS.reset}`);
            if (resultPreview.trim()) {
                console.log(`${indent}  ${COLORS.muted}${resultPreview}${more}${COLORS.reset}`);
            }
            console.log('');
            break;
        }

        // ==================== 状态更新 ====================
        case AgentMessageType.STATUS: {
            const state = message.payload.state;
            // 在 thinking 过程中，跳过 running/thinking 状态，避免覆盖 loading 动画
            if (isInReasoningBlock && (state === 'thinking' || state === 'running')) {
                break;
            }
            const signature = `${indent}|${state}|${message.payload.message || ''}|${message.payload.meta?.retry?.attempt || 0}`;
            if (signature === lastStatusSignature) {
                break;
            }
            lastStatusSignature = signature;

            const statusIcons: Record<string, string> = {
                idle: '⏸',
                thinking: '●',
                running: '●',
                completed: `${COLORS.success}✓${COLORS.reset}`,
                failed: `${COLORS.error}✗${COLORS.reset}`,
                aborted: '🛑',
                retrying: '🔄',
            };
            const icon = statusIcons[state] || '•';
            const msg = message.payload.message ? ` ${message.payload.message}` : '';

            // 只在重要状态时输出
            if (['completed', 'failed', 'aborted', 'retrying'].includes(state)) {
                console.log(`${indent}${icon} ${COLORS.muted}${state}${msg}${COLORS.reset}`);
            }
            break;
        }

        // ==================== Token 使用量更新 ====================
        case AgentMessageType.USAGE_UPDATE: {
            const usage = message.payload.usage;
            const cumulative = message.payload.cumulative;

            let usageText = `${indent}${COLORS.muted}📊 Tokens: ${usage.total_tokens}`;

            if (cumulative) {
                usageText += ` | 累计: ${cumulative.total_tokens}${COLORS.reset}`;
            } else {
                usageText += `${COLORS.reset}`;
            }

            process.stdout.write(usageText);
            break;
        }

        // ==================== 错误处理 ====================
        case AgentMessageType.ERROR:
            console.error(`\n${indent}${COLORS.error}✗ 错误${COLORS.reset}`);
            console.error(`${indent}  ${message.payload.error}`);
            if (message.payload.phase) {
                console.error(`${indent}  ${COLORS.muted}阶段: ${message.payload.phase}${COLORS.reset}`);
            }
            console.log('');
            break;

        // ==================== 代码补丁 ====================
        case AgentMessageType.CODE_PATCH:
            process.stdout.write(`${indent}${COLORS.secondary}📝 ${message.payload.path}${COLORS.reset}`);
            if (message.payload.language) {
                process.stdout.write(`${indent}  ${COLORS.muted}${message.payload.language}${COLORS.reset}`);
            }
            break;
        case AgentMessageType.PERMISSION_REQUEST:
            queuePermissionDecision(message as PermissionRequestMessage);
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
        case AgentMessageType.PERMISSION_REQUEST:
            queuePermissionDecision(message as PermissionRequestMessage);
            break;

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
 * 打印用户输入框（支持多模态内容）
 */
function printUserInput(query: string, parsedInput?: ParsedFileInput) {
    const maxLineLen = 80;
    const lines: string[] = [];

    // 使用解析后的文本（已去除文件路径）
    const displayText = parsedInput?.text || query;

    // 分行长文本
    const words = displayText.split('');
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

    console.log('');
    console.log(`${COLORS.primary}┌─ 用户输入 ─────────────────────────────────────────────${COLORS.reset}`);

    for (const line of lines) {
        console.log(`${COLORS.primary}│${COLORS.reset} ${line}`);
    }

    // 显示附件信息
    if (parsedInput && parsedInput.contentParts.length > 0) {
        const fileSummary = createFileSummary(parsedInput.contentParts);
        if (fileSummary) {
            console.log(`${COLORS.primary}│${COLORS.reset} ${COLORS.muted}📎 ${fileSummary}${COLORS.reset}`);
        }
    }

    console.log(`${COLORS.primary}└────────────────────────────────────────────────────────${COLORS.reset}`);
    console.log('');

    // 显示解析错误
    if (parsedInput && parsedInput.errors.length > 0) {
        process.stdout.write(`${COLORS.warning}⚠ 文件解析警告:${COLORS.reset}`);
        for (const error of parsedInput.errors) {
            process.stdout.write(`  ${COLORS.warning}•${COLORS.reset} ${error}`);
        }
        console.log('');
    }
}

/**
 * 打印会话信息
 */
function printSessionInfo(sessionId: string, messageCount: number, restored: boolean = false) {
    console.log('');
    console.log(`${COLORS.primary}┌─ 会话信息 ─────────────────────────────────────────────${COLORS.reset}`);
    console.log(`${COLORS.primary}│${COLORS.reset} ${COLORS.muted}会话 ID:${COLORS.reset} ${sessionId}`);
    console.log(`${COLORS.primary}│${COLORS.reset} ${COLORS.muted}消息数:${COLORS.reset} ${messageCount}`);
    if (restored) {
        console.log(`${COLORS.primary}│${COLORS.reset} ${COLORS.success}✓ 已恢复历史会话${COLORS.reset}`);
    }
    console.log(`${COLORS.primary}└────────────────────────────────────────────────────────${COLORS.reset}`);
    console.log('');
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
    console.log(`${COLORS.success}┌─ 执行完成 ─────────────────────────────────────────────${COLORS.reset}`);

    if (response.finish_reason) {
        const reasonIcons: Record<string, string> = {
            stop: '✓',
            tool_calls: '🔧',
            length: '📏',
            content_filter: '🚫',
        };
        const reasonColors: Record<string, string> = {
            stop: COLORS.success,
            tool_calls: COLORS.info,
            length: COLORS.warning,
            content_filter: COLORS.error,
        };
        const icon = reasonIcons[response.finish_reason] || '•';
        const reasonColor = reasonColors[response.finish_reason] || COLORS.white;
        console.log(`${COLORS.success}│${COLORS.reset} ${reasonColor}${icon} ${response.finish_reason}${COLORS.reset}`);
    }

    if (response.usage) {
        console.log(`${COLORS.success}│${COLORS.reset} ${COLORS.muted}📊 Token 使用:${COLORS.reset}`);
        console.log(
            `${COLORS.success}│${COLORS.reset}   ${COLORS.muted}输入: ${response.usage.prompt_tokens} | 输出: ${response.usage.completion_tokens} | 总计: ${COLORS.info}${response.usage.total_tokens}${COLORS.reset}`
        );
    }

    console.log(`${COLORS.success}└────────────────────────────────────────────────────────${COLORS.reset}`);
    console.log('');
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
                console.error(`${COLORS.error}✗ 错误:${COLORS.reset} --session-id 需要提供一个会话 ID`);
                process.exit(1);
            }
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
${COLORS.primary}╔═══════════════════════════════════════════════════════╗${COLORS.reset}
${COLORS.primary}║${COLORS.reset}  ${COLORS.bold}${COLORS.info}Agent Demo - 使用帮助${COLORS.reset}                        ${COLORS.primary}║${COLORS.reset}
${COLORS.primary}╚═══════════════════════════════════════════════════════╝${COLORS.reset}

${COLORS.info}用法:${COLORS.reset}
  pnpm demo1 [选项] [问题]

${COLORS.info}选项:${COLORS.reset}
  ${COLORS.success}-s, --session-id <id>${COLORS.reset}  指定会话 ID，用于恢复之前的会话
  ${COLORS.success}-h, --help${COLORS.reset}             显示此帮助信息

${COLORS.info}多模态支持:${COLORS.reset}
  在问题中使用 ${COLORS.warning}@文件路径${COLORS.reset} 来附加文件（图片/视频/文档）
  
  ${COLORS.muted}支持的图片格式:${COLORS.reset} jpg, jpeg, png, gif, webp, bmp, svg
  ${COLORS.muted}支持的视频格式:${COLORS.reset} mp4, mov, webm, avi, mkv
  ${COLORS.muted}其他文件将作为附件发送${COLORS.reset}

${COLORS.info}示例:${COLORS.reset}
  ${COLORS.muted}# 基础使用${COLORS.reset}
  pnpm demo1 "分析当前项目结构"
  
  ${COLORS.muted}# 多模态输入${COLORS.reset}
  pnpm demo1 "这张图片里有什么? @./screenshot.png"
  pnpm demo1 "分析这个 PDF 文件 @./document.pdf"
  
  ${COLORS.muted}# 会话恢复${COLORS.reset}
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
    currentAgent = undefined;
    permissionPromptChain = Promise.resolve();

    // 解析命令行参数
    const { sessionId: cliSessionId, query: cliQuery } = parseCliArgs();

    // 打印标题
    console.log('');
    console.log(`${COLORS.primary}╔═══════════════════════════════════════════════════════╗${COLORS.reset}`);
    console.log(
        `${COLORS.primary}║${COLORS.reset}  ${COLORS.bold}${COLORS.info}Agent Demo${COLORS.reset}  ${COLORS.muted}Thinking 模式 • 子 Agent 可视化${COLORS.reset}  ${COLORS.primary}║${COLORS.reset}`
    );
    console.log(`${COLORS.primary}╚═══════════════════════════════════════════════════════╝${COLORS.reset}`);
    console.log('');

    if (cliSessionId) {
        console.log(`${COLORS.warning}◆ 恢复会话${COLORS.reset} ${COLORS.muted}${cliSessionId}${COLORS.reset}\n`);
    }

    const preferredMemoryPath =
        platform() === 'win32'
            ? 'D:/work/coding-agent-data/agent-memory'
            : '/Users/wrr/work/coding-agent-data/agent-memory';

    fs.mkdirSync(preferredMemoryPath, { recursive: true });
    fs.accessSync(preferredMemoryPath, fs.constants.W_OK);

    const memoryManager = createMemoryManager({
        type: 'file',
        // connectionString: preferredMemoryPath,
    });

    await memoryManager.initialize();

    let agent: Agent | undefined;
    let mcpManager: McpManager | undefined;
    try {
        // MCP 由 demo 外部初始化，再注入 Agent。
        const mcpConfigPath = process.env.MCP_CONFIG_PATH;
        mcpManager = await initializeMcp(undefined, mcpConfigPath);
        const connectedServers = mcpManager.getConnectedServers();
        const totalMcpTools = mcpManager.getTotalToolsCount();
        if (totalMcpTools > 0) {
            console.log(
                `${COLORS.success}◆ MCP 初始化成功${COLORS.reset} ${COLORS.muted}(servers: ${connectedServers.length}, tools: ${totalMcpTools})${COLORS.reset}`
            );
        } else {
            const connectionInfo = mcpManager.getConnectionInfo();
            const searchTargets = mcpConfigPath ? [mcpConfigPath] : getConfigSearchPaths();
            console.log(`${COLORS.warning}◆ MCP 已初始化但未加载到工具${COLORS.reset}`);
            console.log(
                `${COLORS.muted}  已连接服务: ${connectedServers.length}，MCP 工具数: ${totalMcpTools}${COLORS.reset}`
            );
            if (connectionInfo.length > 0) {
                console.log(`${COLORS.muted}  连接详情:${COLORS.reset}`);
                for (const info of connectionInfo) {
                    const errorSuffix = info.error ? `, error: ${info.error}` : '';
                    console.log(
                        `${COLORS.muted}    - ${info.serverName}: state=${info.state}, tools=${info.toolsCount}${errorSuffix}${COLORS.reset}`
                    );
                }
            }
            console.log(`${COLORS.muted}  请检查 MCP 配置路径:${COLORS.reset}`);
            for (const target of searchTargets) {
                console.log(`${COLORS.muted}    - ${target}${COLORS.reset}`);
            }
        }

        agent = new Agent({
            provider: ProviderRegistry.createFromEnv(model, {
                temperature: 0.1,
                tool_stream: true,
            }),
            systemPrompt: operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
            }),
            requestTimeout: parseRequestTimeoutMs(process.env.AGENT_REQUEST_TIMEOUT_MS),
            ...(cliSessionId ? { sessionId: cliSessionId } : {}),
            stream: true,

            thinking: true,
            idleTimeout: 1000 * 60 * 5,
            enableCompaction: true,
            compactionConfig: {
                keepMessagesNum: 20,
                triggerRatio: 0.9,
            },
            memoryManager,
            mcpManager,
            permissionDecisionMode: 'event',
            streamCallback: handleStreamMessage,
        });
        currentAgent = agent;
        await agent.initialize();

        // 执行查询
        let query = cliQuery;

        if (!query) {
            query = fs.readFileSync(path.join(process.cwd(), 'src/query.text'), 'utf-8');
        }

        if (query.trim().length === 0) {
            console.error(`${COLORS.error}✗ 错误:${COLORS.reset} 查询内容不能为空`);
            process.exit(1);
        }

        // 解析用户输入中的文件路径（支持多模态）
        const parsedInput = parseFilePaths(query, process.cwd());

        // 打印用户输入（包含文件附件信息）
        printUserInput(query, parsedInput);

        // 构建执行内容：如果有文件，使用多模态格式；否则使用纯文本
        let executeContent: string | InputContentPart[];
        if (parsedInput.contentParts.length > 0) {
            // 使用多模态内容
            executeContent = parsedInput.contentParts;
            console.log(`${COLORS.info}◆ 已附加 ${parsedInput.contentParts.length - 1} 个文件${COLORS.reset}\n`);
        } else {
            // 使用纯文本
            executeContent = query;
        }

        const response = await agent.execute(executeContent);

        // 兜底：刷新所有未完成的子 Agent 缓冲区
        flushAllPendingBuffers();

        // 打印最终响应
        printFinalResponse(response);

        // 输出会话信息
        printSessionInfo(agent.getSessionId(), agent.getMessages().length, !!cliSessionId);
    } catch (error) {
        console.error(`\n${COLORS.error}╔═══════════════════════════════════════════════════════╗${COLORS.reset}`);
        console.error(
            `${COLORS.error}║${COLORS.reset}  ${COLORS.bold}执行失败${COLORS.reset}                                        ${COLORS.error}║${COLORS.reset}`
        );
        console.error(`${COLORS.error}╚═══════════════════════════════════════════════════════╝${COLORS.reset}\n`);
        console.error(error);
    } finally {
        currentAgent = undefined;
        await memoryManager.close();
        await agent?.close();
        if (mcpManager) {
            await disconnectMcp();
        }
    }
}

demo1().catch((error) => {
    console.error(`\n${COLORS.error}✗ 未捕获异常:${COLORS.reset}`, error);
    process.exit(1);
});
