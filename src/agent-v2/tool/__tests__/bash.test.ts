import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import BashTool from '../bash';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('BashTool', () => {
    const backgroundPids: number[] = [];
    const backgroundLogs: string[] = [];

    afterEach(async () => {
        for (const pid of backgroundPids) {
            try {
                process.kill(pid, 'SIGTERM');
            } catch {
                // ignore cleanup failures
            }
        }
        backgroundPids.length = 0;

        for (const logPath of backgroundLogs) {
            try {
                await fs.promises.rm(logPath, { force: true });
            } catch {
                // ignore cleanup failures
            }
        }
        backgroundLogs.length = 0;
    });

    it('should parse run_in_background from string "true"', () => {
        const tool = new BashTool();
        const parsed = tool.schema.safeParse({
            command: 'echo ok',
            run_in_background: 'true',
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.run_in_background).toBe(true);
        }
    });

    it('should start command in background and return immediately', async () => {
        const tool = new BashTool();
        const startedAt = Date.now();

        const result = await tool.execute({
            command: 'node -e "setTimeout(() => {}, 2000)"',
            run_in_background: true,
        });

        const elapsed = Date.now() - startedAt;
        expect(result.success).toBe(true);
        expect(elapsed).toBeLessThan(1000);
        expect(String(result.output || '')).toContain('BACKGROUND_STARTED');

        const metadata = (result.metadata || {}) as { pid?: unknown; logPath?: unknown };
        expect(typeof metadata.logPath).toBe('string');
        if (typeof metadata.logPath === 'string') {
            backgroundLogs.push(metadata.logPath);
            expect(fs.existsSync(metadata.logPath)).toBe(true);
        }

        if (typeof metadata.pid === 'number') {
            backgroundPids.push(metadata.pid);
        }
    });

    it('should write background command output to log file', async () => {
        const tool = new BashTool();
        const result = await tool.execute({
            command: 'echo background-log-check',
            run_in_background: 'true' as unknown as boolean,
        });

        expect(result.success).toBe(true);
        const metadata = (result.metadata || {}) as { logPath?: unknown };
        expect(typeof metadata.logPath).toBe('string');
        if (typeof metadata.logPath !== 'string') return;
        backgroundLogs.push(metadata.logPath);

        let logContent = '';
        for (let i = 0; i < 100; i += 1) {
            if (fs.existsSync(metadata.logPath)) {
                logContent = await fs.promises.readFile(metadata.logPath, 'utf8');
                if (logContent.includes('background-log-check')) {
                    break;
                }
            }
            await sleep(50);
        }

        expect(logContent).toContain('background-log-check');
    });
});
