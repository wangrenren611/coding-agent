import { buildSystemPrompt } from './system';
import { getDefaultTools, getPlanModeTools } from '../tool';
import type { ToolRegistry } from '../tool/registry';
import * as fs from 'fs';
import * as path from 'path';

export interface OperatorPromptOptions {
    /** 工作目录 */
    directory: string;
    /** 响应语言 */
    language?: string;
    /** 是否处于计划模式 */
    planMode?: boolean;
    /** AGENTS.md 内容 */
    agentsMd?: string;
    /** 工作目录列表 */
    directoryListing?: string;
    /** 额外目录信息 */
    additionalDirs?: string;
    /** 当前日期时间 */
    currentDateTime?: string;
    /** 运行时沙箱模式（可选） */
    sandboxMode?: string;
    /** 运行时网络策略（可选） */
    networkPolicy?: string;
    /** 运行时可用工具名（可选） */
    runtimeToolNames?: string[];
    /** 真实运行时工具注册表（可选，优先于推断） */
    toolRegistry?: Pick<ToolRegistry, 'toLLMTools'>;
    /** 是否为子代理 */
    isSubagent?: boolean;
    /** 子代理额外角色说明 */
    subagentRoleAdditional?: string;
}

const INSTRUCTION_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md'] as const;
const MAX_INSTRUCTION_FILE_CHARS = 20_000;
const MAX_INSTRUCTION_TOTAL_CHARS = 60_000;

function findRepoRoot(startDirectory: string): string {
    let current = path.resolve(startDirectory);
    while (true) {
        if (fs.existsSync(path.join(current, '.git'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return path.resolve(startDirectory);
        }
        current = parent;
    }
}

function collectInstructionFiles(directory: string): string[] {
    const repoRoot = findRepoRoot(directory);
    const found: string[] = [];
    let current = path.resolve(directory);

    while (true) {
        for (const fileName of INSTRUCTION_FILE_NAMES) {
            const fullPath = path.join(current, fileName);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                found.push(fullPath);
            }
        }
        if (current === repoRoot) {
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return found;
}

function loadInstructionContent(directory: string): string | undefined {
    const files = collectInstructionFiles(directory);
    if (files.length === 0) {
        return undefined;
    }

    const blocks: string[] = [];
    let totalChars = 0;

    for (const filePath of files) {
        if (totalChars >= MAX_INSTRUCTION_TOTAL_CHARS) {
            break;
        }
        try {
            const raw = fs.readFileSync(filePath, 'utf-8').trim();
            if (!raw) {
                continue;
            }
            const remaining = MAX_INSTRUCTION_TOTAL_CHARS - totalChars;
            const maxForThisFile = Math.min(MAX_INSTRUCTION_FILE_CHARS, remaining);
            const content = raw.length > maxForThisFile ? `${raw.slice(0, maxForThisFile)}\n...[truncated]` : raw;
            blocks.push(`Instructions from: ${filePath}\n${content}`);
            totalChars += content.length;
        } catch {
            // Ignore unreadable instruction files and keep building prompt.
        }
    }

    if (blocks.length === 0) {
        return undefined;
    }

    return blocks.join('\n\n');
}

/**
 * 从环境变量推断运行时策略（可被显式参数覆盖）
 */
function inferRuntimePolicies(): { sandboxMode?: string; networkPolicy?: string } {
    const sandboxMode =
        process.env.AGENT_SANDBOX_MODE ||
        process.env.SANDBOX_MODE ||
        process.env.CODEX_SANDBOX_MODE ||
        process.env.CLAUDE_CODE_SANDBOX_MODE;

    const networkPolicy =
        process.env.AGENT_NETWORK_POLICY ||
        process.env.NETWORK_POLICY ||
        process.env.CODEX_NETWORK_POLICY ||
        process.env.CLAUDE_CODE_NETWORK_POLICY;

    return {
        sandboxMode: sandboxMode?.trim() || undefined,
        networkPolicy: networkPolicy?.trim() || undefined,
    };
}

/**
 * 推断当前模式下的可用工具名（基于实际工具注册代码）
 */
function inferRuntimeToolNames(planMode: boolean): string[] {
    const inferred = (planMode ? getPlanModeTools() : getDefaultTools())
        .map((tool) => tool.name)
        .filter((name) => (planMode ? true : name !== 'plan_create'));
    return Array.from(new Set(inferred)).sort();
}

/**
 * 从真实 tool registry 提取工具名（与会话注册态一致）
 */
export function getRuntimeToolNamesFromRegistry(toolRegistry: Pick<ToolRegistry, 'toLLMTools'>): string[] {
    return Array.from(
        new Set(
            toolRegistry
                .toLLMTools()
                .map((tool) => tool.function.name)
                .filter((name): name is string => typeof name === 'string' && name.length > 0)
        )
    ).sort();
}

/**
 * 构建完整的 Operator 系统提示词
 */
export const operatorPrompt = (options: OperatorPromptOptions): string => {
    const inferredPolicies = inferRuntimePolicies();
    const resolvedDirectory = path.resolve(options.directory);
    const runtimeToolNames =
        options.runtimeToolNames ??
        (options.toolRegistry
            ? getRuntimeToolNamesFromRegistry(options.toolRegistry)
            : inferRuntimeToolNames(!!options.planMode));
    const agentsMd = options.agentsMd ?? loadInstructionContent(resolvedDirectory);

    // 调用系统提示词构建函数，并注入运行时能力信息（可被调用方显式覆盖）
    return buildSystemPrompt({
        ...options,
        directory: resolvedDirectory,
        agentsMd,
        sandboxMode: options.sandboxMode ?? inferredPolicies.sandboxMode,
        networkPolicy: options.networkPolicy ?? inferredPolicies.networkPolicy,
        runtimeToolNames,
    });
};
