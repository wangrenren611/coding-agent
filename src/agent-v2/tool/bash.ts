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
import { execa } from 'execa';
import { parse } from 'shell-quote';
import stripAnsi from 'strip-ansi';
import iconv from 'iconv-lite';

const schema = z.object({
    command: z.string().min(1).describe('The bash command to run').optional(),
    timeout: z.number().int().min(0).max(600000).describe('Command timeout in milliseconds').optional(),
    // run_in_background: z.boolean().describe('Run in background').optional(),
});

// =============================================================================
// BashTool 类
// =============================================================================

export default class BashTool extends BaseTool<typeof schema> {
    name = 'bash';
    description = BASH_DESCRIPTION;
    schema = schema;

    /** 命令执行超时时间（毫秒），默认 60 秒 */
    timeout: number = 60000;

    /**
     * 执行 bash 命令
     *
     * 错误分类：
     * - 业务错误（参数验证、安全检查）→ return { success: false, error: ... }
     * - 底层异常（执行失败）→ throw 供 Registry 捕获
     */
    async execute(args: z.infer<typeof this.schema>): Promise<ToolResult> {
        // const { command, language, code, args: scriptArgs, stdin } = args;
        const { command, timeout, } = args;

        if (!command) {
            return this.result({
                success: false,
                metadata: { error: 'COMMAND_REQUIRED' } as any,
                output: 'COMMAND_REQUIRED: Command is required',
            });
        }

        const tokens = parse(command);
        const _args = tokens.filter(t => typeof t === 'string');
        const cmd = _args.shift();

        if (!cmd) {
            return this.result({
                success: false,
                metadata: { error: 'INVALID_COMMAND' } as any,
                output: 'INVALID_COMMAND: Invalid command',
            });
        }
        const startTime = Date.now();
        try {
            const result = await execa(cmd, _args, {
                reject: false,       // 关键：不抛出错误，统一处理
                shell: true,
                preferLocal: true,
                windowsHide: true,
                timeout: this.timeout || timeout,       // 设置硬超时
            });

            // 合并 stdout 和 stderr
            let rawStr = '';
            if (result.stdout) rawStr += result.stdout;
            if (result.stderr) rawStr += result.stderr;

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
