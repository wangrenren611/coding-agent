/**
 * ============================================================================
 * Skill Loader
 * ============================================================================
 *
 * 技能加载器 - 实现渐进式披露
 *
 * 设计原则：
 * 1. 启动时扫描并加载所有技能的元数据（轻量级）
 * 2. 完整内容按需加载，避免占用 LLM 上下文
 * 3. 加载后的内容缓存，避免重复 I/O
 * 4. 简洁的 API，单一职责
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import fg from 'fast-glob';
import type { Skill, SkillMetadata, SkillLoaderOptions, ParsedSkillFile, SkillFrontmatter } from './types';

/**
 * 默认技能目录名
 */
const DEFAULT_SKILLS_DIR_NAME = 'skills';

/**
 * 技能文件名
 */
const SKILL_FILE_NAME = 'SKILL.md';

/**
 * 技能加载器
 *
 * @example
 * ```ts
 * const loader = new SkillLoader({ workingDir: process.cwd() });
 *
 * // 1. 初始化：只加载元数据（轻量级）
 * await loader.initialize();
 *
 * // 2. 获取所有可用技能的元数据
 * const skills = loader.getAllMetadata();
 *
 * // 3. 按需加载完整技能内容
 * const skill = await loader.loadSkill('typescript-testing');
 * ```
 */
export class SkillLoader {
    /** 技能目录路径 */
    private readonly skillsDir: string;

    /** 已加载的元数据映射 */
    private metadataMap: Map<string, SkillMetadata> = new Map();

    /** 已完整加载的技能缓存 */
    private skillCache: Map<string, Skill> = new Map();

    /** 是否已初始化 */
    private initialized = false;

    constructor(options: SkillLoaderOptions = {}) {
        const workingDir = options.workingDir ?? process.cwd();
        this.skillsDir = options.skillsDir ?? path.join(workingDir, DEFAULT_SKILLS_DIR_NAME);
    }

    /**
     * 初始化加载器
     *
     * 扫描技能目录，加载所有技能的元数据
     * 此操作是轻量级的，不会加载技能完整内容
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            const skillFiles = await this.discoverSkillFiles();

            for (const skillPath of skillFiles) {
                await this.loadMetadata(skillPath);
            }

            this.initialized = true;
        } catch (error) {
            // 技能目录不存在是可接受的（静默处理）
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                // 其他错误也静默处理，避免影响 agent 启动
            }
        }
    }

    /**
     * 获取所有技能元数据
     *
     * 返回已加载的所有技能的名称和描述
     */
    getAllMetadata(): SkillMetadata[] {
        return Array.from(this.metadataMap.values());
    }

    /**
     * 获取技能数量
     */
    get size(): number {
        return this.metadataMap.size;
    }

    /**
     * 检查技能是否存在
     */
    hasSkill(name: string): boolean {
        return this.metadataMap.has(name);
    }

    /**
     * 加载完整技能内容（按需加载）
     *
     * 如果技能已缓存，直接返回缓存内容
     * 否则从文件系统加载并缓存
     *
     * @param name 技能名称
     * @returns 完整技能信息，如果不存在返回 null
     */
    async loadSkill(name: string): Promise<Skill | null> {
        // 检查缓存
        const cached = this.skillCache.get(name);
        if (cached) {
            return cached;
        }

        // 获取元数据
        const metadata = this.metadataMap.get(name);
        if (!metadata) {
            return null;
        }

        // 加载完整内容
        try {
            const skillFilePath = path.join(metadata.path, SKILL_FILE_NAME);
            const rawContent = await fs.readFile(skillFilePath, 'utf-8');
            const parsed = this.parseSkillFile(rawContent, metadata.path);

            const skill: Skill = {
                metadata,
                content: parsed.content,
                fileRefs: parsed.fileRefs,
                shellCommands: parsed.shellCommands,
                loadedAt: Date.now(),
            };

            // 缓存
            this.skillCache.set(name, skill);
            return skill;
        } catch (error) {
            // 加载失败，返回 null
            return null;
        }
    }

    /**
     * 清除技能缓存
     */
    clearCache(name?: string): void {
        if (name) {
            this.skillCache.delete(name);
        } else {
            this.skillCache.clear();
        }
    }

    /**
     * 重新加载指定技能
     */
    async reloadSkill(name: string): Promise<Skill | null> {
        this.clearCache(name);
        return this.loadSkill(name);
    }

