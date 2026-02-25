/**
 * ============================================================================
 * Skill Parser
 * ============================================================================
 *
 * 技能文件解析器
 *
 * 功能：
 * - 解析 YAML frontmatter
 * - 提取文件引用（@file.ts）
 * - 提取 shell 命令（!`command`）
 * - 格式化技能内容
 */

import type { SkillFrontmatter, ParsedSkillFile } from './types';

/**
 * 文件引用正则表达式
 * 匹配 @file.ts 或 @path/to/file.ts 格式
 * 支持相对路径：@./file.ts, @../parent/file.ts
 * 排除：邮箱、代码块内、被反引号包围的
 */
const FILE_REF_REGEX = /(?<![`\w])@(\.{0,2}[\/\\]?[^\s`,.*!?()]+(?:\.[^\s`,.*!?()]+)+)/g;

/**
 * Shell 命令正则表达式
 * 匹配 !`command` 格式
 */
const SHELL_COMMAND_REGEX = /!`([^`]+)`/g;

/**
 * Frontmatter 正则表达式
 * 匹配 ---\n...\n--- 格式
 */
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * 解析 YAML frontmatter
 *
 * 简单的 YAML 解析器，只支持 key: value 格式
 *
 * @param content 文件内容
 * @returns 解析后的 frontmatter，如果不存在则返回 null
 */
export function parseFrontmatter(content: string): SkillFrontmatter | null {
    const match = content.match(FRONTMATTER_REGEX);
    if (!match) {
        return null;
    }

    const yamlContent = match[1];
    const result: Partial<SkillFrontmatter> = {};

    for (const line of yamlContent.split('\n')) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();

        // 移除引号
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        switch (key) {
            case 'name':
                result.name = value;
                break;
            case 'description':
                result.description = value;
                break;
            case 'license':
                result.license = value;
                break;
            case 'version':
                result.version = value;
                break;
            case 'author':
                result.author = value;
                break;
        }
    }

    if (!result.name || !result.description) {
        return null;
    }

    return result as SkillFrontmatter;
}

/**
 * 移除 frontmatter 获取纯 Markdown 内容
 *
 * @param content 原始文件内容
 * @returns 移除 frontmatter 后的内容
 */
export function stripFrontmatter(content: string): string {
    const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
    if (match) {
        return content.slice(match[0].length);
    }
    return content;
}

/**
 * 提取文件引用
 *
 * 从 Markdown 内容中提取所有 @file.ts 格式的文件引用
 *
 * @param content Markdown 内容
 * @returns 去重后的文件引用数组
 *
 * @example
 * ```ts
 * const refs = extractFileRefs('See @src/app.ts and @lib/utils.ts');
 * // => ['src/app.ts', 'lib/utils.ts']
 * ```
 */
export function extractFileRefs(content: string): string[] {
    const matches = Array.from(content.matchAll(FILE_REF_REGEX));
    return [...new Set(matches.map((m) => m[1]))];
}

/**
 * 提取 shell 命令
 *
 * 从 Markdown 内容中提取所有 !`command` 格式的 shell 命令
 *
 * @param content Markdown 内容
 * @returns 去重后的命令数组
 *
 * @example
 * ```ts
 * const cmds = extractShellCommands('Run !`npm install` first');
 * // => ['npm install']
 * ```
 */
export function extractShellCommands(content: string): string[] {
    const matches = Array.from(content.matchAll(SHELL_COMMAND_REGEX));
    return [...new Set(matches.map((m) => m[1]))];
}

/**
 * 解析完整的技能文件
 *
 * @param content 原始文件内容
 * @param basePath 技能目录路径
 * @returns 解析结果
 */
export function parseSkillFile(content: string, basePath: string): ParsedSkillFile {
    const frontmatter = parseFrontmatter(content);
    const markdownContent = stripFrontmatter(content);

    return {
        metadata: {
            name: frontmatter?.name ?? '',
            description: frontmatter?.description ?? '',
            path: basePath,
        },
        content: markdownContent.trim(),
        fileRefs: extractFileRefs(markdownContent),
        shellCommands: extractShellCommands(markdownContent),
    };
}

/**
 * 格式化技能内容用于 LLM 上下文
 *
 * @param skill 技能信息
 * @returns 格式化后的字符串
 */
export function formatSkillForContext(skill: {
    metadata: { name: string; description: string; path: string };
    content: string;
    fileRefs?: string[];
    shellCommands?: string[];
}): string {
    const lines: string[] = [
        `## Skill: ${skill.metadata.name}`,
        '',
        `**Description**: ${skill.metadata.description}`,
        `**Base directory**: ${skill.metadata.path}`,
        '',
    ];

    // 添加文件引用
    if (skill.fileRefs && skill.fileRefs.length > 0) {
        lines.push('**Referenced files**:');
        for (const ref of skill.fileRefs) {
            lines.push(`  - ${ref}`);
        }
        lines.push('');
    }

    // 添加 shell 命令
    if (skill.shellCommands && skill.shellCommands.length > 0) {
        lines.push('**Shell commands**:');
        for (const cmd of skill.shellCommands) {
            lines.push(`  - !\`${cmd}\``);
        }
        lines.push('');
    }

    // 添加主要内容
    lines.push('---', '', skill.content);

    return lines.join('\n');
}

/**
 * 验证技能名称格式
 *
 * 规则：
 * - 小写字母、数字、连字符
 * - 不能以连字符开头或结尾
 * - 最大64字符
 *
 * @param name 技能名称
 * @returns 是否有效
 */
export function isValidSkillName(name: string): boolean {
    if (name.length > 64) return false;
    if (name.length === 0) return false;
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

/**
 * 验证技能描述长度
 *
 * @param description 描述
 * @returns 是否有效（最大1024字符）
 */
export function isValidDescription(description: string): boolean {
    return description.length > 0 && description.length <= 1024;
}
