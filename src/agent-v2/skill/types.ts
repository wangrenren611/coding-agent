/**
 * ============================================================================
 * Skill Types
 * ============================================================================
 *
 * 技能系统类型定义 - 支持渐进式披露
 *
 * 设计原则：
 * 1. 启动时只加载元数据（轻量级）
 * 2. 按需加载完整技能内容（按需披露）
 * 3. 支持内容缓存，避免重复 I/O
 */

/**
 * 技能元数据（轻量级，启动时加载）
 *
 * 用于在工具描述中列出可用技能
 */
export interface SkillMetadata {
    /** 技能标识符（小写字母/数字/连字符，最大64字符） */
    readonly name: string;
    /** 简短描述（最大1024字符） */
    readonly description: string;
    /** 技能目录绝对路径 */
    readonly path: string;
}

/**
 * 完整技能信息（按需加载）
 */
export interface Skill {
    /** 技能元数据 */
    readonly metadata: SkillMetadata;
    /** SKILL.md 内容（不含 frontmatter） */
    readonly content: string;
    /** 提取的文件引用 */
    readonly fileRefs: string[];
    /** 提取的 shell 命令 */
    readonly shellCommands: string[];
    /** 加载时间戳 */
    readonly loadedAt: number;
}

/**
 * 技能加载器配置
 */
export interface SkillLoaderOptions {
    /** 技能目录路径（默认：工作目录下的 skills 文件夹） */
    skillsDir?: string;
    /** 工作目录（默认：process.cwd()） */
    workingDir?: string;
}

/**
 * 技能解析结果
 */
export interface ParsedSkillFile {
    /** 元数据 */
    metadata: SkillMetadata;
    /** Markdown 内容 */
    content: string;
    /** 文件引用 */
    fileRefs: string[];
    /** Shell 命令 */
    shellCommands: string[];
}

/**
 * 技能工具执行结果
 */
export interface SkillToolResult {
    /** 技能名称 */
    name: string;
    /** 技能描述 */
    description: string;
    /** 基础目录 */
    baseDir: string;
    /** 技能内容 */
    content: string;
    /** 关联文件（如果有） */
    fileRefs?: string[];
    /** Shell 命令（如果有） */
    shellCommands?: string[];
}

/**
 * YAML Frontmatter 结构
 */
export interface SkillFrontmatter {
    name: string;
    description: string;
    license?: string;
    version?: string;
    author?: string;
}
