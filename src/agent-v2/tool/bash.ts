/**
 * Bash Tool
 *
 * Executes shell commands with:
 * - command validation and parsing
 * - safety policy checks
 * - command execution
 */

import { BaseTool, ToolContext, ToolResult } from './base';
import { z } from 'zod';
import BASH_DESCRIPTION from './bash.description';
import { execaCommand } from 'execa';
import stripAnsi from 'strip-ansi';
import iconv from 'iconv-lite';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { evaluateBashPolicy } from '../security/bash-policy';
import type { BashPolicyMode } from '../security/bash-policy';

const runInBackgroundSchema = z.preprocess((value) => {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return value;
}, z.boolean());

const schema = z.object({
    command: z.string().min(1).describe('The bash command to run').optional(),
    timeout: z.number().int().min(0).max(600000).describe('Command timeout in milliseconds').optional(),
    run_in_background: runInBackgroundSchema.optional().describe('Run command in background'),
});

interface PolicyDecision {
    allowed: boolean;
    reason?: string;
}

interface BunProcessLike {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    kill(): void;
}

interface BunRuntimeLike {
    spawn(
        command: string[],
        options: {
            cwd: string;
            env: NodeJS.ProcessEnv;
            stdin: 'ignore';
            stdout: 'pipe';
            stderr: 'pipe';
        }
    ): BunProcessLike;
}

// =============================================================================
// BashTool
// =============================================================================

export default class BashTool extends BaseTool<typeof schema> {
    name = 'bash';
    description = BASH_DESCRIPTION;
    schema = schema;

    /** Command timeout in milliseconds, default 60 seconds */
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

    private decodeOutputChunk(chunk: Buffer): string {
        const decoded = process.platform === 'win32' ? iconv.decode(chunk, 'gbk') : iconv.decode(chunk, 'utf8');
        return stripAnsi(decoded || '');
    }

    private async runWithNode(
        command: string,
        timeoutMs: number,
        onChunk?: (chunk: string) => void
    ): Promise<{ exitCode: number; all: Buffer; streamed: boolean }> {
        const subprocess = execaCommand(command, {
            all: true,
            reject: false,
            shell: true,
            preferLocal: true,
            windowsHide: true,
            encoding: 'buffer',
            timeout: timeoutMs,
        });

        let streamed = false;
        const outputChunks: Buffer[] = [];
        const allStream = subprocess.all;

        if (allStream) {
            allStream.on('data', (chunk: string | Buffer) => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                outputChunks.push(buffer);
                const decoded = this.decodeOutputChunk(buffer);
                if (decoded && onChunk) {
                    streamed = true;
                    onChunk(decoded);
                }
            });
        }

        const result = await subprocess;

        const all =
            outputChunks.length > 0
                ? Buffer.concat(outputChunks)
                : Buffer.isBuffer(result.all)
                  ? result.all
                  : Buffer.from(result.all ?? '');

