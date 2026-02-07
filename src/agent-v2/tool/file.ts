import fs from 'fs';
import path from 'path';
import { isBinaryFile } from 'isbinaryfile';
import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';

const readFileSchema = z.object({
  filePath: z.string(),
  startLine: z.number().optional().describe("The line number to start reading from (1-based, defaults to 1)"),
  endLine: z.number().optional().describe("The ending line number to read to (1-based, inclusive)")
})

export class ReadFileTool extends BaseTool<typeof readFileSchema> {
  name = "read_file";
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

  async execute(args: { filePath: string; startLine?: number; endLine?: number; }, _context?: ToolContext): Promise<ToolResult> {
    const { filePath, startLine, endLine } = args;
    const fullPath = this.resolvePath(filePath);

    // === 业务错误：文件不存在 ===
    if (!fs.existsSync(fullPath)) {
      return this.result({
        success: false,
        metadata: { error: 'FILE_NOT_FOUND' } as any,
        output: 'FILE_NOT_FOUND: File not found',
      });
    }

    // === 业务错误：路径是目录 ===
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) {
      return this.result({
        success: false,
        metadata: { error: 'PATH_IS_DIRECTORY' } as any,
        output: 'PATH_IS_DIRECTORY: Path is a directory',
      });
    }

    // === 业务错误：二进制文件 ===
    if (await isBinaryFile(fullPath)) {
      return this.result({
        success: false,
        metadata: { error: 'BINARY_FILE' } as any,
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

    const lines = content.split('\n');
    const totalLines = lines.length;

    // 将 1-based 行号转换为 0-based 数组索引
    // startLine 默认为 1（第一行）
    const startIndex = (startLine !== undefined && startLine > 0) ? startLine - 1 : 0;

    // endLine 是结束行号（1-based，inclusive），默认为文件末尾
    // 如果指定了 endLine，需要转换为 0-based 索引并 +1（因为 slice 的 end 是 exclusive）
    const endIndex = (endLine !== undefined && endLine > 0) ? endLine : totalLines;

    // 验证行号范围
    if (startIndex >= totalLines) {
      return this.result({
        success: false,
        metadata: { error: 'START_LINE_OUT_OF_RANGE' } as any,
        output: 'START_LINE_OUT_OF_RANGE: Start line is out of range',
      });
    }

    if (endIndex <= startIndex) {
      return this.result({
        success: false,
        metadata: { error: 'INVALID_LINE_RANGE' } as any,
        output: 'INVALID_LINE_RANGE: Invalid line range',
      });
    }

    const selectedLines = lines.slice(startIndex, endIndex);
    const fileContent = selectedLines.join('\n');

    return this.result({
      success: true,
      metadata: {
        filePath,
        content: fileContent,
        range: { startLine: startIndex + 1, endLine: endIndex },
      },
      output: content.length > 50000
        ? `Content from ${filePath} (lines ${startIndex + 1}-${endIndex}):\n\n${fileContent}\n\n[... Content truncated for brevity ...]`
        : `Content from ${filePath}:\n\n${fileContent}`,
    });
  }

  private resolvePath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return path.resolve(process.cwd(), normalizedPath);
  }
}

const writeFileSchema = z.object({
  filePath: z.string().describe("Required. The absolute or relative path to the file"),
  content: z.string().describe(
    "Required. The complete file content as a plain string. " +
    "IMPORTANT: Provide the raw content directly, NOT wrapped in markdown code blocks or backticks. " +
    "All newlines, quotes, and special characters will be properly handled automatically."
  ),
}).strict();

export class WriteFileTool extends BaseTool<typeof writeFileSchema> {

  name = "write_file";

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
          metadata: { error: 'PATH_IS_DIRECTORY' } as any,
          output: 'PATH_IS_DIRECTORY: Cannot write to directory',
        });
      }
      // === 业务错误：二进制文件 ===
      if (await isBinaryFile(fullPath)) {
        return this.result({
          success: false,
          metadata: { error: 'CANNOT_WRITE_BINARY_FILE' } as any,
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
    const normalizedPath = filePath.replace(/\\/g, '/');
    return path.resolve(process.cwd(), normalizedPath);
  }
}
