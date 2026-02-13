/**
 * Tool 模块公共工具函数
 * 
 * 提取各工具类中通用的功能，减少代码重复
 */

import * as path from 'path';

/**
 * 默认忽略模式（用于 grep、glob 等搜索工具）
 */
export const DEFAULT_IGNORE_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/*.min.js',
    '**/*.min.css',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/build/**',
] as const;

/**
 * 标准化路径：将 Windows 路径转换为 Unix 风格
 */
export function normalizeFilePath(cwd: string, filePath: string): string {
    const rel = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
    return rel.split(path.sep).join('/');
}

/**
 * 解析相对路径为绝对路径
 */
export function resolvePath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\\\/g, '/');
    return path.resolve(process.cwd(), normalizedPath);
}

/**
 * 标准化换行符：将 CRLF 转换为 LF
 */
export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/**
 * 按换行符分割并移除尾部空行
 * (与 read_file 处理逻辑一致)
 * 
 * 重要提示：仅在文本以换行符结尾时才移除尾部空字符串
 * - "a\nb\n" → ["a", "b"] (尾部换行产生空字符串，移除)
 * - "" → [""] (空字符串表示一行空行，保留)
 * - "a\nb" → ["a", "b"] (无尾部换行，无需处理)
 */
export function splitAndFilterEmptyTail(text: string): string[] {
    const lines = text.split('\n');
    if (text.endsWith('\n') && lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

/**
 * 转义字符串用于显示
 */
export function escapeString(s: string): string {
    return s
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

/**
 * 生成上下文代码片段（用于调试）
 */
export function generateContextSnippet(
    lines: string[],
    targetLineIdx: number,
    lineCount: number,
    contextLines: number = 5
): string {
    const startIdx = Math.max(0, targetLineIdx - contextLines);
    const endIdx = Math.min(lines.length, targetLineIdx + lineCount + contextLines);
    
    const maxLineNum = endIdx.toString().length;
    
    const result: string[] = [];
    for (let i = startIdx; i < endIdx; i++) {
        const lineNum = (i + 1).toString().padStart(maxLineNum, ' ');
        const prefix = (i >= targetLineIdx && i < targetLineIdx + lineCount) ? '>>>' : '   ';
        result.push(`${prefix} ${lineNum} | ${lines[i]}`);
    }
    
    return result.join('\n');
}

/**
 * 生成详细差异报告
 */
export function generateDiffReport(actual: string, expected: string): string {
    const lines: string[] = [];
    
    lines.push(`    Actual length: ${actual.length}`);
    lines.push(`    Expected length: ${expected.length}`);
    
    // 找出第一个差异位置
    const minLen = Math.min(actual.length, expected.length);
    let firstDiff = -1;
    for (let i = 0; i < minLen; i++) {
        if (actual[i] !== expected[i]) {
            firstDiff = i;
            break;
        }
    }
    
    if (firstDiff >= 0) {
        lines.push(`    First difference at char ${firstDiff}:`);
        
        const contextStart = Math.max(0, firstDiff - 10);
        const contextEnd = firstDiff + 20;
        
        lines.push(`    Context:`);
        lines.push(`      Actual [...${contextStart}..${firstDiff}..]: "${escapeString(actual.slice(contextStart, contextEnd))}"`);
        lines.push(`      Expected [...${contextStart}..${firstDiff}..]: "${escapeString(expected.slice(contextStart, contextEnd))}"`);
        
        lines.push(`    Diff chars:`);
        lines.push(`      Actual[${firstDiff}]: ${JSON.stringify(actual[firstDiff])} (code: ${actual.charCodeAt(firstDiff)})`);
        lines.push(`      Expected[${firstDiff}]: ${JSON.stringify(expected[firstDiff])} (code: ${expected.charCodeAt(firstDiff)})`);
    } else if (actual.length !== expected.length) {
        const diff = expected.length - actual.length;
        lines.push(`    Length diff: ${diff > 0 ? '+' : ''}${diff}`);
        
        if (diff > 0) {
            lines.push(`    Extra content in expected: "${escapeString(expected.slice(actual.length))}"`);
        } else {
            lines.push(`    Extra content in actual: "${escapeString(actual.slice(expected.length))}"`);
        }
    }
    
    return lines.join('\n');
}
