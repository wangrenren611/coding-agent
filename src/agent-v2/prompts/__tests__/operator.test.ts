import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { operatorPrompt } from '../operator';

describe('operatorPrompt instruction loading', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(
            tempDirs.map(async (dir) => {
                await fs.rm(dir, { recursive: true, force: true });
            })
        );
        tempDirs.length = 0;
    });

    async function createTempDir(prefix: string): Promise<string> {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
        tempDirs.push(dir);
        return dir;
    }

    it('should auto-load AGENTS.md from repo hierarchy when not provided', async () => {
        const root = await createTempDir('prompt-operator-');
        const repoDir = path.join(root, 'repo');
        const nestedDir = path.join(repoDir, 'src', 'module');
        await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
        await fs.mkdir(nestedDir, { recursive: true });
        await fs.writeFile(path.join(repoDir, 'AGENTS.md'), 'AUTO_RULE_MARKER', 'utf-8');

        const prompt = operatorPrompt({
            directory: nestedDir,
            language: 'Chinese',
        });

        expect(prompt).toContain('AUTO_RULE_MARKER');
        expect(prompt).toContain('Instructions from:');
    });

    it('should prioritize explicit agentsMd over auto-loaded instruction files', async () => {
        const root = await createTempDir('prompt-operator-');
        const repoDir = path.join(root, 'repo');
        await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
        await fs.writeFile(path.join(repoDir, 'AGENTS.md'), 'AUTO_RULE_MARKER', 'utf-8');

        const prompt = operatorPrompt({
            directory: repoDir,
            language: 'Chinese',
            agentsMd: 'MANUAL_RULE_MARKER',
        });

        expect(prompt).toContain('MANUAL_RULE_MARKER');
        expect(prompt).not.toContain('AUTO_RULE_MARKER');
    });

    it('should not load AGENTS.md above git repository root', async () => {
        const root = await createTempDir('prompt-operator-');
        const parentAgents = path.join(root, 'AGENTS.md');
        const repoDir = path.join(root, 'repo');
        const nestedDir = path.join(repoDir, 'src');
        await fs.writeFile(parentAgents, 'PARENT_SCOPE_MARKER', 'utf-8');
        await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
        await fs.mkdir(nestedDir, { recursive: true });

        const prompt = operatorPrompt({
            directory: nestedDir,
            language: 'Chinese',
        });

        expect(prompt).not.toContain('PARENT_SCOPE_MARKER');
    });
});
