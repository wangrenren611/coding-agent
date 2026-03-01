import fs from 'fs';
import path from 'path';
import { isBinaryFile } from 'isbinaryfile';
import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';

/**
 * 安全路径解析错误
 */
export class PathTraversalError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PathTraversalError';
    }
}

/**
 * 路径安全策略
 */
interface PathSecurityPolicy {
    /** 允许的根目录列表（白名单） */
    allowedRoots?: string[];
    /** 禁止访问的路径模式（黑名单） */
    deniedPatterns?: RegExp[];
    /** 是否允许访问工作目录外的绝对路径 */
    allowAbsolutePaths?: boolean;
    /** 是否解析符号链接（防止符号链接攻击） */
    resolveSymlinks?: boolean;
    /** 敏感目录黑名单（默认启用） */
    enableSensitiveDirProtection?: boolean;
    /** 审计日志回调 */
    onAccess?: (path: string, allowed: boolean, reason?: string) => void;
}

/**
 * 默认敏感目录黑名单（跨平台）
 */
const DEFAULT_DENIED_PATTERNS: RegExp[] = [
    // Unix 系统敏感目录
    /^\/etc\//i,
    /^\/root\//i,
    /^\/var\/log\//i,
    /^\/proc\//i,
    /^\/sys\//i,
    // SSH 密钥
    /\/\.ssh\//i,
    /\/\.ssh$/i,
    // 云服务凭证
    /\/\.aws\//i,
    /\/\.azure\//i,
    /\/\.gcp\//i,
    /\/\.config\/gcloud\//i,
    // 环境变量文件
    /\/\.env$/i,
    /\/\.env\./i,
    // 私钥文件
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /\.pfx$/i,
    // Windows 敏感目录
    /^\/[a-zA-Z]:\/(Windows|Program Files|Program Files \(x86\))\//i,
    // Git 配置
    /\/\.gitconfig$/i,
    /\/\.git-credentials$/i,
];

/**
 * 安全的 realpath 同步版本
 */
function safeRealpathSync(p: string): string {
    try {
        return fs.realpathSync(p);
    } catch {
        return p;
    }
}

/**
 * 检查路径是否匹配黑名单
 */
function isDeniedPath(normalizedPath: string, patterns: RegExp[]): { denied: boolean; pattern?: string } {
    for (const pattern of patterns) {
        if (pattern.test(normalizedPath)) {
            return { denied: true, pattern: pattern.source };
        }
    }
    return { denied: false };
}

/**
 * 安全解析并验证路径
 *
 * 安全策略（多层防护）：
 * 1. 输入规范化（URL 解码、路径分隔符统一）
 * 2. 注入检测（空字节等）
 * 3. 黑名单检查（敏感目录和文件）
 * 4. 符号链接解析（防止符号链接攻击）
 * 5. 白名单验证（路径必须在允许的根目录内）
 * 6. 审计日志（记录所有访问）
 *
 * @param filePath 用户提供的文件路径
 * @param policy 安全策略配置
 * @returns 解析后的安全绝对路径
 * @throws PathTraversalError 如果路径不安全
 */
