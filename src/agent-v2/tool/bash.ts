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
import { getBashParser } from './bash-parser';
import { getPlatform, execCommandAsync } from './platform-cmd';

// =============================================================================
// 模式定义
// =============================================================================

const scriptLanguages = ['node', 'python', 'python3'] as const;
type ScriptLanguage = typeof scriptLanguages[number];

const schema = z.object({
    command: z.string().min(1).describe('The bash command to run').optional(),
    language: z.enum(scriptLanguages).describe('Inline script language (node/python)').optional(),
    code: z.string().min(1).describe('Inline script to execute').optional(),
    args: z.array(z.string()).describe('Arguments for inline scripts').optional(),
    stdin: z.string().describe('Optional stdin for the command').optional(),
});

// =============================================================================
// BashTool 类
// =============================================================================

export default class BashTool extends BaseTool<typeof schema> {
    name = 'bash';
    private cwd = process.cwd();

    get description(): string {
        return ['Run bash commands, with optional inline node/python scripts','When viewing log files, using the tail command is the best practice.'].join('\n');
    }

    schema = schema;

    /** 命令执行超时时间（毫秒），默认 60 秒 */
    timeout: number = 60000;

    /**
     * 执行 bash 命令
     *
     * 错误分类：
     * - 业务错误（参数验证、安全检查）→ return this.fail()
     * - 底层异常（执行失败）→ throw 供 Registry 捕获
     */
    async execute(args: z.infer<typeof this.schema>): Promise<ToolResult> {
        const { command, language, code, args: scriptArgs, stdin } = args;

        // === 业务错误：参数验证 ===
        const validationError = this.validateArgs({ command, language, code, args: scriptArgs, stdin });
        if (validationError) {
            return this.fail({
                error: validationError,
            });
        }

        const hasCode = Boolean(code?.trim());
        const execution = hasCode
            ? { command: this.buildInlineCommand(language as ScriptLanguage, scriptArgs), input: code }
            : { command: command as string, input: stdin };

        // === 业务错误：语法检查 ===
        const platform = getPlatform();
        if (platform !== 'windows') {
            const parser = await getBashParser();
            const parseResult = parser.parse(execution.command);
            if (!parseResult.valid) {
                return this.fail(
                    {
                        error: parseResult.error,
                    }
                );
            }
        } else {
            const dangerousPattern = /(^|\s)(format|shutdown|reg\s+delete|rmdir\s+\/s|rd\s+\/s|del\s+\/f)(\s|$)/i;
            if (dangerousPattern.test(execution.command)) {
                return this.fail(
                    {
                      error: 'Command not executed due to safety policy',
                    }
                );
            }
        }

        // === 执行命令 ===
        const result = await this.runCommand(execution.command, execution.input);
        return result;
    }

    /**
     * 执行 bash 命令
     *
     * 错误分类：
     * - cd 解析失败 → return fail()（业务错误）
     * - 命令执行异常 → throw（底层异常）
     */
    private async runCommand(command: string, input?: string): Promise<ToolResult> {
        // 处理 cd 命令（业务错误）
        const cdError = this.tryHandleCd(command);
        if (cdError) {
            return this.fail({
                error: cdError,
            });
        }

        const normalizedCommand = this.normalizeCommand(command);

        try {
            // === 底层异常：命令执行 ===
            const result = await execCommandAsync(normalizedCommand, {
                timeout: this.timeout,
                cwd: this.cwd,
                input,
            });

            if (result.exitCode === 0) {
                return this.success({
                    metadata: { },
                    output: result.stdout || 'Command exited successfully',
                });
            } else {
                return this.fail(
                    {
                        error: result.stderr || `Command failed with exit code ${result.exitCode}`,
                    }
                );
            }
        } catch (error) {
            // 底层异常，让 Registry 统一捕获
            throw new Error(`Failed to execute command: ${error}`);
        }
    }

