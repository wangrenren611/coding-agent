import path from 'path';
import fs from 'fs';
import { buildSystemPrompt } from './system';

export const operatorPrompt = ({ directory, language = 'Chinese' }: { directory: string; language: string }) => {
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
        custom = fs.readFileSync(path.resolve(process.cwd(), directory, 'CLAUDE.md'), 'utf-8');
    } catch {
        custom = 'No project-specific CLAUDE.md instructions found. Proceed with the base instructions above.';
    }

    return `${provider}\n${environment}\n${custom}\n`;
};