export function resolveAndValidatePath(filePath: string, policy: PathSecurityPolicy = {}): string {
    // 从环境变量读取安全配置
    const envAllowAbsolute = process.env.AGENT_ALLOW_ABSOLUTE_PATHS;
    const envDisableSensitiveProtection = process.env.AGENT_DISABLE_SENSITIVE_DIR_PROTECTION;

    const {
        allowedRoots = [process.cwd()],
        deniedPatterns = [],
        // AI 编码助手默认允许绝对路径（需要访问项目外的文件）
        // 但敏感目录保护仍然启用
        allowAbsolutePaths = envAllowAbsolute !== 'false', // 默认允许，除非显式禁用
        resolveSymlinks = true,
        // 敏感目录保护默认启用（关键安全防护）
        enableSensitiveDirProtection = envDisableSensitiveProtection !== 'true',
        onAccess,
    } = policy;

    // 合并黑名单
    const allDeniedPatterns = enableSensitiveDirProtection
        ? [...DEFAULT_DENIED_PATTERNS, ...deniedPatterns]
        : deniedPatterns;

    // 1. 解码 URL 编码（防止编码绕过）
    let decodedPath = filePath;
    try {
        // 处理双重编码
        let decoded = decodeURIComponent(filePath);
        while (decoded !== filePath) {
            filePath = decoded;
            decoded = decodeURIComponent(filePath);
        }
        decodedPath = decoded;
    } catch {
        // 解码失败时使用原始路径
    }

    // 2. 规范化路径分隔符
    const normalizedInput = decodedPath.replace(/\\/g, '/');

    // 3. 检查空字节注入
    if (normalizedInput.includes('\0')) {
        onAccess?.(filePath, false, 'Null byte injection');
        throw new PathTraversalError('Invalid path: contains null bytes');
    }

    // 4. 黑名单检查（在解析前检查，防止绕过）
    const denialCheck = isDeniedPath(normalizedInput, allDeniedPatterns);
    if (denialCheck.denied) {
        onAccess?.(filePath, false, `Matched denial pattern: ${denialCheck.pattern}`);
        throw new PathTraversalError(`Access denied: path matches restricted pattern`);
    }

    // 5. 解析为绝对路径
    const resolvedPath = path.resolve(process.cwd(), normalizedInput);

    // 6. 解析符号链接（防止符号链接攻击）
    let finalPath = resolvedPath;
    if (resolveSymlinks) {
        try {
            finalPath = fs.realpathSync(resolvedPath);
        } catch {
            // 文件不存在时，检查父目录
            const parentDir = path.dirname(resolvedPath);
            try {
                const resolvedParent = fs.realpathSync(parentDir);
                finalPath = path.join(resolvedParent, path.basename(resolvedPath));
            } catch {
                finalPath = resolvedPath;
            }
        }
    }

    // 7. 再次检查解析后的路径（符号链接可能指向敏感位置）
    const finalNormalized = finalPath.replace(/\\/g, '/');
    const finalDenialCheck = isDeniedPath(finalNormalized, allDeniedPatterns);
    if (finalDenialCheck.denied) {
        onAccess?.(filePath, false, `Resolved path matched denial pattern: ${finalDenialCheck.pattern}`);
        throw new PathTraversalError(`Access denied: resolved path points to restricted location`);
    }

    // 8. 规范化允许的根目录
    const normalizedRoots = allowedRoots.map((root) => {
        const normalized = path.resolve(root);
        return resolveSymlinks ? safeRealpathSync(normalized) : normalized;
    });

    // 9. 验证路径是否在允许的根目录内（大小写不敏感，Windows 兼容）
    const isAllowed = normalizedRoots.some((root) => {
        const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
        return (
            finalPath.toLowerCase() === root.toLowerCase() ||
            finalPath.toLowerCase().startsWith(rootWithSep.toLowerCase())
        );
    });

    // 10. 处理不在白名单内的路径
    if (!isAllowed) {
        if (allowAbsolutePaths && path.isAbsolute(normalizedInput)) {
            // 允许绝对路径但记录审计日志
            onAccess?.(filePath, true, 'Absolute path outside workspace (allowed by policy)');
            // console.warn(`[Security] External path access: ${finalPath}`);
            return finalPath;
        }

        onAccess?.(filePath, false, 'Path outside allowed directories');
        throw new PathTraversalError(`Path traversal detected: "${filePath}" resolves outside allowed directories`);
    }

    // 11. 记录成功访问
    onAccess?.(filePath, true);
    return finalPath;
}

const readFileSchema = z.object({
    filePath: z.string(),
    startLine: z.number().optional().describe('The line number to start reading from (1-based, defaults to 1)'),
    endLine: z.number().optional().describe('The ending line number to read to (1-based, inclusive)'),
});

export class ReadFileTool extends BaseTool<typeof readFileSchema> {
    name = 'read_file';
    description = `Read a file from the local filesystem. You can access any file directly by using this tool.

Assume that the file path provided by the user is valid.

It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files),
  but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can read images (eg PNG, JPG, etc). When reading an image file the contents
  are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). PDFs are processed page by page, extracting both
  text and visual content for analysis.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their
  outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command
  via the Bash tool.
- It's often better to speculatively read multiple potentially useful files in parallel
  in a single response. When this is the case, prefer reading in parallel: one message
  with multiple Read tool calls.`;

    schema = readFileSchema;

