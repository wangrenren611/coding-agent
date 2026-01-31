/**
 * 跨平台命令工具
 *
 * 提供统一的命令接口，自动处理不同平台的差异
 */

import { execaCommandSync, execaCommand } from 'execa';
import iconv from 'iconv-lite';

function decodeCommandOutput(data: unknown, platform: Platform): string {
    if (data === undefined || data === null) {
        return '';
    }
    if (Buffer.isBuffer(data)) {
        return platform === 'windows' ? iconv.decode(data, 'gbk') : data.toString('utf8');
    }
    return String(data);
}


/**
 * 平台类型
 */
export type Platform = 'windows' | 'mac' | 'linux';

/**
 * 获取当前平台
 */
export function getPlatform(): Platform {
    switch (process.platform) {
        case 'win32':
            return 'windows';
        case 'darwin':
            return 'mac';
        default:
            return 'linux';
    }
}

/**
 * 平台特定的命令映射
 */
const PLATFORM_COMMANDS = {
    // 列出文件
    listFiles: {
        windows: 'dir',
        mac: 'ls -la',
        linux: 'ls -la'
    },
    // 读取文件
    readFile: {
        windows: 'type',
        mac: 'cat',
        linux: 'cat'
    },
    // 查找文件
    findFiles: {
        windows: 'dir /s /b',
        mac: 'find . -name',
        linux: 'find . -name'
    },
    // 复制文件
    copyFile: {
        windows: 'copy',
        mac: 'cp',
        linux: 'cp'
    }
};

/**
 * 获取平台特定的命令
 */
export function getCommand(commandName: keyof typeof PLATFORM_COMMANDS): string {
    return PLATFORM_COMMANDS[commandName][getPlatform()];
}

/**
 * 跨平台路径规范化
 *
 * @param path - 文件路径
 * @returns 规范化后的路径
 */
export function normalizePath(path: string): string {
    // 统一使用正斜杠（Node.js 会自动处理）
    return path.replace(/\\/g, '/');
}

/**
 * 构建跨平台的文件搜索命令
 *
 * @param pattern - 文件模式（如 "*.ts"）
 * @param directory - 目录（可选）
 * @returns 跨平台命令字符串
 */
export function buildFindCommand(pattern: string, directory?: string): string {
    const platform = getPlatform();
    const dir = directory || '.';

    switch (platform) {
        case 'windows': {
            // Windows: dir /s /b src\*.ts
            const normDir = dir.replace(/\//g, '\\');
            return `dir /s /b "${normDir}\\${pattern}"`;
        }

        case 'mac':
        case 'linux':
            // Unix: find . -name "*.ts" -type f
            return `find "${dir}" -name "${pattern}" -type f`;

        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

/**
 * 构建跨平台的文件列表命令
 *
 * @param directory - 目录
 * @returns 跨平台命令字符串
 */
export function buildListCommand(directory: string = '.'): string {
    const platform = getPlatform();

    switch (platform) {
        case 'windows': {
            const normDir = directory.replace(/\//g, '\\');
            return `dir /a "${normDir}"`;
        }

        case 'mac':
        case 'linux':
            return `ls -la "${directory}"`;

        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

/**
 * 获取平台使用建议
 */
export function getPlatformAdvice(): string {
    const platform = getPlatform();

    const advice = {
        windows: {
            shell: 'cmd.exe',
            limitations: [
                '不支持 Unix 命令: head, tail, grep, find',
                '管道功能受限',
                '变量使用 %VAR% 格式'
            ],
            alternatives: [
                '使用 PowerShell 获得更强大的功能',
                '使用 dir /s /b "pattern" 进行文件搜索',
                '使用 type 命令读取文件'
            ]
        },
        mac: {
            shell: 'zsh (bash compatible)',
            limitations: [
                '某些 Linux 特定命令可能不可用'
            ],
            alternatives: [
                '使用 find . -name "*.ts" 搜索文件',
                '使用 cat 读取文件',
                '支持完整的 Unix 管道和重定向'
            ]
        },
        linux: {
            shell: 'bash',
            limitations: [],
            alternatives: [
                '支持所有标准 Unix 命令',
                '完整的管道和重定向支持'
            ]
        }
    };

    return JSON.stringify(advice[platform], null, 2);
}

/**
 * 执行跨平台命令（同步）
 */
export function execCommand(command: string): { stdout: string; stderr: string; exitCode: number } {
    const platform = getPlatform();
    try {
        const result = execaCommandSync(command, {
            shell: true,
            encoding: 'buffer' as any
        });
        return {
            stdout: decodeCommandOutput(result.stdout, platform),
            stderr: decodeCommandOutput(result.stderr, platform),
            exitCode: result.exitCode ?? 0
        };
    } catch (error: any) {
        return {
            stdout: decodeCommandOutput(error.stdout, platform),
            stderr: decodeCommandOutput(error.stderr || error.message, platform),
            exitCode: error.exitCode || 1
        };
    }
}

/**
 * 执行跨平台命令（异步）
 *
 * @param command - 要执行的命令
 * @param options - 可选配置
 * @param options.timeout - 超时时间（毫秒）
 * @param options.cwd - 工作目录
 * @param options.input - 标准输入内容
 * @returns 执行结果
 */
export async function execCommandAsync(
    command: string,
    options?: { timeout?: number; cwd?: string; input?: string }
): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}> {
    const platform = getPlatform();
    try {
        const result = await execaCommand(command, {
            shell: true,
            encoding: 'buffer' as any,
            timeout: options?.timeout,
            cwd: options?.cwd,
            input: options?.input,
        });
        return {
            stdout: decodeCommandOutput(result.stdout, platform),
            stderr: decodeCommandOutput(result.stderr, platform),
            exitCode: result.exitCode ?? 0
        };
    } catch (error: any) {
        return {
            stdout: decodeCommandOutput(error.stdout, platform),
            stderr: decodeCommandOutput(error.stderr || error.message, platform),
            exitCode: error.exitCode || 1
        };
    }
}
