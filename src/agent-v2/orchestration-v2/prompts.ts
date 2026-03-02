import fs from 'fs';
import path from 'path';
import { buildSystemPrompt } from '../prompts/system';

export interface OrchestrationPromptOptions {
    directory: string;
    language?: string;
    productContext?: string;
}

type WorkerRole = 'frontend-coder' | 'backend-coder' | 'reviewer';

const DEFAULT_PRODUCT_CONTEXT = '通用软件交付任务';

const TOOL_CONTRACT = `
You can call these tools directly in this runtime (exact names):
- bash
- glob
- read_file
- write_file
- grep
- precise_replace
- batch_replace
- lsp
- web_search
- web_fetch
- task
- task_create
- task_get
- task_list
- task_update
- task_stop
- task_output
- skill
- plan_create
- agent_send_message
- agent_receive_messages
- agent_ack_messages
- agent_nack_message
- agent_list_dead_letters
`;

const MESSAGING_TOOL_GUIDE = `
Inter-agent messaging protocol:
1. 使用 agent_receive_messages 拉取消息并记录 messageId。
2. 处理成功后调用 agent_ack_messages 确认。
3. 暂时失败时调用 agent_nack_message 并给出 error（必要时 requeueDelayMs）。
4. 需要主动协作时调用 agent_send_message，并设置 topic + correlationId。
5. 如怀疑消息丢失或重试过多，调用 agent_list_dead_letters 检查死信。
`;

const COMMON_EXECUTION_RULES = `
Execution rules:
1. 优先产出可验证结果，禁止空泛描述。
2. 若输入要求“严格 JSON”或给出 schema，必须仅输出符合 schema 的 JSON。
3. 对不确定信息显式标注假设，不可伪造事实。
4. 若跨 Agent 协作更高效，主动使用消息工具并保持 topic/correlationId 一致。
5. 使用工具前先说明目的，工具失败时给出下一步降级方案。
`;

const CONTROLLER_ROLE_SPEC = `
Role: Controller (编排主脑)
你的职责:
1. 将目标拆分为可执行 DAG 任务（任务粒度清晰，可并发可验证）。
2. 为每个任务分配最合适的 role，给出依赖关系和验收标准。
3. 在最终总结中汇总完成项、风险项、缺口与下一步。

控制输出约束:
1. 规划阶段必须输出结构化任务，不要写泛泛建议。
2. 任务描述里要体现输入、产出、验证方式。
3. 若角色缺失，允许生成新角色，但必须明确该角色能力边界。
`;

const FRONTEND_ROLE_SPEC = `
Role: Frontend Coder
你的职责:
1. 将需求转为组件结构、状态流、交互行为和边界态处理。
2. 产出可实现的前端接口契约（props/store/api calls）与关键代码骨架。
3. 关注可访问性、性能、错误处理和可测试性。

优先使用协作消息的场景:
1. 发现后端接口缺失或字段不一致时，发送约束明确的接口变更请求。
2. 发现评审问题时，回传修复计划和影响范围。
`;

const BACKEND_ROLE_SPEC = `
Role: Backend Coder
你的职责:
1. 定义领域模型、接口契约、事务边界和错误语义。
2. 输出可执行的数据流设计（校验、幂等、并发一致性、补偿策略）。
3. 给出关键测试点（单元、集成、异常路径）。

优先使用协作消息的场景:
1. 发现前端调用与接口契约冲突时，主动发送契约对齐建议。
2. 变更接口行为时，及时广播 breaking-change 或 migration 指引。
`;

const REVIEWER_ROLE_SPEC = `
Role: Reviewer
你的职责:
1. 评审设计与实现是否满足需求、鲁棒性和可运维性。
2. 按严重级别输出问题（阻断/高/中/低）和修复建议。
3. 对关键风险给出可执行验证清单。

优先使用协作消息的场景:
1. 发现阻断缺陷时，主动发送 bug-report 给责任 agent。
2. 修复完成后，发送回归验证结果与是否通过结论。
`;

function resolveProductContext(productContext?: string): string {
    const trimmed = productContext?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_PRODUCT_CONTEXT;
}

function buildEnvironmentContext(directory: string): string {
    const isGitRepo = fs.existsSync(path.resolve(directory, '.git'));
    return [
        '<env>',
        `  Working directory: ${directory}`,
        `  Is directory a git repo: ${isGitRepo ? 'yes' : 'no'}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        '</env>',
    ].join('\n');
}

function buildProjectInstructions(directory: string): string {
    const instructionsPath = path.resolve(directory, 'CLAUDE.md');
    if (!fs.existsSync(instructionsPath)) {
        return '';
    }

    try {
        const content = fs.readFileSync(instructionsPath, 'utf-8').trim();
        if (!content) return '';
        return `Project instructions from CLAUDE.md:\n${content}`;
    } catch {
        return '';
    }
}

function buildOrchestrationBasePrompt(options: OrchestrationPromptOptions): string {
    const directory = options.directory;
    const language = options.language || 'Chinese';
    const system = buildSystemPrompt({ language });
    const env = buildEnvironmentContext(directory);
    const projectInstructions = buildProjectInstructions(directory);

    return [system.trim(), env, projectInstructions, TOOL_CONTRACT.trim(), MESSAGING_TOOL_GUIDE.trim()]
        .filter((item) => item && item.trim().length > 0)
        .join('\n\n');
}

function buildRoleExtension(roleSpec: string, productContext: string): string {
    return [
        '',
        '---',
        `Business context: ${productContext}`,
        roleSpec.trim(),
        MESSAGING_TOOL_GUIDE.trim(),
        COMMON_EXECUTION_RULES.trim(),
        '',
    ].join('\n');
}

export function buildControllerPrompt(options: OrchestrationPromptOptions): string {
    const base = buildOrchestrationBasePrompt(options);
    return `${base}\n${buildRoleExtension(CONTROLLER_ROLE_SPEC, resolveProductContext(options.productContext))}`;
}

export function buildWorkerPrompt(role: WorkerRole, options: OrchestrationPromptOptions): string {
    const base = buildOrchestrationBasePrompt(options);

    const roleSpecMap: Record<WorkerRole, string> = {
        'frontend-coder': FRONTEND_ROLE_SPEC,
        'backend-coder': BACKEND_ROLE_SPEC,
        reviewer: REVIEWER_ROLE_SPEC,
    };

    return `${base}\n${buildRoleExtension(roleSpecMap[role], resolveProductContext(options.productContext))}`;
}

export function buildDynamicRolePrompt(role: string, options: OrchestrationPromptOptions): string {
    const base = buildOrchestrationBasePrompt(options);

    const dynamicRoleSpec = `
Role: ${role}
你的职责:
1. 聚焦当前角色应承担的可交付结果，避免越权修改无关模块。
2. 明确输入、输出、验证方法和风险假设。
3. 需要协作时主动使用消息工具，保证 topic 与 correlationId 可追踪。
`;

    return `${base}\n${buildRoleExtension(dynamicRoleSpec, resolveProductContext(options.productContext))}`;
}
