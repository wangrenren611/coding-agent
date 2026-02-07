import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';

const schema = z.object({
  pattern: z.string().min(1).describe('Regex pattern'),
  filePattern: z.string().nullable().optional().default(null).describe('Glob include filter'),
  path: z.string().nullable().optional().default(null).describe('Search root'),
  caseMode: z.enum(['smart', 'sensitive', 'insensitive']).optional().default('smart'),
  word: z.boolean().optional().default(false),
  multiline: z.boolean().optional().default(false),
  pcre2: z.boolean().optional().default(false),
  includeHidden: z.boolean().optional().default(false),
  noIgnore: z.boolean().optional().default(false),
});

type Input = z.infer<typeof schema>;

type GrepMatch = {
  line: number | null;
  column: number | null;
  content: string;
  matchText?: string;
  start?: number;
  end?: number;
};

type GrepFileResult = {
  file: string;
  mtimeMs: number | null;
  mtimeIso: string | null;
  matches: GrepMatch[];
};

function toDisplayString(arbitrary: any): string {
  if (!arbitrary) return '';
  if (typeof arbitrary.text === 'string') return arbitrary.text;
  if (typeof arbitrary.bytes === 'string') {
    try {
      return Buffer.from(arbitrary.bytes, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  return '';
}

function normalizeFilePath(cwd: string, p: string): string {
  const rel = path.isAbsolute(p) ? path.relative(cwd, p) : p;
  return rel.split(path.sep).join('/');
}

export default class GrepTool extends BaseTool<typeof schema> {
  name = 'grep';
  timeoutMs = 1000 * 60;

  description = `A powerful search tool built on ripgrep

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command.
  The Grep tool has been optimized for correct permissions and access.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter
  (e.g., "js", "py", "rust", "go", "java", etc.). More efficient than include for
  common file types.
- Output modes: "content" shows matching lines (supports -A/-B/-C context, -n line
  numbers, head_limit), "files_with_matches" shows only file paths (default),
  "count" shows match counts (supports head_limit). Defaults to "files_with_matches".
- Use Task tool for open-ended searches requiring multiple rounds
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping
  (use interface\\{\\} to find interface{} in Go code)
- Multiline matching: By default patterns match within single lines only.
  For cross-line patterns like struct \\{[\\s\\S]*?field\`, use multiline: true`;

  schema = schema;

  async execute(raw: unknown, _context?: ToolContext): Promise<ToolResult> {
    const input: Input = schema.parse(raw);
    const {
      pattern,
      filePattern,
      includeHidden,
      caseMode,
      word,
      multiline,
      pcre2,
      noIgnore,
      path: searchRoot,
    } = input;

    const cwd = process.cwd();
    const ignoreGlobs = [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/*.min.js',
      '**/*.min.css',
      '**/coverage/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/build/**',
    ];

    // === 获取 ripgrep 路径（使用动态导入）===
    let rgBin: string;
    try {
      const vscodeRg = await import('@vscode/ripgrep');
      rgBin = vscodeRg.rgPath;
    } catch (error) {
      return this.result({
        success: false,
        metadata: {
          error: 'RIPGREP_LOAD_FAILED',
          message: `Failed to load ripgrep module: ${error instanceof Error ? error.message : String(error)}`
        } as any,
        output: 'RIPGREP_LOAD_FAILED: Failed to load ripgrep module',
      });
    }

    // === 验证 ripgrep 二进制文件存在且有执行权限 ===
    try {
      await fs.access(rgBin, fs.constants.X_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.result({
          success: false,
          metadata: {
            error: 'RIPGREP_NOT_FOUND',
            path: rgBin
          } as any,
          output: 'RIPGREP_NOT_FOUND: ripgrep binary not found',
        });
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        return this.result({
          success: false,
          metadata: {
            error: 'RIPGREP_NO_PERMISSION',
            path: rgBin
          } as any,
          output: 'RIPGREP_NO_PERMISSION: No permission to execute ripgrep',
        });
      }
      return this.result({
        success: false,
        metadata: {
          error: 'RIPGREP_ACCESS_ERROR',
          path: rgBin,
          errorMsg: error instanceof Error ? error.message : String(error)
        } as any,
        output: 'RIPGREP_ACCESS_ERROR: Cannot access ripgrep',
      });
    }

    // === 验证搜索根目录是否存在且可访问 ===
    const resolvedSearchRoot = searchRoot ? path.resolve(cwd, searchRoot) : cwd;
    try {
      await fs.access(resolvedSearchRoot, fs.constants.R_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.result({
          success: false,
          metadata: {
            error: 'SEARCH_PATH_NOT_FOUND',
            path: resolvedSearchRoot
          } as any,
          output: 'SEARCH_PATH_NOT_FOUND: Search path does not exist',
        });
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        return this.result({
          success: false,
          metadata: {
            error: 'SEARCH_PATH_NO_PERMISSION',
            path: resolvedSearchRoot
          } as any,
          output: 'SEARCH_PATH_NO_PERMISSION: No permission to read search path',
        });
      }
    }

    // === 验证 pattern 参数有效性 ===
    if (!pattern || pattern.trim().length === 0) {
      return this.result({
        success: false,
        metadata: { error: 'INVALID_PATTERN' } as any,
        output: 'INVALID_PATTERN: Search pattern cannot be empty',
      });
    }

    // === 构建 ripgrep 参数 ===
    const args: string[] = [];
    args.push('--json', '--no-messages');

    if (filePattern) args.push('--glob', filePattern);
    // Only apply ignore globs if noIgnore is false
    if (!noIgnore) {
      for (const g of ignoreGlobs) args.push('--glob', `!${g}`);
    }
    if (includeHidden) args.push('--hidden');
    if (noIgnore) args.push('--no-ignore');

    if (caseMode === 'smart') args.push('--smart-case');
    else if (caseMode === 'insensitive') args.push('--ignore-case');
    else args.push('--case-sensitive');

    if (word) args.push('--word-regexp');
    if (multiline) args.push('--multiline');
    if (pcre2) args.push('--pcre2');

    args.push('--', pattern, resolvedSearchRoot);

    const fileMap = new Map<string, { matches: GrepMatch[] }>();
    let truncated = false;
    let timedOut = false;
    let stderr = '';

    try {
      // === 创建子进程，提前注册 error 监听器避免竞态条件 ===
      const child = spawn(rgBin, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => (stderr += d));

      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

      const kill = () => {
        try { if (!child.killed) child.kill('SIGKILL'); } catch {}
      };

      const timer = setTimeout(() => {
        timedOut = true;
        truncated = true;
        kill();
        rl.close();
      }, this.timeoutMs);

      for await (const line of rl) {
        if (!line) continue;

        let evt: any;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }

        if (evt?.type !== 'match') continue;

        const fileRaw = toDisplayString(evt?.data?.path);
        if (!fileRaw) continue;

        const file = normalizeFilePath(cwd, fileRaw);
        const entry = fileMap.get(file) ?? { matches: [] };

        const linesText = toDisplayString(evt?.data?.lines) || '';
        const content = linesText.replace(/\r?\n$/g, '');

        const sub = Array.isArray(evt?.data?.submatches) ? evt.data.submatches : [];
        const first = sub[0];
        const matchText = first?.match ? toDisplayString(first.match) : undefined;
        const start = typeof first?.start === 'number' ? first.start : undefined;
        const column = typeof start === 'number' ? start + 1 : null;

        entry.matches.push({
          line: typeof evt?.data?.line_number === 'number' ? evt.data.line_number : null,
          column,
          content: content.trimEnd(),
          matchText,
          start,
          end: typeof first?.end === 'number' ? first.end : undefined,
        });

        fileMap.set(file, entry);

        // 限制结果数量 - check before adding to ensure max 100 files
        if (fileMap.size >= 100) {
          truncated = true;
          kill();
          rl.close();
          break;
        }
      }

      clearTimeout(timer);

      // === 等待进程结束，在 Promise 内注册 error 监听器 ===
      const exitCode: number = await new Promise((resolve, reject) => {
        // 必须在同步代码中注册 error 监听器，避免竞态条件
        child.on('error', reject);
        child.on('close', (code: number | null) => {
          resolve(code ?? 0);
        });
      });

      // === 业务错误：未找到匹配 ===
      if (exitCode === 1 && fileMap.size === 0 && !timedOut) {
        return this.result({
          success: true,
          metadata: { countFiles: 0, countMatches: 0, results: [] },
          output: 'No matches found',
        });
      }

      // === 业务错误：ripgrep 错误 ===
      if (exitCode === 2 && !timedOut) {
        return this.result({
          success: false,
          metadata: {
            error: 'RIPGREP_ERROR',
            exitCode,
            stderr
          } as any,
          output: `RIPGREP_ERROR: ${stderr || 'ripgrep error'}`,
        });
      }

      // === 获取文件信息 ===
      const results: GrepFileResult[] = await Promise.all(
        Array.from(fileMap.entries()).map(async ([file, v]) => {
          let mtimeMs: number | null = null;
          try {
            const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
            const st = await fs.stat(abs);
            mtimeMs = st.mtimeMs;
          } catch {
            // 忽略 stat 失败
          }
          return {
            file,
            mtimeMs,
            mtimeIso: mtimeMs ? new Date(mtimeMs).toISOString() : null,
            matches: v.matches,
          };
        })
      );

      results.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));

      const totalMatches = Array.from(fileMap.values()).reduce((sum, v) => sum + v.matches.length, 0);

      const data = { countFiles: results.length, countMatches: totalMatches, results, truncated, timedOut };
      return this.result({
        success: true,
        metadata: data,
        output: `Found ${totalMatches} matches in ${results.length} files${truncated ? ' (truncated)' : ''}${timedOut ? ' (timed out)' : ''}`,
      });
    } catch (error) {
      // === 所有 spawn/执行错误都返回 ToolResult，不抛出 ===
      const err = error instanceof Error ? error : new Error(String(error));
      const errorMsg = err.message;

      // 处理各种错误类型
      if (errorMsg.includes('ENOENT')) {
        return this.result({
          success: false,
          metadata: {
            error: 'RIPGREP_NOT_FOUND',
            path: rgBin
          } as any,
          output: 'RIPGREP_NOT_FOUND: ripgrep binary not found',
        });
      }

      if (errorMsg.includes('EACCES')) {
        return this.result({
          success: false,
          metadata: {
            error: 'RIPGREP_NO_PERMISSION',
            path: rgBin
          } as any,
          output: 'RIPGREP_NO_PERMISSION: No permission to execute ripgrep',
        });
      }

      if (errorMsg.includes('EPERM')) {
        return this.result({
          success: false,
          metadata: {
            error: 'RIPGREP_OPERATION_NOT_PERMITTED',
            path: rgBin
          } as any,
          output: 'RIPGREP_OPERATION_NOT_PERMITTED: Operation not permitted',
        });
      }

      // 其他未知错误
      return this.result({
        success: false,
        metadata: {
          error: 'GREP_EXECUTION_ERROR',
          errorMsg
        } as any,
        output: `GREP_EXECUTION_ERROR: Failed to execute ripgrep: ${errorMsg}`,
      });
    }
  }
}
