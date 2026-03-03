import { parse } from 'shell-quote';
import { BLOCKED_TOOL_PATTERNS, READ_ONLY_TOOLS } from '../plan/plan-mode';
import type { PermissionRule, PermissionRequest } from './permission-engine';

const BASH_DANGEROUS_COMMANDS = new Set([
    'sudo',
    'su',
    'passwd',
    'visudo',
    'useradd',
    'userdel',
    'groupadd',
    'groupdel',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'mkfs',
    'fdisk',
    'diskutil',
    'mount',
    'umount',
    'systemctl',
    'service',
    'launchctl',
]);

const BASH_ALLOWED_COMMANDS = new Set([
    'agent-browser',
    'ls',
    'pwd',
    'cat',
    'head',
    'tail',
    'echo',
    'printf',
    'wc',
    'sort',
    'uniq',
    'cut',
    'awk',
    'sed',
    'grep',
    'egrep',
    'fgrep',
    'rg',
    'find',
    'stat',
    'du',
    'df',
    'tree',
    'which',
    'whereis',
    'dirname',
    'basename',
    'realpath',
    'readlink',
    'file',
    'env',
    'printenv',
    'date',
    'uname',
    'whoami',
    'id',
    'hostname',
    'ps',
    'top',
    'uptime',
    'git',
    'npm',
    'pnpm',
    'yarn',
    'bun',
    'node',
    'npx',
    'tsx',
    'ts-node',
    'python',
    'python3',
    'pip',
    'pip3',
    'uv',
    'poetry',
    'pytest',
    'go',
    'cargo',
    'rustc',
    'javac',
    'java',
    'mvn',
    'gradle',
    'dotnet',
    'docker',
    'docker-compose',
    'kubectl',
    'helm',
    'make',
    'cmake',
    'ninja',
    'cp',
    'mv',
    'mkdir',
    'touch',
    'ln',
    'rm',
    'rmdir',
    'chmod',
    'chown',
    'del',
    'rd',
    'erase',
    'tar',
    'zip',
    'unzip',
    'gzip',
    'gunzip',
    'sh',
    'bash',
    'zsh',
    'true',
    'false',
    'test',
    'cd',
    'export',
    'unset',
    'set',
    'source',
]);

const BASH_DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\brm\s+-rf\s+\/(\s|$)/i, reason: 'Refusing destructive root deletion command' },
    { pattern: /\brm\s+-rf\s+--no-preserve-root\b/i, reason: 'Refusing destructive root deletion command' },
    { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'Refusing fork bomb pattern' },
    { pattern: /\b(curl|wget)[^|\n]*\|\s*(sh|bash|zsh)\b/i, reason: 'Refusing remote script pipe execution' },
    { pattern: /\b(eval|source)\s+<\s*\((curl|wget)\b/i, reason: 'Refusing remote script evaluation' },
    { pattern: /\b(dd)\s+[^|\n]*\bof=\/dev\/(sd|disk|nvme|rdisk)/i, reason: 'Refusing raw disk write command' },
    {
        pattern: />{1,2}\s*\/(etc|bin|sbin|usr|boot|dev|proc|sys)\b/i,
        reason: 'Refusing write redirection to protected system path',
    },
    { pattern: /\btee\s+\/(etc|bin|sbin|usr|boot|dev|proc|sys)\b/i, reason: 'Refusing write to protected system path' },
    { pattern: /\b(sh|bash|zsh)\s+-[lc]\b/i, reason: 'Nested shell execution is blocked by policy' },
];

