/**
 * ============================================================================
 * Skill Tool
 * ============================================================================
 *
 * 技能工具 - 支持渐进式披露
 *
 * 设计：
 * 1. 工具描述动态生成，包含所有可用技能的列表
 * 2. LLM 只看到技能名称和描述，不会自动加载完整内容
 * 3. 当 LLM 调用此工具时，才按需加载技能的完整内容
 *
 * 这样实现渐进式披露：
 * - 第一层：工具描述中列出所有技能（名称+描述）
 * - 第二层：LLM 感兴趣时调用工具，获取完整内容
 */

import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../tool/base';
import { getSkillLoader, initializeSkillLoader } from './loader';
import { formatSkillForContext } from './parser';
import type { SkillToolResult } from './types';

/**
 * Skill 工具参数 Schema
 */
const skillSchema = z.object({
    name: z.string().describe('The skill identifier from the available skills list'),
});

/**
 * Skill 工具
 *
 * 提供技能加载功能，实现渐进式披露
 */
export class SkillTool extends BaseTool<typeof skillSchema> {
    name = 'skill';
    schema = skillSchema;

    /** 是否在描述中包含技能列表 */
    private includeSkillList: boolean;

    /** 缓存的描述文本 */
    private cachedDescription: string | null = null;

    /**
     * @param includeSkillList 是否在工具描述中包含可用技能列表
     */
    constructor(includeSkillList: boolean = true) {
        super();
        this.includeSkillList = includeSkillList;
    }

    /**
     * 动态生成工具描述
     *
     * 包含所有可用技能的列表，帮助 LLM 了解可用的技能
     */
    get description(): string {
        if (this.cachedDescription) {
            return this.cachedDescription;
        }

        this.cachedDescription = this.generateDescription();
        return this.cachedDescription;
    }

    /**
     * 重新生成描述（当技能列表变化时调用）
     */
    refreshDescription(): void {
        this.cachedDescription = null;
    }

    /**
     * 生成工具描述
     */
    private generateDescription(): string {
        const baseDescription = [
            'Load a skill to get detailed instructions for a specific task.',
            'Skills provide specialized knowledge and step-by-step guidance.',
            'Use this tool when you need help with a task that matches an available skill.',
            '',
        ].join('\n');

        if (!this.includeSkillList) {
            return baseDescription;
        }

        const loader = getSkillLoader();
        const skills = loader.getAllMetadata();

        if (skills.length === 0) {
            return baseDescription + '\nNo skills are currently available.';
        }

        const skillsList = skills
            .map((skill) => {
                return `- **${skill.name}**: ${skill.description}`;
            })
            .join('\n');

        return [
            baseDescription,
            '**Available skills**:',
            '',
            skillsList,
            '',
            'Call this tool with the skill name to load the full skill content.',
        ].join('\n');
    }

    /**
     * 执行工具
     */
    async execute(args: z.infer<typeof skillSchema>, _context?: ToolContext): Promise<ToolResult<SkillToolResult>> {
        const { name } = args;

        // 确保加载器已初始化（渐进式披露：第一次使用时初始化）
        await initializeSkillLoader();

        const loader = getSkillLoader();

        // 检查技能是否存在
        if (!loader.hasSkill(name)) {
            const availableSkills = loader.getAllMetadata().map((s) => s.name);
            const suggestion =
                availableSkills.length > 0
                    ? `Available skills: ${availableSkills.join(', ')}`
                    : 'No skills are currently available.';

            return this.result({
                success: false,
                metadata: {
                    name,
                    description: '',
                    baseDir: '',
                    content: '',
                    error: 'SKILL_NOT_FOUND',
                    suggestion,
                } as SkillToolResult,
                output: `Skill "${name}" not found. ${suggestion}`,
            });
        }

        // 按需加载完整技能内容
        const skill = await loader.loadSkill(name);

        if (!skill) {
            return this.result({
                success: false,
                metadata: {
                    name,
                    description: '',
                    baseDir: '',
                    content: '',
                    error: 'SKILL_LOAD_FAILED',
                } as SkillToolResult,
                output: `Failed to load skill "${name}". Please try again.`,
            });
        }

        // 格式化输出
        const formattedContent = formatSkillForContext(skill);

        return this.result({
            success: true,
            metadata: {
                name: skill.metadata.name,
                description: skill.metadata.description,
                baseDir: skill.metadata.path,
                content: skill.content,
                fileRefs: skill.fileRefs,
                shellCommands: skill.shellCommands,
            },
            output: formattedContent,
        });
    }
}

/**
 * 创建 Skill 工具实例
 */
export function createSkillTool(options: { includeSkillList?: boolean } = {}): SkillTool {
    return new SkillTool(options.includeSkillList ?? true);
}

/**
 * 默认 Skill 工具实例
 */
export const defaultSkillTool = createSkillTool();

/**
 * 简单 Skill 工具实例（不包含技能列表）
 */
export const simpleSkillTool = createSkillTool({ includeSkillList: false });
