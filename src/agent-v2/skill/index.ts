/**
 * ============================================================================
 * Skill Module
 * ============================================================================
 *
 * 技能系统模块 - 提供领域知识扩展和专门工作流程
 *
 * 设计原则：
 * 1. 渐进式披露 - 启动时只加载元数据，按需加载完整内容
 * 2. 低侵入性 - 不修改 agent 核心逻辑，通过工具集成
 * 3. 简洁 API - 易于使用和测试
 *
 * @example
 * ```ts
 * import { initializeSkillLoader, getSkillLoader, SkillTool } from './skill';
 *
 * // 1. 初始化技能加载器（启动时调用一次）
 * await initializeSkillLoader({ workingDir: process.cwd() });
 *
 * // 2. 获取技能列表（轻量级，只有元数据）
 * const loader = getSkillLoader();
 * const skills = loader.getAllMetadata();
 *
 * // 3. 按需加载完整技能内容
 * const skill = await loader.loadSkill('typescript-testing');
 *
 * // 4. 在 agent 中使用（通过 SkillTool）
 * const skillTool = new SkillTool();
 * const result = await skillTool.execute({ name: 'typescript-testing' });
 * ```
 *
 * @module skill
 */

// 类型导出
export type {
    Skill,
    SkillMetadata,
    SkillLoaderOptions,
    SkillFrontmatter,
    ParsedSkillFile,
    SkillToolResult,
} from './types';

// 加载器
export { SkillLoader, getSkillLoader, initializeSkillLoader } from './loader';

// 解析器
export {
    parseFrontmatter,
    stripFrontmatter,
    extractFileRefs,
    extractShellCommands,
    parseSkillFile,
    formatSkillForContext,
    isValidSkillName,
    isValidDescription,
} from './parser';

// 工具
export { SkillTool, createSkillTool, defaultSkillTool, simpleSkillTool } from './skill-tool';