function parseToolList(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function getToolName(request: PermissionRequest): string {
    return (request.toolCall.function?.name || '').trim();
}

function parseToolCallArgs(request: PermissionRequest): Record<string, unknown> | null {
    const raw = request.toolCall.function?.arguments || '';
    if (!raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function getBashPolicyMode(): 'guarded' | 'permissive' {
    return (process.env.BASH_TOOL_POLICY || 'guarded').toLowerCase() === 'permissive' ? 'permissive' : 'guarded';
}

function extractSegmentCommands(command: string): string[] {
    const tokens = parse(command);
    const commands: string[] = [];
    let expectingCommand = true;

    for (const token of tokens) {
        if (typeof token === 'object' && token !== null && 'op' in token) {
            const op = String(token.op || '');
            if (op === '|' || op === '||' || op === '&&' || op === ';' || op === '&' || op === '\n') {
                expectingCommand = true;
            }
            continue;
        }

        if (typeof token !== 'string') {
            continue;
        }

        if (!expectingCommand) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
            continue;
        }

        commands.push(token);
        expectingCommand = false;
    }

    return commands;
}

function evaluateLegacyBashPolicy(request: PermissionRequest): { deny: boolean; reason?: string } {
    if (getToolName(request) !== 'bash') {
        return { deny: false };
    }

    const args = parseToolCallArgs(request);
    if (!args) {
        return { deny: true, reason: 'Invalid bash arguments payload' };
    }

    const command = typeof args.command === 'string' ? args.command.trim() : '';
    if (!command) {
        return { deny: false };
    }

    for (const rule of BASH_DANGEROUS_PATTERNS) {
        if (rule.pattern.test(command)) {
            return { deny: true, reason: rule.reason };
        }
    }

    const commands = extractSegmentCommands(command);
    if (commands.length === 0) {
        return { deny: true, reason: 'Unable to parse executable command' };
    }

    for (const cmd of commands) {
        if (BASH_DANGEROUS_COMMANDS.has(cmd)) {
            return { deny: true, reason: `Command "${cmd}" is blocked by security policy` };
        }
    }

    if (getBashPolicyMode() === 'guarded') {
        for (const cmd of commands) {
            if (!BASH_ALLOWED_COMMANDS.has(cmd)) {
                return {
                    deny: true,
                    reason: `Command "${cmd}" is not in allowed command list (set BASH_TOOL_POLICY=permissive to bypass)`,
                };
            }
        }
    }

    return { deny: false };
}

export interface DefaultPolicySourceOptions {
    /**
     * 是否启用 legacy Plan Mode 静态策略源。
     * 默认 false，Plan Mode 限制由工具注册表和工具自身策略承载。
     */
    includeLegacyPlanModePolicy?: boolean;
}

/**
 * 环境变量策略源：
 * - AGENT_PERMISSION_DENY_TOOLS
 * - AGENT_PERMISSION_ASK_TOOLS
 * - AGENT_PERMISSION_ALLOW_TOOLS
 */
export function createEnvPermissionRules(): PermissionRule[] {
    const denyTools = parseToolList(process.env.AGENT_PERMISSION_DENY_TOOLS);
    const askTools = parseToolList(process.env.AGENT_PERMISSION_ASK_TOOLS);
    const allowTools = parseToolList(process.env.AGENT_PERMISSION_ALLOW_TOOLS);

    const rules: PermissionRule[] = [];
    for (const tool of denyTools) {
        rules.push({
            effect: 'deny',
            tool,
            source: 'env',
            reason: `Tool "${tool}" denied by AGENT_PERMISSION_DENY_TOOLS`,
        });
    }
    for (const tool of askTools) {
        rules.push({
            effect: 'ask',
            tool,
            source: 'env',
            reason: `Tool "${tool}" requires approval by AGENT_PERMISSION_ASK_TOOLS`,
        });
    }
    for (const tool of allowTools) {
        rules.push({
            effect: 'allow',
            tool,
            source: 'env',
            reason: `Tool "${tool}" explicitly allowed by AGENT_PERMISSION_ALLOW_TOOLS`,
        });
    }
    return rules;
}

/**
 * Legacy Bash 策略源：
 * 把 bash 工具内部的静态策略保留为统一权限层前置规则。
 */
export function createLegacyBashPermissionRules(): PermissionRule[] {
    return [
        {
            effect: 'deny',
            source: 'legacy_bash',
            tool: 'bash',
            when: (request) => evaluateLegacyBashPolicy(request).deny,
            reason: (request) =>
                evaluateLegacyBashPolicy(request).reason || 'Bash command is blocked by legacy policy source',
        },
    ];
}

/**
 * Legacy Plan Mode 策略源（默认不启用）：
 * 仅用于兼容极端场景，正常应由 plan 工具注册表限制负责。
 */
export function createLegacyPlanModePermissionRules(): PermissionRule[] {
    return [
        {
            effect: 'deny',
            source: 'legacy_plan_mode',
            when: (request) => {
                if (!request.planMode) return false;
                const toolName = getToolName(request);
                for (const pattern of BLOCKED_TOOL_PATTERNS) {
                    if (pattern.test(toolName)) return true;
                }
                return !READ_ONLY_TOOLS.has(toolName);
            },
            reason: 'Tool is blocked by legacy Plan Mode policy source',
        },
    ];
}

/**
 * 默认策略源集合。
 */
export function createDefaultPolicySourceRules(options?: DefaultPolicySourceOptions): PermissionRule[] {
    const rules: PermissionRule[] = [...createEnvPermissionRules(), ...createLegacyBashPermissionRules()];
    if (options?.includeLegacyPlanModePolicy) {
        rules.push(...createLegacyPlanModePermissionRules());
    }
    return rules;
}
