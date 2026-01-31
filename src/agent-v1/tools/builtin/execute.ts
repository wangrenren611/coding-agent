/**
 * Execute Tools - 执行工具
 *
 * 提供命令执行、文件信息获取等功能
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
    ToolDefinition,
    ToolResult,
    ToolCategory,
    PermissionLevel,
    ExecutionContext,
} from '../../types';

// =============================================================================
// 工具定义
// =============================================================================

/**
 * execute_command - 执行 shell 命令
 *
 * 危险工具，需要用户确认
 */
export const executeCommandTool: ToolDefinition = {
    name: 'execute_command',
    description: 'Execute a shell command in the working directory. This is a DANGEROUS operation that requires user confirmation.',
    category: 'execute' as ToolCategory,
    permission: 'dangerous' as PermissionLevel,
    requireConfirmation: true,
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The command to execute',
            },
            args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Command arguments as an array (safer than passing in command string)',
            },
            timeout: {
                type: 'number',
                description: 'Execution timeout in milliseconds (default: 30000)',
            },
        },
        required: ['command'],
    },
    execute: async (params: unknown, context: ExecutionContext) => {
        const { command, args = [], timeout = 30000 } = parseExecuteParams(params);

        try {
            // 安全检查：检查命令是否在允许列表中
            if (!isCommandAllowed(command)) {
                return {
                    success: false,
                    error: `Command "${command}" is not allowed. Allowed commands: ${ALLOWED_COMMANDS.join(', ')}`,
                };
            }

            const result = await executeShellCommand(
                command,
                args,
                context.workingDirectory,
                timeout
            );

            return {
                success: result.exitCode === 0,
                data: result,
                retryable: false,
            };
        } catch (error) {
            return {
                success: false,
                error: `Command execution failed: ${(error as Error).message}`,
                retryable: false,
            };
        }
    },
};

/**
 * get_file_info - 获取文件元数据
 */
export const getFileInfoTool: ToolDefinition = {
    name: 'get_file_info',
    description: 'Get metadata about a file or directory, including size, permissions, modification time, etc.',
    category: 'system' as ToolCategory,
    permission: 'safe' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Path to the file or directory',
            },
        },
        required: ['path'],
    },
    execute: async (params: unknown, context: ExecutionContext) => {
        const { filePath } = parseGetFileInfoParams(params);

        try {
            // 解析路径
            const fullPath = resolvePath(filePath, context.workingDirectory);

            // 检查路径是否在工作目录内
            if (!isPathSafe(fullPath, context.workingDirectory)) {
                return {
                    success: false,
                    error: 'Access denied: path is outside working directory',
                };
            }

            const stats = await fs.stat(fullPath);
            const relativePath = path.relative(context.workingDirectory, fullPath);

            return {
                success: true,
                data: {
                    path: relativePath,
                    fullPath,
                    isDirectory: stats.isDirectory(),
                    isFile: stats.isFile(),
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime,
                    accessed: stats.atime,
                    mode: stats.mode.toString(8),
                    permissions: {
                        read: !!(stats.mode & parseInt('400', 8)),
                        write: !!(stats.mode & parseInt('200', 8)),
                        execute: !!(stats.mode & parseInt('100', 8)),
                    },
                },
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return {
                    success: false,
                    error: `Path not found: ${filePath}`,
                };
            }
            return {
                success: false,
                error: `Failed to get file info: ${(error as Error).message}`,
            };
        }
    },
};

/**
 * run_tests - 运行测试套件
 */