    async execute(
        args: { filePath: string; startLine?: number; endLine?: number },
        _context?: ToolContext
    ): Promise<ToolResult> {
        const { filePath, startLine, endLine } = args;
        const fullPath = this.resolvePath(filePath);

        // === 业务错误：文件不存在 ===
        if (!fs.existsSync(fullPath)) {
            return this.result({
                success: false,
                metadata: { error: 'FILE_NOT_FOUND' },
                output: 'FILE_NOT_FOUND: File not found',
            });
        }

        // === 业务错误：路径是目录 ===
        const stats = fs.statSync(fullPath);
        if (!stats.isFile()) {
            return this.result({
                success: false,
                metadata: { error: 'PATH_IS_DIRECTORY' },
                output: 'PATH_IS_DIRECTORY: Path is a directory',
            });
        }

        // === 业务错误：二进制文件 ===
        if (await isBinaryFile(fullPath)) {
            return this.result({
                success: false,
                metadata: { error: 'BINARY_FILE' },
                output: 'BINARY_FILE: Cannot read binary file',
            });
        }

        // === 底层异常：读取文件失败 ===
        let content: string;
        try {
            content = fs.readFileSync(fullPath, 'utf-8');
        } catch (error) {
            throw new Error(`Failed to read file: ${error}`);
        }

        // 特殊处理：空文件直接返回
        if (content === '') {
            return this.result({
                success: true,
                metadata: {
                    filePath,
                    content: '',
                    range: { startLine: 0, endLine: 0 },
                },
                output: `Content from ${filePath}: (empty file)`,
            });
        }

        // 规范化换行符：将 CRLF 转换为 LF，避免 split 后行末尾有 \r
        const normalizedContent = content.replace(/\r\n/g, '\n');

        // 按换行符分割，并移除末尾空行（由文件末尾换行符产生的空字符串）
        const allLines = normalizedContent.split('\n');
        const lines = allLines.filter((line, idx) => !(idx === allLines.length - 1 && line === ''));
        const totalLines = lines.length;

        // 将 1-based 行号转换为 0-based 数组索引
        // startLine 默认为 1（第一行）
        const startIndex = startLine !== undefined && startLine > 0 ? startLine - 1 : 0;

        // endLine 是结束行号（1-based，inclusive），默认为文件末尾
        // 如果指定了 endLine，需要转换为 0-based 索引并 +1（因为 slice 的 end 是 exclusive）
        const endIndex = endLine !== undefined && endLine > 0 ? endLine : totalLines;

        // 验证行号范围
        if (startIndex >= totalLines) {
            return this.result({
                success: false,
                metadata: { error: 'START_LINE_OUT_OF_RANGE' },
                output: 'START_LINE_OUT_OF_RANGE: Start line is out of range',
            });
        }

        if (endIndex <= startIndex) {
            return this.result({
                success: false,
                metadata: { error: 'INVALID_LINE_RANGE' },
                output: 'INVALID_LINE_RANGE: Invalid line range',
            });
        }

        const selectedLines = lines.slice(startIndex, endIndex);
        // 如果没有指定行范围，直接返回原始内容（保留原始换行符）
        const hasLineRange = startLine !== undefined || endLine !== undefined;
        const fileContent = hasLineRange ? selectedLines.join('\n') : content;
        const MAX_RETURN_CHARS = 50000;
        const truncated = fileContent.length > MAX_RETURN_CHARS;
        const returnedContent = truncated ? fileContent.slice(0, MAX_RETURN_CHARS) : fileContent;

        return this.result({
            success: true,
            metadata: {
                filePath,
                content: returnedContent,
                range: { startLine: startIndex + 1, endLine: endIndex },
                truncated,
                originalLength: fileContent.length,
            },
            output: truncated
                ? `Content from ${filePath} (lines ${startIndex + 1}-${endIndex}):\n\n${returnedContent}\n\n[... Content truncated for brevity ...]`
                : hasLineRange
                  ? `Content from ${filePath} (lines ${startIndex + 1}-${endIndex}):\n\n${returnedContent}`
                  : `Content from ${filePath}:\n\n${returnedContent}`,
        });
    }

    private resolvePath(filePath: string): string {
        try {
            return resolveAndValidatePath(filePath);
        } catch (error) {
            if (error instanceof PathTraversalError) {
                // 路径遍历攻击，返回业务错误
                throw error;
            }
            throw error;
        }
    }
}

const writeFileSchema = z
    .object({
        filePath: z.string().describe('Required. The absolute or relative path to the file'),
        content: z
            .string()
            .describe(
                'Required. The complete file content as a plain string. ' +
                    'IMPORTANT: Provide the raw content directly, NOT wrapped in markdown code blocks or backticks. ' +
                    'All newlines, quotes, and special characters will be properly handled automatically.'
            ),
    })
    .strict();

export class WriteFileTool extends BaseTool<typeof writeFileSchema> {
    name = 'write_file';

    description = `Writes a file to the local filesystem.

This tool will overwrite the existing file if there is one at the provided path.

If this is an existing file, you MUST use the Read tool first to read the file's contents.
This tool will fail if you did not read the file first.

ALWAYS prefer editing existing files in the codebase. NEVER write new files unless
explicitly required.

NEVER proactively create documentation files (*.md) or README files. Only create
documentation files if explicitly requested by the User.

Only use emojis if the user explicitly requests it. Avoid adding emojis to files
unless asked.

When the user provides a path to a file assume that path is valid.`;

    schema = writeFileSchema;

    async execute({ filePath, content }: z.infer<typeof writeFileSchema>, _context?: ToolContext): Promise<ToolResult> {
        const fullPath = this.resolvePath(filePath);

        // === 业务错误：路径是目录 ===
        if (fs.existsSync(fullPath)) {
            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()) {
                return this.result({
                    success: false,
                    metadata: { error: 'PATH_IS_DIRECTORY' },
                    output: 'PATH_IS_DIRECTORY: Cannot write to directory',
                });
            }
            // === 业务错误：二进制文件 ===
            if (await isBinaryFile(fullPath)) {
                return this.result({
                    success: false,
                    metadata: { error: 'CANNOT_WRITE_BINARY_FILE' },
                    output: 'CANNOT_WRITE_BINARY_FILE: Cannot write binary file',
                });
            }
        }

        // === 底层异常：写入文件失败 ===
        try {
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content);
        } catch (error) {
            throw new Error(`Failed to write file: ${error}`);
        }

        return this.result({
            success: true,
            metadata: { success: true, filePath },
            output: `Successfully wrote ${content.length} bytes to ${filePath}`,
        });
    }

    private resolvePath(filePath: string): string {
        return resolveAndValidatePath(filePath);
    }
}
