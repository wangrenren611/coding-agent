import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { BaseTool, ToolResult } from './base';

export class SurgicalEditTool extends BaseTool<any> {

  name = "precise_replace";

  description = `Precise code replacement using line numbers and exact text matching.

IMPORTANT: Supports multi-line replacement. The 'line' parameter specifies the STARTING line number of 'oldText'.

How it works:
1. Find the text segment starting at 'line' that exactly matches 'oldText'
2. Replace that entire segment with 'newText'
3. Both 'oldText' and 'newText' can span multiple lines

Example: If lines 5-10 contain 'old_func', and you want to replace with 'new_func':
- line: 5 (starting line)
- oldText: (exact text from lines 5-10)
- newText: (replacement text)

Use this tool when:
- You need precise control over what gets replaced
- Read/Write tool failed or is too slow
- Working with large files`;

  schema = z.object({
    filePath: z.string().describe("The absolute or relative path to the file"),
    line: z.number().describe("Starting line number (1-based) where oldText begins"),
    oldText: z.string().describe("The exact text to replace - can span multiple lines"),
    newText: z.string().describe("The replacement text - can span multiple lines")
  }).strict();

  async execute({ filePath, line, oldText, newText }: z.infer<typeof this.schema>): Promise<ToolResult> {
    const fullPath = path.resolve(process.cwd(), filePath);

    // === 业务错误：文件不存在 ===
    if (!fs.existsSync(fullPath)) {
      return this.result({
        success: false,
        metadata: { error: 'FILE_NOT_FOUND', filePath } as any,
        output: `FILE_NOT_FOUND: ${filePath}`,
      });
    }

    // === 读取文件 ===
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`);
    }

    // Normalize line endings (convert CRLF to LF) for consistent processing
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const lines = normalizedContent.split('\n');

    // === 业务错误：行号越界 ===
    if (line < 1 || line > lines.length) {
      return this.result({
        success: false,
        metadata: { error: 'LINE_OUT_OF_RANGE', line, fileLength: lines.length } as any,
        output: `LINE_OUT_OF_RANGE: line ${line} is out of range (file has ${lines.length} lines)`,
      });
    }

    const targetLineIdx = line - 1;

    // 将 oldText 按行分割，用于多行匹配
    const oldTextLines = oldText.split('\n');

    // 检查从指定行开始是否有足够的行数
    if (targetLineIdx + oldTextLines.length > lines.length) {
      return this.result({
        success: false,
        metadata: {
          error: 'TEXT_NOT_FOUND',
          reason: 'Not enough lines from specified position',
          expectedLines: oldTextLines.length,
          availableLines: lines.length - targetLineIdx
        } as any,
        output: 'TEXT_NOT_FOUND: Not enough lines from specified position',
      });
    }

    // 提取从指定行开始的实际文本
    const actualText = lines.slice(targetLineIdx, targetLineIdx + oldTextLines.length).join('\n');

    // === 业务错误：oldText 不匹配 ===
    if (actualText !== oldText) {
      return this.result({
        success: false,
        metadata: {
          error: 'TEXT_NOT_FOUND',
          line,
          expectedLines: oldTextLines.length,
          reason: 'Text at specified position does not match oldText',
          expectedPreview: oldTextLines.slice(0, 2).join('\n'),
          actualPreview: lines.slice(targetLineIdx, targetLineIdx + 2).join('\n')
        } as any,
        output: 'TEXT_NOT_FOUND: Text at specified position does not match oldText',
      });
    }

    // === 执行修改（支持多行替换）===
    const newTextLines = newText.split('\n');
    lines.splice(targetLineIdx, oldTextLines.length, ...newTextLines);

    // === 写入文件 ===
    try {
      fs.writeFileSync(fullPath, lines.join('\n'));
    } catch (error) {
      throw new Error(`Failed to write file: ${error}`);
    }

    return this.result({
      success: true,
      metadata: {
        filePath,
        line,
        message: 'Modification successful'
      },
      output: `Replaced line ${line} in ${filePath}`,
    });
  }
}