    // ==================== 私有方法 ====================

    /**
     * 发现所有技能文件
     */
    private async discoverSkillFiles(): Promise<string[]> {
        return fg(`**/${SKILL_FILE_NAME}`, {
            cwd: this.skillsDir,
            absolute: true,
            onlyFiles: true,
        });
    }

    /**
     * 加载单个技能的元数据
     */
    private async loadMetadata(skillPath: string): Promise<void> {
        try {
            const rawContent = await fs.readFile(skillPath, 'utf-8');
            const skillDir = path.dirname(skillPath);
            const frontmatter = this.parseFrontmatter(rawContent);

            if (!frontmatter || !frontmatter.name || !frontmatter.description) {
                return;
            }

            // 验证技能名称格式
            if (!this.isValidSkillName(frontmatter.name)) {
                return;
            }

            // 验证描述长度
            if (frontmatter.description.length > 1024) {
                return;
            }

            const metadata: SkillMetadata = {
                name: frontmatter.name,
                description: frontmatter.description,
                path: skillDir,
            };

            this.metadataMap.set(metadata.name, metadata);
        } catch (error) {
            // 静默处理加载错误
        }
    }

    /**
     * 解析 YAML frontmatter
     */
    private parseFrontmatter(content: string): SkillFrontmatter | null {
        // 匹配 YAML frontmatter: ---\n...\n---
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) {
            return null;
        }

        const yamlContent = match[1];
        const result: SkillFrontmatter = {} as SkillFrontmatter;

        // 简单的 YAML 解析（只支持 key: value 格式）
        for (const line of yamlContent.split('\n')) {
            const colonIndex = line.indexOf(':');
            if (colonIndex === -1) continue;

            const key = line.slice(0, colonIndex).trim();
            let value = line.slice(colonIndex + 1).trim();

            // 移除引号
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            if (key === 'name') result.name = value;
            if (key === 'description') result.description = value;
            if (key === 'license') result.license = value;
            if (key === 'version') result.version = value;
            if (key === 'author') result.author = value;
        }

        return result.name && result.description ? result : null;
    }

    /**
     * 解析完整技能文件
     */
    private parseSkillFile(content: string, skillDir: string): ParsedSkillFile {
        const frontmatter = this.parseFrontmatter(content);

        // 移除 frontmatter 获取纯内容
        let markdownContent = content;
        const frontmatterMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
        if (frontmatterMatch) {
            markdownContent = content.slice(frontmatterMatch[0].length);
        }

        return {
            metadata: {
                name: frontmatter?.name ?? '',
                description: frontmatter?.description ?? '',
                path: skillDir,
            },
            content: markdownContent.trim(),
            fileRefs: this.extractFileRefs(markdownContent),
            shellCommands: this.extractShellCommands(markdownContent),
        };
    }

    /**
     * 提取文件引用 (@file.ts 格式)
     */
    private extractFileRefs(content: string): string[] {
        // 匹配 @file.ts 或 @path/to/file.ts，排除邮箱和代码块内的
        const regex = /(?<![`\w])@(\.?[^\s`,.*!?()]+(?:\.[^\s`,.*!?()]+)+)/g;
        const matches = Array.from(content.matchAll(regex));
        return [...new Set(matches.map((m) => m[1]))];
    }

    /**
     * 提取 shell 命令 (!`command` 格式)
     */
    private extractShellCommands(content: string): string[] {
        const regex = /!`([^`]+)`/g;
        const matches = Array.from(content.matchAll(regex));
        return [...new Set(matches.map((m) => m[1]))];
    }

    /**
     * 验证技能名称格式
     */
    private isValidSkillName(name: string): boolean {
        if (name.length > 64) return false;
        return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
    }
}

// ==================== 全局实例 ====================

let globalLoader: SkillLoader | null = null;

/**
 * 获取全局技能加载器实例
 */
export function getSkillLoader(options?: SkillLoaderOptions): SkillLoader {
    if (!globalLoader) {
        globalLoader = new SkillLoader(options);
    }
    return globalLoader;
}

/**
 * 初始化全局技能加载器
 */
export async function initializeSkillLoader(options?: SkillLoaderOptions): Promise<SkillLoader> {
    const loader = getSkillLoader(options);
    await loader.initialize();
    return loader;
}
