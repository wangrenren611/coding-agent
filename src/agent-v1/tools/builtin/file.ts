/**
 * File Operation Tools - 文件操作工具
 *
 * 提供文件读写、目录列表、文件搜索等功能
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as glob from 'glob';
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
 * read_file - 读取文件内容
 */
export const readFileTool: ToolDefinition = {
    name: 'read_file',
    description: 'Read the content of a file. Supports reading a specific line range.',
    category: 'file' as ToolCategory,
    permission: 'safe' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute or relative path to the file',
            },
            startLine: {
                type: 'number',
                description: 'Start line number (1-indexed, inclusive)',
            },
            endLine: {
                type: 'number',
                description: 'End line number (1-indexed, inclusive)',
            },
        },
    },
    execute: async (params: unknown, context: ExecutionContext) => {
        const { filePath, startLine, endLine } = parseReadFileParams(params);

        try {
            // 解析路径
            const fullPath = resolvePath(filePath, context.workingDirectory);

            // 检查路径是否在工作目录内（安全检查）
            if (!isPathSafe(fullPath, context.workingDirectory)) {
                return {
                    success: false,
                    error: 'Access denied: file path is outside working directory',
                };
            }

            // 读取文件
            const content = await fs.readFile(fullPath, 'utf-8');

            // 处理行范围
            if (startLine !== undefined || endLine !== undefined) {
                const lines = content.split('\n');
                const start = startLine ? startLine - 1 : 0;
                const end = endLine ? endLine : lines.length;
                const slicedLines = lines.slice(start, end);
                return {
                    success: true,
                    data: {
                        content: slicedLines.join('\n'),
                        lineCount: slicedLines.length,
                        totalLines: lines.length,
                        path: fullPath,
                    },
                };
            }

            return {
                success: true,
                data: {
                    content,
                    path: fullPath,
                },
            };
        } catch (error) {
            return handleError(error as Error, 'read_file', filePath);
        }
    },
};

/**
 * write_file - 写入文件
 */
export const writeFileTool: ToolDefinition = {
    name: 'write_file',
    description: 'Write content to a file. Creates a backup automatically if enabled.',
    category: 'file' as ToolCategory,
    permission: 'moderate' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute or relative path to the file',
            },
            content: {
                type: 'string',
                description: 'Content to write to the file',
            },
            createBackup: {
                type: 'boolean',
                description: 'Whether to create a backup before writing (default: true)',
            },
        },
        required: ['path', 'content'],
    },
    execute: async (params: unknown, context: ExecutionContext) => {
        const { filePath, content, createBackup = true } = parseWriteFileParams(params);

        try {
            // 解析路径
            const fullPath = resolvePath(filePath, context.workingDirectory);

            // 检查路径是否在工作目录内（安全检查）
            if (!isPathSafe(fullPath, context.workingDirectory)) {
                return {
                    success: false,
                    error: 'Access denied: file path is outside working directory',
                };
            }

            let backupPath: string | undefined;

            // 创建备份（如果文件存在且需要备份）
            if (createBackup) {
                try {
                    await fs.access(fullPath);
                    // 文件存在，创建备份
                    const timestamp = Date.now();
                    const backupDir = path.join(context.workingDirectory, '.agent-backups');
                    await fs.mkdir(backupDir, { recursive: true });

                    const basename = path.basename(fullPath);
                    backupPath = path.join(backupDir, `${basename}.${timestamp}.backup`);
                    await fs.copyFile(fullPath, backupPath);

                    // 记录文件变更
                    context.fileChangeHistory.push({
                        path: fullPath,
                        changeType: 'modified',
                        timestamp: Date.now(),
                        backupPath,
                    });
                } catch {
                    // 文件不存在，不需要备份
                }
            }

            // 确保目录存在
            const dir = path.dirname(fullPath);
            await fs.mkdir(dir, { recursive: true });

            // 写入文件
            await fs.writeFile(fullPath, content, 'utf-8');

            return {
                success: true,
                data: {
                    path: fullPath,
                    bytesWritten: Buffer.byteLength(content, 'utf-8'),
                    backupPath,
                },
            };
        } catch (error) {
            return handleError(error as Error, 'write_file', filePath);
        }
    },
};

/**
 * list_directory - 列出目录内容
 */
export const listDirectoryTool: ToolDefinition = {
    name: 'list_directory',
    description: 'List the contents of a directory. Can filter by file extension.',
    category: 'file' as ToolCategory,
    permission: 'safe' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute or relative path to the directory (default: working directory)',
            },
            recursive: {
                type: 'boolean',
                description: 'Whether to list recursively (default: false)',
            },
            pattern: {
                type: 'string',
                description: 'Glob pattern to filter files (e.g., "*.ts")',
            },
        },
    },
    execute: async (params: unknown, context: ExecutionContext) => {
        const { dirPath = context.workingDirectory, recursive = false, pattern } =
            parseListDirectoryParams(params);

        try {
            const fullPath = resolvePath(dirPath, context.workingDirectory);

            // 检查路径是否在工作目录内（安全检查）
            if (!isPathSafe(fullPath, context.workingDirectory)) {
                return {
                    success: false,
                    error: 'Access denied: directory path is outside working directory',
                };
            }

            let files: string[];

            if (pattern) {
                // 使用 glob 模式
                const globPattern = recursive
                    ? path.join(fullPath, '**', pattern)
                    : path.join(fullPath, pattern);

                files = await glob.glob(globPattern, {
                    windowsPathsNoEscape: true,
                });
            } else if (recursive) {
                // 递归列出所有文件
                files = await glob.glob(path.join(fullPath, '**'), {
                    windowsPathsNoEscape: true,
                });
            } else {
                // 列出直接子项
                const entries = await fs.readdir(fullPath, { withFileTypes: true });
                files = entries.map(entry => path.join(fullPath, entry.name));
            }

            // 获取文件信息
            const fileInfos = await Promise.all(
                files.map(async (filePath) => {
                    try {
                        const stats = await fs.stat(filePath);
                        const relativePath = path.relative(context.workingDirectory, filePath);
                        return {
                            path: relativePath,
                            fullPath: filePath,
                            isDirectory: stats.isDirectory(),
                            size: stats.size,
                            modified: stats.mtime,
                        };
                    } catch {
                        return null;
                    }
                })
            );

            // 过滤掉 null 值和目录（如果使用 pattern）
            const filtered = fileInfos.filter(
                (info): info is NonNullable<typeof info> =>
                    info !== null && (pattern ? !info.isDirectory : true)
            );

            return {
                success: true,
                data: {
                    path: fullPath,
                    files: filtered,
                    count: filtered.length,
                },
            };
        } catch (error) {
            return handleError(error as Error, 'list_directory', dirPath);
        }
    },
};

