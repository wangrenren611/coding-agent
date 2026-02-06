/**
 * Bash Tool
 *
 * 执行 bash 命令的工具，提供：
 * - 语法验证和解析
 * - 安全分析
 * - 命令执行
 */

import { BaseTool, ToolResult } from './base';
import { z } from 'zod';
import BASH_DESCRIPTION from './bash.description';
import { execaCommand } from 'execa';
import { parse } from 'shell-quote';
import stripAnsi from 'strip-ansi';
import iconv from 'iconv-lite';

const schema = z.object({
    command: z.string().min(1).describe('The bash command to run').optional(),
    timeout: z.number().int().min(0).max(600000).describe('Command timeout in milliseconds').optional(),
    // run_in_background: z.boolean().describe('Run in background').optional(),
});

type BashPolicyMode = 'guarded' | 'permissive';

interface PolicyDecision {
    allowed: boolean;
    reason?: string;
}

const DANGEROUS_COMMANDS = new Set([
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

const ALLOWED_COMMANDS = new Set([
    'ls', 'pwd', 'cat', 'head', 'tail', 'echo', 'printf', 'wc', 'sort', 'uniq', 'cut',
    'awk', 'sed', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'stat', 'du', 'df', 'tree',
    'which', 'whereis', 'dirname', 'basename', 'realpath', 'readlink', 'file', 'env', 'printenv',
    'date', 'uname', 'whoami', 'id', 'hostname', 'ps', 'top', 'uptime',
    'git', 'npm', 'pnpm', 'yarn', 'bun', 'node', 'npx', 'tsx', 'ts-node',
    'python', 'python3', 'pip', 'pip3', 'uv', 'poetry', 'pytest',
    'go', 'cargo', 'rustc', 'javac', 'java', 'mvn', 'gradle', 'dotnet',
    'docker', 'docker-compose', 'kubectl', 'helm',
    'make', 'cmake', 'ninja',
    'cp', 'mv', 'mkdir', 'touch', 'ln', 'rm', 'rmdir', 'chmod', 'chown',
    'tar', 'zip', 'unzip', 'gzip', 'gunzip',
    'sh', 'bash', 'zsh',
    'true', 'false', 'test',
    'cd', 'export', 'unset', 'set', 'source',
]);

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\brm\s+-rf\s+\/(\s|$)/i, reason: 'Refusing destructive root deletion command' },
    { pattern: /\brm\s+-rf\s+--no-preserve-root\b/i, reason: 'Refusing destructive root deletion command' },
    { pattern: /:\(\)\s*\{\s*:\|\:&\s*\};:/, reason: 'Refusing fork bomb pattern' },
    { pattern: /\b(curl|wget)[^|\n]*\|\s*(sh|bash|zsh)\b/i, reason: 'Refusing remote script pipe execution' },
    { pattern: /\b(eval|source)\s+<\s*\((curl|wget)\b/i, reason: 'Refusing remote script evaluation' },
    { pattern: /\b(dd)\s+[^|\n]*\bof=\/dev\/(sd|disk|nvme|rdisk)/i, reason: 'Refusing raw disk write command' },
    { pattern: />{1,2}\s*\/(etc|bin|sbin|usr|boot|dev|proc|sys)\b/i, reason: 'Refusing write redirection to protected system path' },
    { pattern: /\btee\s+\/(etc|bin|sbin|usr|boot|dev|proc|sys)\b/i, reason: 'Refusing write to protected system path' },
    { pattern: /\b(sh|bash|zsh)\s+-[lc]\b/i, reason: 'Nested shell execution is blocked by policy' },
];

// =============================================================================
// BashTool 类
// =============================================================================

export default class BashTool extends BaseTool<typeof schema> {
    name = 'bash';
    description = BASH_DESCRIPTION;
    schema = schema;

    /** 命令执行超时时间（毫秒），默认 60 秒 */
    timeout: number = 60000;

    private getPolicyMode(): BashPolicyMode {
        const raw = (process.env.BASH_TOOL_POLICY || 'guarded').toLowerCase();
        return raw === 'permissive' ? 'permissive' : 'guarded';
    }

    private getEffectiveTimeout(timeout?: number): number {
        return timeout ?? this.timeout;
    }

    private isBunRuntime(): boolean {
        return typeof (process as { versions?: { bun?: string } }).versions?.bun === 'string';
    }

    private async runWithNode(command: string, timeoutMs: number): Promise<{ exitCode: number; all: Buffer }> {
        const result = await execaCommand(command, {
            all: true,
            reject: false,
            shell: true,
            preferLocal: true,
            windowsHide: true,
            encoding: 'buffer',
            timeout: timeoutMs,
        });

        const all = Buffer.isBuffer(result.all)
            ? result.all
            : Buffer.from(result.all ?? '');

        return {
            exitCode: result.exitCode ?? 1,
            all,
        };
    }

    private async runWithBun(command: string, timeoutMs: number): Promise<{ exitCode: number; all: Buffer }> {
        const bun = (globalThis as { Bun?: any }).Bun;
        if (!bun || typeof bun.spawn !== 'function') {
            throw new Error('Bun runtime unavailable');
        }

        const shellCommand =
            process.platform === 'win32'
                ? ['cmd.exe', '/d', '/s', '/c', command]
                : ['/bin/bash', '-lc', command];

        const child = bun.spawn(shellCommand, {
            cwd: process.cwd(),
            env: process.env,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        });

        let killedByTimeout = false;
        const timer = setTimeout(() => {
            killedByTimeout = true;
            try {
                child.kill();
            } catch {
                // ignore kill errors
            }
        }, timeoutMs);

        try {
            const [stdoutAb, stderrAb, exitCode] = await Promise.all([
                new Response(child.stdout).arrayBuffer(),
                new Response(child.stderr).arrayBuffer(),
                child.exited,
            ]);

            const all = Buffer.concat([Buffer.from(stdoutAb), Buffer.from(stderrAb)]);
            if (killedByTimeout) {
                return {
                    exitCode: 124,
                    all: Buffer.concat([all, Buffer.from(`\nCommand timed out after ${timeoutMs}ms`)])
                };
            }

            return {
                exitCode: typeof exitCode === 'number' ? exitCode : 1,
                all,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    private extractSegmentCommands(command: string): string[] {
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

            // Environment variable assignments are not commands, e.g. FOO=bar cmd
            if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
                continue;
            }

            commands.push(token);
            expectingCommand = false;
        }

        return commands;
    }

    private validatePolicy(command: string): PolicyDecision {
        const normalized = command.trim();
        if (!normalized) {
            return { allowed: false, reason: 'Command is empty' };
        }

        for (const rule of DANGEROUS_PATTERNS) {
            if (rule.pattern.test(normalized)) {
                return { allowed: false, reason: rule.reason };
            }
        }

        const commands = this.extractSegmentCommands(normalized);
        if (commands.length === 0) {
            return { allowed: false, reason: 'Unable to parse executable command' };
        }

        for (const cmd of commands) {
            if (DANGEROUS_COMMANDS.has(cmd)) {
                return { allowed: false, reason: `Command "${cmd}" is blocked by security policy` };
            }
        }

        if (this.getPolicyMode() === 'guarded') {
            for (const cmd of commands) {
                if (!ALLOWED_COMMANDS.has(cmd)) {
                    return {
                        allowed: false,
                        reason: `Command "${cmd}" is not in allowed command list (set BASH_TOOL_POLICY=permissive to bypass)`,
                    };
                }
            }
        }

        return { allowed: true };
    }

    /**
     * 执行 bash 命令
     *
     * 错误分类：
     * - 业务错误（参数验证、安全检查）→ return { success: false, error: ... }
     * - 底层异常（执行失败）→ throw 供 Registry 捕获
     */
    async execute(args: z.infer<typeof this.schema>): Promise<ToolResult> {
        const { command, timeout, } = args;

        if (!command) {
            return this.result({
                success: false,
                metadata: { error: 'COMMAND_REQUIRED' } as any,
                output: 'COMMAND_REQUIRED: Command is required',
            });
        }

        const policy = this.validatePolicy(command);
        if (!policy.allowed) {
            return this.result({
                success: false,
                metadata: { error: 'COMMAND_BLOCKED_BY_POLICY' } as any,
                output: `COMMAND_BLOCKED_BY_POLICY: ${policy.reason || 'Command not allowed'}`,
            });
        }
        
        const timeoutMs = this.getEffectiveTimeout(timeout);
        try {
            const result = this.isBunRuntime()
                ? await this.runWithBun(command, timeoutMs)
                : await this.runWithNode(command, timeoutMs);

            const rawStr = process.platform === 'win32'
                ? iconv.decode(result.all, 'gbk')
                : iconv.decode(result.all, 'utf8');

            let finalOutput = stripAnsi(rawStr || '');

            const isTruncated = finalOutput.length > 10000;

            if (isTruncated) {
                finalOutput = finalOutput.slice(0, 4000) +
                    "\n\n[... Output Truncated for Brevity ...]\n\n" +
                    finalOutput.slice(-4000);
            }

            if (result.exitCode === 0) {
                return this.result({
                    success: true,
                    metadata: {
                        command,
                        exitCode: result.exitCode,
                    },
                    output: finalOutput,
                });
            } else {
                return this.result({
                    success: false,
                    metadata: { error: `EXIT_CODE_${result.exitCode}` } as any,
                    output: `EXIT_CODE_${result.exitCode}: Command failed with exit code ${result.exitCode}\n${finalOutput}`,
                });
            }

        } catch (error) {
            return this.result({
                success: false,
                metadata: { error: 'EXECUTION_FAILED' } as any,
                output: `EXECUTION_FAILED: ${command} execution failed: ${error}`,
            });
        }

    }
}
