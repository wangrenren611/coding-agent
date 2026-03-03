import { describe, expect, it } from 'vitest';
import { evaluateBashPolicy, extractSegmentCommands, getBashAllowedCommands } from '../bash-policy';

describe('bash-policy', () => {
    it('should normalize executable tokens across platforms', () => {
        expect(extractSegmentCommands('C:/Windows/System32/cmd.exe /c dir')).toEqual(['cmd']);
        expect(extractSegmentCommands('/usr/bin/ls -la')).toEqual(['ls']);
    });

    it('should include platform-specific allowed commands', () => {
        expect(getBashAllowedCommands('win32').has('dir')).toBe(true);
        expect(getBashAllowedCommands('darwin').has('open')).toBe(true);
        expect(getBashAllowedCommands('linux').has('open')).toBe(false);
    });

    it('should deny dangerous Windows drive root deletion pattern', () => {
        const decision = evaluateBashPolicy('rd /s /q C:\\', { platform: 'win32' });
        expect(decision.effect).toBe('deny');
        expect(decision.reason).toContain('drive root deletion');
    });

    it('should return ask for guarded allowlist miss when configured', () => {
        const decision = evaluateBashPolicy('custom-cli --help', {
            mode: 'guarded',
            allowlistMissEffect: 'ask',
            allowlistMissReason: (cmd) => `approval required: ${cmd}`,
        });
        expect(decision.effect).toBe('ask');
        expect(decision.reason).toContain('approval required');
    });

    it('should require approval for Windows del command in guarded mode', () => {
        const decision = evaluateBashPolicy('del "D:\\work\\coding-agent\\x.txt"', {
            platform: 'win32',
            mode: 'guarded',
            allowlistMissEffect: 'ask',
        });
        expect(decision.effect).toBe('ask');
    });

    it('should allow redirects to safe /dev pseudo-files', () => {
        const decision = evaluateBashPolicy('echo ok > /dev/null', {
            mode: 'guarded',
            allowlistMissEffect: 'ask',
        });
        expect(decision.effect).toBe('allow');
    });

    it('should deny redirects to other /dev targets', () => {
        const decision = evaluateBashPolicy('echo x > /dev/random', {
            mode: 'guarded',
            allowlistMissEffect: 'ask',
        });
        expect(decision.effect).toBe('deny');
        expect(decision.reason).toContain('protected system path');
    });
});
