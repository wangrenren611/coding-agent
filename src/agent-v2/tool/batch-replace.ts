import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';
import { resolveAndValidatePath, PathTraversalError } from './file';

/**
 * 批量替换工具
 *
 * 行为说明：
 * - 每次替换基于原始行内容，而非累积替换
 * - 只替换每行中第一个匹配的 oldText
 * - 不支持跨行替换
 * - 保留原文件的换行符类型（\r\n 或 \n）
 */
export class BatchReplaceTool extends BaseTool<any> {
  name = "batch_replace";

  description = "Replace multiple text segments in a single file call.";

  schema = z.object({
    filePath: z.string().describe("Path to the file to modify"),
    replacements: z.array(z.object({
      line: z.number().describe("Line number (1-based)"),
      oldText: z.string().describe("The exact text segment to replace"),
      newText: z.string().describe("The new text")
    })).describe("Array of replacements to apply in order")
  });

  async execute({ filePath, replacements }: z.infer<typeof this.schema>, _context?: ToolContext): Promise<ToolResult> {
    // === 边界条件：空替换数组 ===
    if (replacements.length === 0) {
      return this.result({
        success: false,
        metadata: { error: 'EMPTY_REPLACEMENTS', filePath, code: 'EMPTY_REPLACEMENTS' } as any,
        output: 'EMPTY_REPLACEMENTS: No replacements provided',
      });
    }

    let fullPath: string;
    try {
      fullPath = resolveAndValidatePath(filePath);
    } catch (error) {
      if (error instanceof PathTraversalError) {
        return this.result({
          success: false,
          metadata: { error: 'PATH_TRAVERSAL_DETECTED', filePath } as any,
          output: `PATH_TRAVERSAL_DETECTED: ${error.message}`,
        });
      }
      throw error;
    }

    // === 业务错误：文件不存在 ===
    if (!fs.existsSync(fullPath)) {
      return this.result({
        success: false,
        metadata: { error: 'FILE_NOT_FOUND', filePath, code: 'FILE_NOT_FOUND' } as any,
        output: 'FILE_NOT_FOUND: File does not exist',
      });
    }

    // === 读取文件并检测换行符类型 ===
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return this.result({
        success: false,
        metadata: { error: 'READ_FAILED', filePath } as any,
        output: `READ_FAILED: Failed to read file: ${error}`,
      });
    }

    // 检测换行符类型：\r\n (Windows) 或 \n (Unix)
    const hasCrLf = content.includes('\r\n');
    const lineBreak = hasCrLf ? '\r\n' : '\n';

    // 统一按 \n 分割进行处理
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const lines = normalizedContent.split('\n');

    // 计算有效行数：如果原文件以换行符结尾，末尾空字符串不计为有效行
    const endsWithLineBreak = normalizedContent.endsWith('\n');
    const effectiveLineCount = endsWithLineBreak ? lines.length - 1 : lines.length;

    const results: Array<{ line: number; success: boolean; message?: string }> = [];
    const processedLines = new Set<number>();
    // 保存每行的原始内容，确保多次替换同一行时基于原始内容
    const originalLines = new Map<number, string>();
    let modifiedCount = 0;

    for (const repl of replacements) {
      const { line, oldText, newText } = repl;

      // === 业务错误：行号越界 ===
      if (line < 1 || line > effectiveLineCount) {
        results.push({
          line,
          success: false,
          message: `Line ${line} is out of range (file has ${effectiveLineCount} lines)`
        });
        continue;
      }

      const targetLineIdx = line - 1;

      // 获取原始行内容（第一次访问时保存）
      if (!originalLines.has(line)) {
        originalLines.set(line, lines[targetLineIdx]);
      }
      const originalLine = originalLines.get(line)!;

      // === 警告：同一行多次替换 ===
      if (processedLines.has(line)) {
        // Multiple replacements on same line, uses original content
      }
      processedLines.add(line);

      // === 业务错误：oldText 不匹配 ===
      if (!originalLine.includes(oldText)) {
        results.push({
          line,
          success: false,
          message: `Text "${oldText}" not found on line ${line}`
        });
        continue;
      }

      // === 执行替换 ===
      // 使用 replaceAll 的替代方案：转义 newText 中的特殊字符
      const escapedNewText = this.escapeReplacementString(newText);
      const newLine = originalLine.replace(oldText, escapedNewText);
      lines[targetLineIdx] = newLine;
      modifiedCount++;

      results.push({ line, success: true });
    }

    // === 写入文件（保留原换行符类型）===
    // 注意：如果原文件以换行符结尾，split('\n') 会产生末尾空字符串元素
    // lines.join(lineBreak) 会自动保留正确的换行符结尾，无需额外添加
    if (modifiedCount > 0) {
      try {
        const newContent = lines.join(lineBreak);
        fs.writeFileSync(fullPath, newContent, 'utf-8');
      } catch (error) {
        return this.result({
          success: false,
          metadata: { error: 'WRITE_FAILED', filePath } as any,
          output: `WRITE_FAILED: Failed to write file: ${error}`,
        });
      }
    }

    const failedCount = results.filter(r => !r.success).length;

    // === 返回结果 ===
    const data = { filePath, results, modifiedCount, failedCount };

    if (failedCount > 0) {
      return this.result({
        success: true,
        metadata: { ...data, toolName: this.name, hasErrors: true },
        output: `Completed with ${failedCount} failures out of ${replacements.length} replacements`,
      });
    }

    return this.result({
      success: true,
      metadata: { ...data, toolName: this.name },
      output: `Successfully completed ${modifiedCount} replacements`,
    });
  }

  /**
   * 转义 replace() 方法中替换字符串的特殊字符
   *
   * String.replace() 的 replacement 参数中：
   * - $$ 插入一个 $
   * - $& 插入匹配的子字符串
   * - $` 插入匹配子字符串之前的文本
   * - $' 插入匹配子字符串之后的文本
   * - $n/$nn 插入第 n/nn 个捕获组
   *
   * 为了避免这些特殊字符被误解析，需要将 $ 替换为 $$
   *
   * 注意：必须使用函数替换的形式，因为在字符串替换中 $$ 本身就需要转义
   * 使用 replacer 函数可以避免这个问题：函数的返回值不会被二次解析
   */
  private escapeReplacementString(text: string): string {
    return text.replace(/\$/g, () => '$$');
  }
}
