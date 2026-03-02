import { buildSystemPrompt } from './system';

export interface OperatorPromptOptions {
    /** 工作目录 */
    directory: string;
    /** 响应语言 */
    language?: string;
    /** 是否处于计划模式 */
    planMode?: boolean;
    /** AGENTS.md 内容 */
    agentsMd?: string;
    /** 工作目录列表 */
    directoryListing?: string;
    /** 额外目录信息 */
    additionalDirs?: string;
    /** 当前日期时间 */
    currentDateTime?: string;
    /** 是否为子代理 */
    isSubagent?: boolean;
    /** 子代理额外角色说明 */
    subagentRoleAdditional?: string;
}

/**
 * 构建完整的 Operator 系统提示词
 */
export const operatorPrompt = (options: OperatorPromptOptions): string => {
    // 调用新的系统提示词构建函数
    return buildSystemPrompt(options);
};
