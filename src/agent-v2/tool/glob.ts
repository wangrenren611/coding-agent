import { z } from 'zod';
import fg from 'fast-glob';
import { resolve } from 'path';
import { BaseTool, ToolContext, ToolResult } from './base';

const schema = z.object({
    pattern: z.string().describe('Glob pattern like **/*.ts or src/**/*.test.ts'),
    path: z.string().optional().describe('Base directory (default: current working directory)'),
    // limit: z.number().optional().describe('Maximum results to return (default: 100)')
});

export default class GlobTool extends BaseTool<typeof schema> {
    name = 'glob';

    description = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing
  and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively
  perform multiple searches in parallel if potentially useful.`;

    schema = schema;

    async execute({ pattern, path = '.' }: z.infer<typeof schema>, _context?: ToolContext): Promise<ToolResult> {
        const searchPath = resolve(process.cwd(), path);

        // === 底层异常：glob 匹配失败 ===
        let files: string[];
        try {
            files = await fg(pattern, {
                cwd: searchPath,
                absolute: false,
                ignore: [
                    '**/node_modules/**',
                    '**/dist/**',
                    '**/.git/**',
                    '**/coverage/**',
                    '**/.next/**',
                    '**/.nuxt/**',
                    '**/build/**',
                    '**/*.min.js',
                    '**/*.min.css',
                ],
            });
        } catch (error) {
            throw new Error(`Glob matching failed: ${error}`);
        }

        const totalCount = files.length;
        const limitedFiles = files;

        if (limitedFiles.length === 0) {
            return this.result({
                success: true,
                metadata: {
                    files: [],
                },
                output: `No files found matching pattern: ${pattern}`,
            });
        }

        return this.result({
            success: true,
            metadata: {
                pattern,
                path,
                files: limitedFiles,
                totalCount,
            },
            output: `Found ${totalCount} file(s) matching pattern: ${pattern}\n${limitedFiles.join('\n')}`,
        });
    }
}
