/**
 * Skill 执行流程演示
 *
 * 这个脚本详细展示 skill 系统的完整执行流程
 */

import { SkillLoader, getSkillLoader, initializeSkillLoader } from './agent-v2/skill';
import { SkillTool } from './agent-v2/skill/skill-tool';
import { ToolRegistry } from './agent-v2/tool/registry';

async function demonstrateSkillFlow() {
    console.log('='.repeat(70));
    console.log('Skill 系统完整执行流程演示');
    console.log('='.repeat(70));

    // =========================================================================
    // 阶段 1: Agent 启动 - 工具注册
    // =========================================================================
    console.log('\n【阶段 1: Agent 启动 - 工具注册】');
    console.log('-'.repeat(50));

    console.log('\n1.1 创建 SkillTool 实例（不加载任何技能）');
    const skillTool = new SkillTool();

    console.log('    工具名称:', skillTool.name);
    console.log('    工具描述（部分）:');
    console.log('   ', skillTool.description.split('\n').slice(0, 3).join('\n    '));

    console.log('\n1.2 注册到 ToolRegistry');
    const registry = new ToolRegistry({ workingDirectory: process.cwd() });
    registry.register([skillTool]);

    console.log('    已注册工具数量:', registry.toLLMTools().length);
    console.log('    工具列表:', registry.toLLMTools().map(t => t.function.name).join(', '));

    // =========================================================================
    // 阶段 2: LLM 上下文准备
    // =========================================================================
    console.log('\n【阶段 2: LLM 上下文准备】');
    console.log('-'.repeat(50));

    console.log('\n2.1 获取工具描述（发送给 LLM 的内容）');
    const toolDefinitions = registry.toLLMTools();
    const skillToolDef = toolDefinitions.find(t => t.function.name === 'skill');

    console.log('    skill 工具定义:');
    console.log('    - name:', skillToolDef?.function.name);
    console.log('    - description (前150字符):', skillToolDef?.function.description?.slice(0, 150) + '...');

    // 此时 SkillLoader 还未初始化
    console.log('\n2.2 此时 SkillLoader 状态');
    console.log('    注意: SkillLoader 尚未初始化，未扫描 skills 目录');

    // =========================================================================
    // 阶段 3: LLM 决定调用 skill 工具
    // =========================================================================
    console.log('\n【阶段 3: LLM 决定调用 skill 工具】');
    console.log('-'.repeat(50));

    console.log('\n3.1 模拟 LLM 收到的用户请求:');
    console.log('    用户: "我需要查看可用的技能指南"');

    console.log('\n3.2 LLM 决定调用 skill 工具');
    console.log('    工具调用: skill({ name: "example-skill" })');

    // =========================================================================
    // 阶段 4: SkillTool.execute() 执行
    // =========================================================================
    console.log('\n【阶段 4: SkillTool.execute() 执行】');
    console.log('-'.repeat(50));

    console.log('\n4.1 步骤一: initializeSkillLoader() - 初始化加载器');
    console.log('    ├─ 扫描 skills 目录');
    console.log('    ├─ 查找所有 **/SKILL.md 文件');
    console.log('    └─ 只解析 frontmatter，提取元数据');

    const loader = await initializeSkillLoader({ workingDir: process.cwd() });
    console.log('\n    初始化完成! 已发现技能:');
    const metadata = loader.getAllMetadata();
    metadata.forEach(m => {
        console.log(`    - ${m.name}`);
        console.log(`      描述: ${m.description}`);
        console.log(`      路径: ${m.path}`);
    });

    console.log('\n4.2 步骤二: hasSkill() - 检查技能是否存在');
    const skillName = 'example-skill';
    const exists = loader.hasSkill(skillName);
    console.log(`    hasSkill("${skillName}"): ${exists}`);

    console.log('\n4.3 步骤三: loadSkill() - 按需加载完整内容');
    console.log('    ├─ 读取 SKILL.md 文件内容');
    console.log('    ├─ 解析 YAML frontmatter');
    console.log('    ├─ 移除 frontmatter 获取 Markdown 内容');
    console.log('    ├─ 提取文件引用 (@file.ts)');
    console.log('    ├─ 提取 shell 命令 (!`command`)');
    console.log('    └─ 缓存结果');

    const skill = await loader.loadSkill(skillName);

    if (skill) {
        console.log('\n    加载完成! 技能详情:');
        console.log(`    - 元数据: ${skill.metadata.name}`);
        console.log(`    - 内容长度: ${skill.content.length} 字符`);
        console.log(`    - 文件引用: ${skill.fileRefs.length > 0 ? skill.fileRefs.join(', ') : '无'}`);
        console.log(`    - Shell命令: ${skill.shellCommands.length > 0 ? skill.shellCommands.join(', ') : '无'}`);
        console.log(`    - 加载时间: ${new Date(skill.loadedAt).toISOString()}`);
    }

    // =========================================================================
    // 阶段 5: 返回结果给 LLM
    // =========================================================================
    console.log('\n【阶段 5: 返回结果给 LLM】');
    console.log('-'.repeat(50));

    console.log('\n5.1 执行 SkillTool.execute()');
    const result = await skillTool.execute({ name: skillName });

    console.log('\n5.2 返回结果:');
    console.log(`    success: ${result.success}`);
    console.log(`    output (前500字符):\n`);
    console.log('   ', result.output?.slice(0, 500).replace(/\n/g, '\n    ') + '...');

    // =========================================================================
    // 阶段 6: 缓存验证（第二次调用）
    // =========================================================================
    console.log('\n【阶段 6: 缓存验证 - 第二次调用同一技能】');
    console.log('-'.repeat(50));

    console.log('\n6.1 再次加载同一技能');
    const startTime = Date.now();
    const skill2 = await loader.loadSkill(skillName);
    const loadTime = Date.now() - startTime;

    console.log(`    加载耗时: ${loadTime}ms（应该是 0ms，因为从缓存读取）`);
    console.log(`    是否同一对象: ${skill === skill2}（缓存命中）`);

    // =========================================================================
    // 总结
    // =========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('【总结: 渐进式披露的优势】');
    console.log('='.repeat(70));
    console.log(`
1. 启动轻量
   - Agent 启动时不扫描 skills 目录
   - 工具描述是静态生成的，不需要 I/O

2. 按需加载
   - 只有 LLM 调用 skill 工具时才初始化
   - 只加载被请求的技能完整内容

3. 智能缓存
   - 元数据缓存：初始化后保存在 SkillLoader 中
   - 内容缓存：技能内容加载后保存在 skillCache 中

4. 上下文优化
   - LLM 只看到技能名称和描述（在工具描述中）
   - 完整内容只在需要时才加载到上下文
`);
}

// 运行演示
demonstrateSkillFlow().catch(console.error);
