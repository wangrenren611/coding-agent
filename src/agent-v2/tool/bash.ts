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

    /**
     * 公开 sanitizeOutput 方法用于测试
     */
    public sanitizeOutputForTest(output: string): string {
        return this.sanitizeOutput(output);
    }

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
        // Windows 上使用 UTF-8（代码页 65001）以正确处理 Unicode 字符
        const encoding = process.platform === 'win32' ? 'utf8' : 'utf8';
        const decoded = iconv.decode(chunk, encoding);
        return stripAnsi(decoded || '');
    }

    /**
     * 获取用于执行命令的环境变量
     * 在 Windows 上设置代码页为 UTF-8 (65001) 以正确处理 Unicode 字符
     */
    private getExecutionEnv(): NodeJS.ProcessEnv {
        const env = { ...process.env };

        if (process.platform === 'win32') {
            // 设置代码页为 UTF-8
            env['CHCP'] = '65001';
            // 禁用 ANSI 转义序列解析，避免与 iconv 冲突
            env['ANSICON'] = '';
            env['ConEmuANSI'] = 'OFF';
            env['TERM'] = 'dumb';
        }

        return env;
    }

    /**
     * 清理输出中的乱码字符
     *
     * Windows 环境下执行命令时，控制台输出可能包含无法正确解码的字符
     * 这些字符会被转换为乱码（如 "閴侊拷" 代替 "✓"）
     * 此函数清理这些乱码字符，确保输出是有效的 UTF-8 文本
     */
    private sanitizeOutput(output: string): string {
        if (!output) return output;

        // 1. 移除 Unicode 替换字符
        let sanitized = output.replace(/\uFFFD/g, '');

        // 2. 移除常见的 Windows 控制台乱码模式
        // 这些模式是 GBK 解码失败产生的
        // 匹配连续的乱码字符（通常是 3 字节的 UTF-8 字符被错误解读）
        sanitized = sanitized.replace(/[\u0080-\uFFFF]{2,}/g, (match) => {
            // 检查是否全是乱码字符（高位为 8x 或 9x）
            const isGibberish = [...match].every((char) => char.charCodeAt(0) >= 0x80 && !this.isValidUtf8Char(char));
            return isGibberish ? '' : match;
        });

        // 3. 移除行首的行号标记（如 "[2m" 等残留的 ANSI 代码）
        sanitized = sanitized.replace(/^\[[\d;]*m/gm, '');

        // 4. 规范化空白字符
        sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // 5. 移除空行
        sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

        return sanitized.trim();
    }

    /**
     * 检查字符是否是有效的 UTF-8 字符
     */
    private isValidUtf8Char(char: string): boolean {
        const code = char.charCodeAt(0);

        // ASCII 字符是有效的
        if (code < 0x80) return true;

        // 常见的中文 Unicode 范围
        if (code >= 0x4e00 && code <= 0x9fff) return true; // CJK 统一表意文字
        if (code >= 0x3400 && code <= 0x4dbf) return true; // CJK 统一表意文字扩展 A
        if (code >= 0x20000 && code <= 0x2a6df) return true; // CJK 统一表意文字扩展 B-F

        // 常见符号（✓, ✗, →, ← 等）
        if (code >= 0x2700 && code <= 0x27bf) return true; // 装饰符号
        if (code >= 0x2190 && code <= 0x21ff) return true; // 箭头符号
        if (code >= 0x2600 && code <= 0x26ff) return true; // 符号

        return false;
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
            env: this.getExecutionEnv(),
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
            env: this.getExecutionEnv(),
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

            // 现在使用 UTF-8 解码，因为已经设置了 CHCP=65001
            const rawStr = iconv.decode(result.all, 'utf8');

            let finalOutput = stripAnsi(rawStr || '');

            // 清理乱码字符，确保输出是有效的 UTF-8 文本
            finalOutput = this.sanitizeOutput(finalOutput);

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
