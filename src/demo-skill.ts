/**
 * Skill 功能演示脚本
 *
 * 这个脚本展示了如何使用 skill 模块
 */

import { initializeSkillLoader, getSkillLoader, SkillTool } from './agent-v2/skill';

async function main() {
    console.log('=== Skill 功能演示 ===\n');

    // 1. 初始化技能加载器
    console.log('1. 初始化技能加载器...');
    const loader = await initializeSkillLoader({ workingDir: process.cwd() });

    // 2. 获取所有可用技能的元数据
    console.log('\n2. 获取可用技能列表（轻量级，只加载元数据）:');
    const skills = loader.getAllMetadata();
    console.log(`   找到 ${skills.length} 个技能:`);
    skills.forEach((skill) => {
        console.log(`   - ${skill.name}: ${skill.description}`);
    });

    if (skills.length === 0) {
        console.log('   (没有找到技能，请确保 skills 目录存在且包含 SKILL.md 文件)');
        return;
    }

    // 3. 按需加载完整技能内容（渐进式披露）
    const skillName = skills[0].name;
    console.log(`\n3. 按需加载技能 "${skillName}" 的完整内容:`);
    const skill = await loader.loadSkill(skillName);

    if (skill) {
        console.log(`   名称: ${skill.metadata.name}`);
        console.log(`   描述: ${skill.metadata.description}`);
        console.log(`   路径: ${skill.metadata.path}`);
        console.log(`   内容长度: ${skill.content.length} 字符`);
        console.log(`   文件引用: ${skill.fileRefs.length > 0 ? skill.fileRefs.join(', ') : '无'}`);
        console.log(`   Shell命令: ${skill.shellCommands.length > 0 ? skill.shellCommands.join(', ') : '无'}`);
    }

    // 4. 使用 SkillTool（模拟 agent 使用）
    console.log('\n4. 使用 SkillTool（模拟 agent 调用）:');
    const tool = new SkillTool();
    console.log(`   工具名称: ${tool.name}`);
    console.log(`   工具描述（前200字符）: ${tool.description.slice(0, 200)}...`);

    const result = await tool.execute({ name: skillName });
    if (result.success) {
        console.log(`   执行成功!`);
        console.log(`   输出（前300字符）: ${result.output?.slice(0, 300)}...`);
    } else {
        console.log(`   执行失败: ${result.output}`);
    }

    console.log('\n=== 演示完成 ===');
}

main().catch(console.error);