/**
 * search_files - 在文件中搜索内容
 */
export const searchFilesTool: ToolDefinition = {
    name: 'search_files',
    description: 'Search for content in files using regex pattern.',
    category: 'file' as ToolCategory,
    permission: 'safe' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            pattern: {
                type: 'string',
                description: 'Regex pattern to search for',
            },
            path: {
                type: 'string',
                description: 'Directory path to search in (default: working directory)',
            },
            filePattern: {
                type: 'string',
                description: 'Glob pattern to filter files (e.g., "*.ts")',
            },
            caseInsensitive: {
                type: 'boolean',
                description: 'Whether to ignore case (default: false)',
            },
        },
        required: ['pattern'],
    },
    execute: async (params: unknown, context: ExecutionContext) => {
        const {
            pattern,
            dirPath = context.workingDirectory,
            filePattern,
            caseInsensitive = false,
        } = parseSearchFilesParams(params);

        try {
            const fullPath = resolvePath(dirPath, context.workingDirectory);

            // 检查路径是否在工作目录内
            if (!isPathSafe(fullPath, context.workingDirectory)) {
                return {
                    success: false,
                    error: 'Access denied: directory path is outside working directory',
                };
            }

            // 编译正则表达式
            const regex = new RegExp(pattern, caseInsensitive ? 'i' : '');

            // 查找文件
            const globPattern = filePattern
                ? path.join(fullPath, '**', filePattern)
                : path.join(fullPath, '**');

            const files = await glob.glob(globPattern, {
                windowsPathsNoEscape: true,
            });

            const results: Array<{
                file: string;
                matches: Array<{ line: number; content: string }>;
            }> = [];

            // 搜索每个文件
            for (const filePath of files) {
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.isDirectory()) continue;

                    const content = await fs.readFile(filePath, 'utf-8');
                    const lines = content.split('\n');

                    const matches: Array<{ line: number; content: string }> = [];

                    for (let i = 0; i < lines.length; i++) {
                        if (regex.test(lines[i])) {
                            matches.push({
                                line: i + 1,
                                content: lines[i],
                            });
                        }
                    }

                    if (matches.length > 0) {
                        const relativePath = path.relative(context.workingDirectory, filePath);
                        results.push({
                            file: relativePath,
                            matches,
                        });
                    }
                } catch {
                    // 跳过无法读取的文件
                }
            }

            const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

            return {
                success: true,
                data: {
                    pattern,
                    results,
                    fileCount: results.length,
                    matchCount: totalMatches,
                },
            };
        } catch (error) {
            return handleError(error as Error, 'search_files', dirPath);
        }
    },
};

// =============================================================================
// 导出所有工具
// =============================================================================

export const fileTools: ToolDefinition[] = [
    readFileTool,
    writeFileTool,
    listDirectoryTool,
    searchFilesTool,
];

// =============================================================================
// 辅助函数
// =============================================================================

function parseReadFileParams(params: unknown): {
    filePath: string;
    startLine?: number;
    endLine?: number;
} {
    const p = params as Record<string, unknown>;
    return {
        filePath: String(p.path ?? ''),
        startLine: p.startLine as number | undefined,
        endLine: p.endLine as number | undefined,
    };
}

function parseWriteFileParams(params: unknown): {
    filePath: string;
    content: string;
    createBackup?: boolean;
} {
    const p = params as Record<string, unknown>;
    return {
        filePath: String(p.path ?? ''),
        content: String(p.content ?? ''),
        createBackup: p.createBackup as boolean | undefined,
    };
}

function parseListDirectoryParams(params: unknown): {
    dirPath?: string;
    recursive?: boolean;
    pattern?: string;
} {
    const p = params as Record<string, unknown>;
    return {
        dirPath: p.path as string | undefined,
        recursive: p.recursive as boolean | undefined,
        pattern: p.pattern as string | undefined,
    };
}

function parseSearchFilesParams(params: unknown): {
    pattern: string;
    dirPath?: string;
    filePattern?: string;
    caseInsensitive?: boolean;
} {
    const p = params as Record<string, unknown>;
    return {
        pattern: String(p.pattern ?? ''),
        dirPath: p.path as string | undefined,
        filePattern: p.filePattern as string | undefined,
        caseInsensitive: p.caseInsensitive as boolean | undefined,
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

function handleError(error: Error, toolName: string, path: string): ToolResult {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
            success: false,
            error: `File not found: ${path}`,
        };
    }

    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        return {
            success: false,
            error: `Permission denied: ${path}`,
        };
    }

    return {
        success: false,
        error: `${toolName} failed: ${error.message}`,
    };
}
