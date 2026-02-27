import path from 'path';
import fs from 'fs';
import { buildSystemPrompt } from './system';
import { buildPlanModePrompt } from './plan';

export type OperatorPromptOptions = {
    /** 工作目录 */
    directory: string;
    /** 响应语言 */
    language?: string;
    /** 是否处于 Plan Mode */
    planMode?: boolean;
};

/**
 * 构建完整的 Operator 系统提示词
 *
 * 组成部分：
 * 1. 基础系统提示词 (system.ts)
 * 2. 环境信息
 * 3. CLAUDE.md 自定义指令
 * 4. Plan Mode 指令（可选，仅当 planMode=true）
 */
export const operatorPrompt = ({
    directory,
    language = 'Chinese',
    planMode = false,
}: OperatorPromptOptions): string => {
    const provider = buildSystemPrompt({ language });

    // 判断当前目录是否为 git 仓库
    const isGitRepo = fs.existsSync(path.resolve(directory, '.git'));

    const environment = [
        'Here is some useful information about the environment you are running in:',
        '<env>',
        `  Working directory: ${directory}`,
        `  Is directory a git repo: ${isGitRepo ? 'yes' : 'no'}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        '</env>',
    ].join('\n');

    let custom = '';
    try {
        const claudeInstructions = fs.readFileSync(path.resolve(process.cwd(), directory, 'CLAUDE.md'), 'utf-8');
        custom = `CLAUDE.md instructions:\n${claudeInstructions}\n`;
    } catch {
        custom = '';
    }

    // 构建基础提示词
    let prompt = `${provider}\n${environment}\n${custom}\n`;

    // 如果是 Plan Mode，追加 Plan 指令
    if (planMode) {
        const planPrompt = buildPlanModePrompt({ language });
        prompt = `${prompt}\n${planPrompt}\n`;
    }

    return prompt;
};
