import fs from 'fs';
import path from 'path';
import { isBinaryFile } from 'isbinaryfile';
import { z } from 'zod';
import { BaseTool, ToolResult } from './base';

const readFileSchema = z.object({
  filePath: z.string(),
  startLine: z.number().optional().describe("The line number to start reading from (1-based, defaults to 1)"),
  endLine: z.number().optional().describe("The ending line number to read to (1-based, inclusive)")
})

export class ReadFileTool extends BaseTool<typeof readFileSchema> {
  name = "read_file";
  description = `Read file content with line numbers.

IMPORTANT USAGE GUIDELINES:
- DEFAULT: Read the ENTIRE file by omitting startLine/endLine parameters
- ONLY use range reading for files larger than 500 lines
- If you need to read a file, ALWAYS try reading it completely first
- The tool will return line numbers to help you navigate
- Most files are small enough to read entirely. Avoid premature optimization

Path formats supported:
- Relative paths: "src/file.ts", "./src/file.ts"
- Absolute paths: "/home/user/file.ts" (Unix), "C:\\Users\\user\\file.ts" (Windows)
- The tool automatically normalizes paths for cross-platform compatibility`;

  schema = readFileSchema;

  async execute(args: { filePath: string; startLine?: number; endLine?: number; }): Promise<ToolResult> {
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

  description =
    "Write the entire file content to a specified path. " +
    "CRITICAL: You MUST provide BOTH filePath AND content parameters.\n\n" +
    "Parameters:\n" +
    "- filePath: The file path (required). Supports relative and absolute paths.\n" +
    "- content: The file content as raw string (required)\n\n" +
    "Example:\n" +
    '{\n' +
    '  "filePath": "src/example.ts",\n' +
    '  "content": "console.log(\\"Hello\\");"\n' +
    '}\n\n' +
    "IMPORTANT: For the content parameter, provide the raw file content directly as a plain string. " +
    "Do NOT wrap it in markdown code blocks (```), backticks, or any other formatting. " +
    "Just pass the actual file content as-is.\n\n" +
    "Path formats supported:\n" +
    "- Relative: \"src/file.ts\"\n" +
    "- Absolute Unix: \"/home/user/file.ts\"\n" +
    "- Absolute Windows: \"C:\\Users\\user\\file.ts\"";

  schema = writeFileSchema;

  async execute({ filePath, content }: z.infer<typeof writeFileSchema>): Promise<ToolResult> {
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
