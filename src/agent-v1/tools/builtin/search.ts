/**
 * Search Tools - 搜索工具
 *
 * 提供网络搜索、文档搜索等功能
 */

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
 * web_search - 网络搜索（占位实现）
 *
 * 注意：这是一个占位实现。实际使用时，应该集成真实的搜索API，
 * 如 Google Custom Search API、Bing Search API 等。
 */
export const webSearchTool: ToolDefinition = {
    name: 'web_search',
    description: 'Search the web for information. This is a placeholder implementation - integrate with a real search API for production use.',
    category: 'search' as ToolCategory,
    permission: 'safe' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query',
            },
            numResults: {
                type: 'number',
                description: 'Number of results to return (default: 5)',
            },
        },
        required: ['query'],
    },
    execute: async (params: unknown) => {
        const { query, numResults = 5 } = parseWebSearchParams(params);

        // 占位实现：返回模拟结果
        // 实际使用时应该调用真实的搜索API
        return {
            success: true,
            data: {
                query,
                results: [
                    {
                        title: `Search results for: ${query}`,
                        url: 'https://example.com',
                        snippet: 'This is a placeholder result. Integrate with a real search API.',
                    },
                ],
                count: 1,
            },
            retryable: false,
        };
    },
};

/**
 * search_documentation - 搜索技术文档（占位实现）
 *
 * 注意：这是一个占位实现。实际使用时，可以集成：
 * - Context7 API
 * - MDN Web Docs API
 * - 各种框架的官方文档
 */
export const searchDocumentationTool: ToolDefinition = {
    name: 'search_documentation',
    description: 'Search technical documentation for libraries, frameworks, and APIs. This is a placeholder implementation.',
    category: 'search' as ToolCategory,
    permission: 'safe' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Documentation search query',
            },
            library: {
                type: 'string',
                description: 'Specific library or framework to search (e.g., "react", "typescript")',
            },
        },
        required: ['query'],
    },
    execute: async (params: unknown) => {
        const { query, library } = parseDocumentationSearchParams(params);

        // 占位实现：返回模拟结果
        // 实际使用时可以调用 Context7 API 或其他文档搜索API
        return {
            success: true,
            data: {
                query,
                library: library || 'general',
                results: [
                    {
                        title: `Documentation for: ${query}`,
                        url: `https://example.com/docs/${library || 'general'}/${encodeURIComponent(query)}`,
                        snippet: 'This is a placeholder result. Integrate with Context7 or similar API.',
                    },
                ],
                count: 1,
            },
        };
    },
};

/**
 * search_code - 在代码库中搜索代码
 *
 * 这是一个实用的本地代码搜索工具
 */
export const searchCodeTool: ToolDefinition = {
    name: 'search_code',
    description: 'Search for code patterns in the codebase using regex.',
    category: 'search' as ToolCategory,
    permission: 'safe' as PermissionLevel,
    parameters: {
        type: 'object',
        properties: {
            pattern: {
                type: 'string',
                description: 'Regex pattern to search for in code',
            },
            filePattern: {
                type: 'string',
                description: 'Glob pattern to filter files (e.g., "*.ts", "src/**/*.js")',
            },
            contextLines: {
                type: 'number',
                description: 'Number of context lines to include (default: 2)',
            },
        },
        required: ['pattern'],
    },
    execute: async (params: unknown, context: ExecutionContext) => {
        const {
            pattern,
            filePattern = '**/*.{ts,js,tsx,jsx}',
            contextLines = 2,
        } = parseCodeSearchParams(params);

        const { glob } = await import('glob');
        const fs = await import('fs/promises');
        const path = await import('path');

        try {
            const regex = new RegExp(pattern, 'g');

            // 查找匹配的文件
            const files = await glob.glob(filePattern, {
                cwd: context.workingDirectory,
                windowsPathsNoEscape: true,
                absolute: true,
            });

            const results: Array<{
                file: string;
                matches: Array<{
                    line: number;
                    content: string;
                    contextBefore: string[];
                    contextAfter: string[];
                }>;
            }> = [];

            for (const filePath of files) {
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const lines = content.split('\n');

                    const matches: Array<{
                        line: number;
                        content: string;
                        contextBefore: string[];
                        contextAfter: string[];
                    }> = [];

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        regex.lastIndex = 0; // 重置正则表达式

                        if (regex.test(line)) {
                            matches.push({
                                line: i + 1,
                                content: line,
                                contextBefore: lines.slice(
                                    Math.max(0, i - contextLines),
                                    i
                                ),
                                contextAfter: lines.slice(
                                    i + 1,
                                    Math.min(lines.length, i + 1 + contextLines)
                                ),
                            });
                        }
                    }

                    if (matches.length > 0) {
                        const relativePath = path.relative(
                            context.workingDirectory,
                            filePath
                        );
                        results.push({
                            file: relativePath,
                            matches,
                        });
                    }
                } catch {
                    // 跳过无法读取的文件
                }
            }

            const totalMatches = results.reduce(
                (sum, r) => sum + r.matches.length,
                0
            );

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
            return {
                success: false,
                error: `Code search failed: ${(error as Error).message}`,
            };
        }
    },
};

// =============================================================================
// 导出所有工具
// =============================================================================

export const searchTools: ToolDefinition[] = [
    webSearchTool,
    searchDocumentationTool,
    searchCodeTool,
];

// =============================================================================
// 辅助函数
// =============================================================================

function parseWebSearchParams(params: unknown): {
    query: string;
    numResults: number;
} {
    const p = params as Record<string, unknown>;
    return {
        query: String(p.query ?? ''),
        numResults: Number(p.numResults ?? 5),
    };
}

function parseDocumentationSearchParams(params: unknown): {
    query: string;
    library?: string;
} {
    const p = params as Record<string, unknown>;
    return {
        query: String(p.query ?? ''),
        library: p.library as string | undefined,
    };
}

function parseCodeSearchParams(params: unknown): {
    pattern: string;
    filePattern?: string;
    contextLines?: number;
} {
    const p = params as Record<string, unknown>;
    return {
        pattern: String(p.pattern ?? ''),
        filePattern: p.filePattern as string | undefined,
        contextLines: p.contextLines as number | undefined,
    };
}
