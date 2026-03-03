import path from 'path';
import { parse } from 'shell-quote';

export type BashPolicyMode = 'guarded' | 'permissive';
export type BashPolicyEffect = 'allow' | 'ask' | 'deny';

export interface BashDangerousPattern {
    pattern: RegExp;
    reason: string;
}

export interface EvaluateBashPolicyOptions {
    platform?: NodeJS.Platform;
    mode?: BashPolicyMode;
    allowlistMissEffect?: Extract<BashPolicyEffect, 'ask' | 'deny'>;
    allowlistMissReason?: (commandName: string) => string;
    allowlistBypassed?: boolean;
}

export interface EvaluateBashPolicyResult {
    effect: BashPolicyEffect;
    reason?: string;
    commands: string[];
}

const COMMON_DANGEROUS_COMMANDS = new Set([
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

const WINDOWS_DANGEROUS_COMMANDS = new Set(['format', 'diskpart', 'bcdedit', 'vssadmin', 'wbadmin', 'reg', 'sc']);

const COMMON_ALLOWED_COMMANDS = new Set([
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
    'chmod',
    'chown',
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

const WINDOWS_ALLOWED_COMMANDS = new Set([
    'dir',
    'type',
    'more',
    'findstr',
    'where',
    'copy',
    'move',
    'attrib',
    'icacls',
    'mklink',
    'powershell',
    'pwsh',
    'cmd',
]);

const MACOS_ALLOWED_COMMANDS = new Set(['open', 'pbcopy', 'pbpaste']);

const COMMON_DANGEROUS_PATTERNS: BashDangerousPattern[] = [
    { pattern: /\brm\s+-rf\s+\/(\s|$)/i, reason: 'Refusing destructive root deletion command' },
    { pattern: /\brm\s+-rf\s+--no-preserve-root\b/i, reason: 'Refusing destructive root deletion command' },
    { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'Refusing fork bomb pattern' },
    { pattern: /\b(curl|wget)[^|\n]*\|\s*(sh|bash|zsh)\b/i, reason: 'Refusing remote script pipe execution' },
    { pattern: /\b(eval|source)\s+<\s*\((curl|wget)\b/i, reason: 'Refusing remote script evaluation' },
    { pattern: /\b(dd)\s+[^|\n]*\bof=\/dev\/(sd|disk|nvme|rdisk)/i, reason: 'Refusing raw disk write command' },
    {
        pattern:
            />{1,2}\s*\/(etc|bin|sbin|usr|boot|proc|sys)\b|>{1,2}\s*\/dev(?:\/(?!null\b|stdout\b|stderr\b)[^\s;|&]+|(?=[\s;|&]|$))/i,
        reason: 'Refusing write redirection to protected system path',
    },
    {
        pattern:
            /\btee\s+\/(etc|bin|sbin|usr|boot|proc|sys)\b|\btee\s+\/dev(?:\/(?!null\b|stdout\b|stderr\b)[^\s;|&]+|(?=[\s;|&]|$))/i,
        reason: 'Refusing write to protected system path',
    },
    { pattern: /\b(sh|bash|zsh)\s+-[lc]\b/i, reason: 'Nested shell execution is blocked by policy' },
];

const WINDOWS_DANGEROUS_PATTERNS: BashDangerousPattern[] = [
    {
        pattern: /\b(rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\\s*$/i,
        reason: 'Refusing recursive drive root deletion command',
    },
    {
        pattern: /\b(del|erase)\s+\/[a-z]*\s+[a-z]:\\\*\s*$/i,
        reason: 'Refusing destructive drive wildcard deletion command',
    },
    {
        pattern: />{1,2}\s*[a-z]:\\(windows|program files|programdata)\\?/i,
        reason: 'Refusing write redirection to protected Windows path',
    },
    {
        pattern: /\breg\s+(add|delete)\s+hk(lm|cu)\\(software|system)(\\|$)/i,
        reason: 'Refusing registry mutation on critical hive',
    },
];

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set(['.exe', '.cmd', '.bat', '.com']);

function normalizeCommandToken(token: string): string {
    const trimmed = token.trim();
    if (!trimmed) return '';
    const unixLikePath = trimmed.replace(/\\/g, '/');
    const basename = path.posix.basename(unixLikePath);
    const lower = basename.toLowerCase();
    const ext = path.posix.extname(lower);
    if (WINDOWS_EXECUTABLE_EXTENSIONS.has(ext)) {
        return lower.slice(0, -ext.length);
    }
    return lower;
}

export function extractSegmentCommands(command: string): string[] {
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

        if (typeof token !== 'string' || !expectingCommand) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
            continue;
        }

        const normalized = normalizeCommandToken(token);
        if (normalized) {
            commands.push(normalized);
            expectingCommand = false;
        }
    }

    return commands;
}

export function getBashAllowedCommands(platform: NodeJS.Platform = process.platform): Set<string> {
    const commands = new Set(COMMON_ALLOWED_COMMANDS);
    if (platform === 'win32') {
        for (const command of WINDOWS_ALLOWED_COMMANDS) {
            commands.add(command);
        }
    }
    if (platform === 'darwin') {
        for (const command of MACOS_ALLOWED_COMMANDS) {
            commands.add(command);
        }
    }
    return commands;
}

export function getBashDangerousCommands(platform: NodeJS.Platform = process.platform): Set<string> {
    const commands = new Set(COMMON_DANGEROUS_COMMANDS);
    if (platform === 'win32') {
        for (const command of WINDOWS_DANGEROUS_COMMANDS) {
            commands.add(command);
        }
    }
    return commands;
}

export function getBashDangerousPatterns(platform: NodeJS.Platform = process.platform): BashDangerousPattern[] {
    if (platform === 'win32') {
        return [...COMMON_DANGEROUS_PATTERNS, ...WINDOWS_DANGEROUS_PATTERNS];
    }
    return [...COMMON_DANGEROUS_PATTERNS];
}

export function evaluateBashPolicy(command: string, options: EvaluateBashPolicyOptions = {}): EvaluateBashPolicyResult {
    const normalizedCommand = command.trim();
    const mode = options.mode ?? 'guarded';
    const allowlistMissEffect = options.allowlistMissEffect ?? 'deny';
    const allowlistMissReason =
        options.allowlistMissReason ??
        ((commandName: string) =>
            `Command "${commandName}" is not in allowed command list (set BASH_TOOL_POLICY=permissive to bypass)`);
    const platform = options.platform ?? process.platform;

    if (!normalizedCommand) {
        return { effect: 'allow', commands: [] };
    }

    for (const rule of getBashDangerousPatterns(platform)) {
        if (rule.pattern.test(normalizedCommand)) {
            return {
                effect: 'deny',
                reason: rule.reason,
                commands: [],
            };
        }
    }

    const commands = extractSegmentCommands(normalizedCommand);
    if (commands.length === 0) {
        return {
            effect: 'deny',
            reason: 'Unable to parse executable command',
            commands: [],
        };
    }

    const dangerousCommands = getBashDangerousCommands(platform);
    for (const cmd of commands) {
        if (dangerousCommands.has(cmd)) {
            return {
                effect: 'deny',
                reason: `Command "${cmd}" is blocked by security policy`,
                commands,
            };
        }
    }

    if (mode === 'guarded' && !options.allowlistBypassed) {
        const allowedCommands = getBashAllowedCommands(platform);
        for (const cmd of commands) {
            if (!allowedCommands.has(cmd)) {
                return {
                    effect: allowlistMissEffect,
                    reason: allowlistMissReason(cmd),
                    commands,
                };
            }
        }
    }

    return { effect: 'allow', commands };
}