export const runTestsTool: ToolDefinition = {
    name: 'run_tests',
    description: 'Run the test suite. Supports npm, yarn, pnpm, and bun package managers.',
    category: 'code' as ToolCategory,
    permission: 'moderate' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            testPattern: {
                type: 'string',
                description: 'Optional test pattern to filter tests',
            },
            packageManager: {
                type: 'string',
                enum: ['npm', 'yarn', 'pnpm', 'bun', 'auto'],
                description: 'Package manager to use (default: auto-detect)',
            },
        },
    },
    execute: async (params: unknown, context: ExecutionContext) => {
        const { testPattern, packageManager = 'auto' } = parseRunTestsParams(params);

        try {
            // 检测 package manager
            let pm = packageManager;
            if (pm === 'auto') {
                pm = await detectPackageManager(context.workingDirectory);
            }

            // 构建命令
            const args = ['run', 'test'];
            if (testPattern) {
                args.push('--', testPattern);
            }

            const result = await executeShellCommand(
                pm,
                args,
                context.workingDirectory,
                120000 // 2 minutes timeout for tests
            );

            return {
                success: result.exitCode === 0,
                data: {
                    ...result,
                    packageManager: pm,
                    passed: result.exitCode === 0,
                },
                retryable: true,
            };
        } catch (error) {
            return {
                success: false,
                error: `Test execution failed: ${(error as Error).message}`,
                retryable: true,
            };
        }
    },
};

// =============================================================================
// 导出所有工具
// =============================================================================

export const executeTools: ToolDefinition[] = [
    executeCommandTool,
    getFileInfoTool,
    runTestsTool,
];

// =============================================================================
// 辅助函数
// =============================================================================

// 允许执行的命令白名单
const ALLOWED_COMMANDS = [
    // Node.js
    'node',
    'npm',
    'npx',
    'yarn',
    'pnpm',
    'bun',
    // Git
    'git',
    // Python
    'python',
    'python3',
    'pip',
    'pip3',
    // Build tools
    'make',
    'cmake',
    'cargo',
    'go',
    'rustc',
    // Utilities
    'ls',
    'dir',
    'cat',
    'head',
    'tail',
    'grep',
    'find',
    'wc',
    'echo',
    'cd',
    'pwd',
    'mkdir',
    'touch',
    'rm',
    'cp',
    'mv',
    'chmod',
    'diff',
    'file',
    'stat',
];

function parseExecuteParams(params: unknown): {
    command: string;
    args: string[];
    timeout: number;
} {
    const p = params as Record<string, unknown>;
    return {
        command: String(p.command ?? ''),
        args: Array.isArray(p.args) ? p.args.map(String) : [],
        timeout: Number(p.timeout ?? 30000),
    };
}

function parseGetFileInfoParams(params: unknown): {
    filePath: string;
} {
    const p = params as Record<string, unknown>;
    return {
        filePath: String(p.path ?? ''),
    };
}

function parseRunTestsParams(params: unknown): {
    testPattern?: string;
    packageManager: string;
} {
    const p = params as Record<string, unknown>;
    return {
        testPattern: p.testPattern as string | undefined,
        packageManager: String(p.packageManager ?? 'auto'),
    };
}

function resolvePath(inputPath: string, workingDirectory: string): string {
    if (path.isAbsolute(inputPath)) {
        return inputPath;
    }
    return path.resolve(workingDirectory, inputPath);
}

function isPathSafe(targetPath: string, workingDirectory: string): boolean {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedWorking = path.resolve(workingDirectory);
    return resolvedTarget.startsWith(resolvedWorking);
}

function isCommandAllowed(command: string): boolean {
    const baseCommand = command.split(' ')[0];
    return ALLOWED_COMMANDS.includes(baseCommand);
}

/**
 * 执行 shell 命令
 */
async function executeShellCommand(
    command: string,
    args: string[],
    cwd: string,
    timeout: number
): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
}> {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        const child = spawn(command, args, {
            cwd,
            shell: true,
            env: { ...process.env },
        });

        // 收集输出
        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        // 设置超时
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Command timeout after ${timeout}ms`));
        }, timeout);

        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                exitCode: code,
                stdout,
                stderr,
            });
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

/**
 * 检测项目使用的 package manager
 */
async function detectPackageManager(cwd: string): Promise<string> {
    const managers = [
        { name: 'pnpm', file: 'pnpm-lock.yaml' },
        { name: 'yarn', file: 'yarn.lock' },
        { name: 'bun', file: 'bun.lockb' },
        { name: 'npm', file: 'package-lock.json' },
    ];

    for (const { name, file } of managers) {
        try {
            await fs.access(path.join(cwd, file));
            return name;
        } catch {
            // 文件不存在，继续检查
        }
    }

    // 默认返回 npm
    return 'npm';
}