    /**
     * 处理 cd 命令
     * @returns 错误信息，null 表示成功
     */
    private tryHandleCd(command: string): string | null {
        const platform = getPlatform();
        if (/[|;&<>]|\|\||&&/.test(command)) {
            return null; // 复杂命令不做 cd 处理
        }

        const cdMatch = command.match(/^\s*cd(?:\s+\/d)?\s+(.+)\s*$/i);
        if (!cdMatch) return null;

        const rawTarget = cdMatch[1]?.trim();
        if (!rawTarget) return 'cd target is empty';

        const target = rawTarget.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
        const resolved = platform === 'windows'
            ? require('path').resolve(this.cwd, target.replace(/\//g, '\\'))
            : require('path').resolve(this.cwd, target);

        this.cwd = resolved;
        return null;
    }

    private normalizeCommand(command: string): string {
        if (getPlatform() !== 'windows') return command;

        const timeoutMatch = command.match(/^\s*timeout\s+\/t\s+(\d+)\s*$/i);
        if (timeoutMatch) {
            const seconds = Number(timeoutMatch[1]);
            const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
            return `powershell -NoProfile -Command "Start-Sleep -Seconds ${safeSeconds}"`;
        }

        const mkdirMatch = command.match(/^\s*mkdir\s+(-p|--parents)\s+(.+)\s*$/i);
        if (mkdirMatch) {
            return `mkdir ${mkdirMatch[2]}`;
        }

        const { tokens, quoteTypes } = this.tokenize(command);
        const normalizedTokens = tokens.map((token, i) => {
            const quote = quoteTypes[i];
            const original = quote ? `${quote}${token}${quote}` : token;
            if (!token.includes('/')) return original;
            if (token.startsWith('/')) return original;
            if (token.includes('://')) return original;

            const looksLikeProjectPath =
                token.startsWith('./') ||
                token.startsWith('../') ||
                token.startsWith('src/') ||
                token.startsWith('test/') ||
                token.startsWith('__tests__/') ||
                /\.(ts|tsx|js|jsx|json|md|txt|log|env)$/i.test(token) ||
                token.includes('/src/') ||
                token.includes('/test/') ||
                token.includes('/__tests__/');

            if (!looksLikeProjectPath) return original;

            const replaced = token.replace(/\//g, '\\');
            return quote ? `${quote}${replaced}${quote}` : replaced;
        });

        return normalizedTokens.join(' ');
    }

    private tokenize(command: string): { tokens: string[]; quoteTypes: Array<'"' | "'" | null> } {
        const tokens: string[] = [];
        const quoteTypes: Array<'"' | "'" | null> = [];
        let current = '';
        let quote: '"' | "'" | null = null;

        for (let i = 0; i < command.length; i++) {
            const ch = command[i];
            if ((ch === '"' || ch === "'") && quote === null) {
                quote = ch as '"' | "'";
                continue;
            }
            if (quote !== null && ch === quote) {
                tokens.push(current);
                quoteTypes.push(quote);
                current = '';
                quote = null;
                continue;
            }
            if (quote === null && /\s/.test(ch)) {
                if (current.length > 0) {
                    tokens.push(current);
                    quoteTypes.push(null);
                    current = '';
                }
                continue;
            }
            current += ch;
        }

        if (current.length > 0) {
            tokens.push(current);
            quoteTypes.push(quote);
        }

        return { tokens, quoteTypes };
    }

    private validateArgs(input: {
        command?: string;
        language?: ScriptLanguage;
        code?: string;
        args?: string[];
        stdin?: string;
    }): string | null {
        const hasCommand = Boolean(input.command?.trim());
        const hasCode = Boolean(input.code?.trim());

        if (!hasCommand && !hasCode) {
            return 'missing "command" or "code"';
        }
        if (hasCommand && hasCode) {
            return 'provide either "command" or "code", not both';
        }
        if (hasCode && !input.language) {
            return '"language" is required when using "code"';
        }
        if (!hasCode && input.language) {
            return '"language" is only valid with "code"';
        }
        if (!hasCode && input.args?.length) {
            return '"args" is only valid with "code"';
        }
        if (hasCode && input.stdin !== undefined) {
            return '"stdin" cannot be used with "code"';
        }
        return null;
    }

    private buildInlineCommand(language: ScriptLanguage, scriptArgs?: string[]): string {
        const interpreter = this.resolveInterpreter(language);
        const args = scriptArgs ?? [];
        const parts = [interpreter, '-'];
        if (language === 'node' && args.some((arg) => arg.startsWith('-'))) {
            parts.push('--');
        }
        if (args.length > 0) {
            parts.push(...args.map((arg) => this.quoteArg(arg)));
        }
        return parts.join(' ');
    }

    private resolveInterpreter(language: ScriptLanguage): string {
        if (language === 'node') return 'node';
        if (language === 'python3') return 'python3';
        return getPlatform() === 'windows' ? 'python' : 'python3';
    }

    private quoteArg(arg: string): string {
        const safe = /^[A-Za-z0-9_./:=+-]+$/.test(arg);
        if (safe) return arg;

        if (getPlatform() === 'windows') {
            const escaped = arg.replace(/"/g, '\\"');
            return `"${escaped}"`;
        }

        const escaped = arg.replace(/'/g, "'\\''");
        return `'${escaped}'`;
    }
}