        return {
            exitCode: result.exitCode ?? 1,
            all,
            streamed,
        };
    }

    private async runWithBun(
        command: string,
        timeoutMs: number
    ): Promise<{ exitCode: number; all: Buffer; streamed: boolean }> {
        const bun = (globalThis as { Bun?: BunRuntimeLike }).Bun;
        if (!bun || typeof bun.spawn !== 'function') {
            throw new Error('Bun runtime unavailable');
        }

        const shellCommand =
            process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', command] : ['/bin/bash', '-lc', command];

        const child = bun.spawn(shellCommand, {
            cwd: process.cwd(),
            env: process.env,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        });

        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            const exitState = await Promise.race([
                child.exited.then((exitCode: number) => ({ timedOut: false as const, exitCode })),
                new Promise<{ timedOut: true }>((resolve) => {
                    timer = setTimeout(() => {
                        try {
                            child.kill();
                        } catch {
                            // ignore kill errors
                        }
                        resolve({ timedOut: true });
                    }, timeoutMs);
                }),
            ]);

            if (exitState.timedOut) {
                return {
                    exitCode: 124,
                    all: Buffer.from(`Command timed out after ${timeoutMs}ms`),
                    streamed: false,
                };
            }

            const [stdoutAb, stderrAb] = await Promise.all([
                new Response(child.stdout).arrayBuffer(),
                new Response(child.stderr).arrayBuffer(),
            ]);
            const all = Buffer.concat([Buffer.from(stdoutAb), Buffer.from(stderrAb)]);

            return {
                exitCode: typeof exitState.exitCode === 'number' ? exitState.exitCode : 1,
                all,
                streamed: false,
            };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private runInBackground(command: string): { pid: number | undefined; logPath: string } {
        const logPath = path.join(tmpdir(), `agent-bash-bg-${Date.now()}-${randomUUID().slice(0, 8)}.log`);
        fs.writeFileSync(logPath, '', { flag: 'a' });

        const quotedLogPath =
            process.platform === 'win32' ? `"${logPath.replace(/"/g, '""')}"` : `'${logPath.replace(/'/g, `'\\''`)}'`;
        const redirectedCommand = `${command} >> ${quotedLogPath} 2>&1`;

        const shellCommand =
            process.platform === 'win32'
                ? ['cmd.exe', '/d', '/s', '/c', redirectedCommand]
                : ['/bin/bash', '-lc', redirectedCommand];

        const child = spawn(shellCommand[0], shellCommand.slice(1), {
            cwd: process.cwd(),
            env: process.env,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });

        child.unref();
        return { pid: child.pid, logPath };
    }

    private validatePolicy(command: string, context?: ToolContext): PolicyDecision {
        const normalized = command.trim();
        if (!normalized) {
            return { allowed: false, reason: 'Command is empty' };
        }

        const decision = evaluateBashPolicy(normalized, {
            mode: this.getPolicyMode(),
            allowlistMissEffect: 'deny',
            allowlistBypassed: context?.allowlistBypassed === true,
            allowlistMissReason: (cmd) =>
                `Command "${cmd}" is not in allowed command list (set BASH_TOOL_POLICY=permissive to bypass)`,
        });

        if (decision.effect === 'allow') {
            return { allowed: true };
        }

        return { allowed: false, reason: decision.reason };
    }

    /**
     * Execute a shell command.
     *
     * Error handling:
     * - Business errors (validation/policy) return { success: false, ... }.
     * - Runtime failures are wrapped as tool errors for the registry.
     */
    async execute(args: z.infer<typeof this.schema>, _context?: ToolContext): Promise<ToolResult> {
        const { command, timeout, run_in_background } = args;

        if (!command) {
            return this.result({
                success: false,
                metadata: { error: 'COMMAND_REQUIRED' },
                output: 'COMMAND_REQUIRED: Command is required',
            });
        }

        const policy = this.validatePolicy(command, _context);
        if (!policy.allowed) {
            return this.result({
                success: false,
                metadata: { error: 'COMMAND_BLOCKED_BY_POLICY' },
                output: `COMMAND_BLOCKED_BY_POLICY: ${policy.reason || 'Command not allowed'}`,
            });
        }

        if (run_in_background) {
            try {
                const { pid, logPath } = this.runInBackground(command);
                const pidText = typeof pid === 'number' ? String(pid) : 'unknown';
                return this.result({
                    success: true,
                    metadata: {
                        command,
                        pid,
                        logPath,
                        run_in_background: true,
                    },
                    output: `BACKGROUND_STARTED: pid=${pidText}, log=${logPath}`,
                });
            } catch (error) {
                return this.result({
                    success: false,
                    metadata: { error: 'BACKGROUND_START_FAILED' },
                    output: `BACKGROUND_START_FAILED: ${String(error)}`,
                });
            }
        }

        const timeoutMs = this.getEffectiveTimeout(timeout);
        try {
            const result = this.isBunRuntime()
                ? await this.runWithBun(command, timeoutMs)
                : await this.runWithNode(command, timeoutMs, (chunk) => _context?.emitOutput?.(chunk));

            const rawStr =
                process.platform === 'win32' ? iconv.decode(result.all, 'gbk') : iconv.decode(result.all, 'utf8');

            let finalOutput = stripAnsi(rawStr || '');

            const isTruncated = finalOutput.length > 10000;

            if (isTruncated) {
                finalOutput =
                    finalOutput.slice(0, 4000) +
                    '\n\n[... Output Truncated for Brevity ...]\n\n' +
                    finalOutput.slice(-4000);
            }

            if (!result.streamed && finalOutput) {
                _context?.emitOutput?.(finalOutput);
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
                    metadata: { error: `EXIT_CODE_${result.exitCode}` },
                    output: `EXIT_CODE_${result.exitCode}: Command failed with exit code ${result.exitCode}\n${finalOutput}`,
                });
            }
        } catch (error) {
            return this.result({
                success: false,
                metadata: { error: 'EXECUTION_FAILED' },
                output: `EXECUTION_FAILED: ${command} execution failed: ${error}`,
            });
        }
    }
}
