import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermissionEngine } from '../permission-engine';
import type { PermissionRequest } from '../permission-engine';

function createRequest(toolName: string, args: Record<string, unknown> = {}): PermissionRequest {
    return {
        toolCall: {
            id: `call-${toolName}`,
            type: 'function',
            index: 0,
            function: {
                name: toolName,
                arguments: JSON.stringify(args),
            },
        },
    };
}

describe('PermissionEngine', () => {
    const ENV_KEYS = [
        'AGENT_PERMISSION_DENY_TOOLS',
        'AGENT_PERMISSION_ASK_TOOLS',
        'AGENT_PERMISSION_ALLOW_TOOLS',
        'BASH_TOOL_POLICY',
    ] as const;
    const envBackup: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            envBackup[key] = process.env[key];
        }
        delete process.env.AGENT_PERMISSION_DENY_TOOLS;
        delete process.env.AGENT_PERMISSION_ASK_TOOLS;
        delete process.env.AGENT_PERMISSION_ALLOW_TOOLS;
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            const value = envBackup[key];
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('should allow by default when no rules match', () => {
        const engine = new PermissionEngine({ useDefaultSources: false });
        const decision = engine.evaluate(createRequest('read_file', { filePath: 'a.txt' }));
        expect(decision.effect).toBe('allow');
        expect(decision.source).toBe('default');
    });

    it('should prioritize deny over ask and allow', () => {
        const engine = new PermissionEngine({
            useDefaultSources: false,
            rules: [
                { effect: 'allow', tool: 'write_file', source: 'test' },
                { effect: 'ask', tool: 'write_file', source: 'test' },
                { effect: 'deny', tool: 'write_file', source: 'test', reason: 'blocked' },
            ],
        });

        const decision = engine.evaluate(createRequest('write_file', { filePath: 'a.txt', content: 'x' }));
        expect(decision.effect).toBe('deny');
        expect(decision.source).toBe('test');
        expect(decision.reason).toBe('blocked');
    });

    it('should generate stable ASK fingerprint for equivalent args', () => {
        const engine = new PermissionEngine({
            useDefaultSources: false,
            rules: [{ effect: 'ask', tool: 'write_file', source: 'test', reason: 'manual approval' }],
        });

        const decisionA = engine.evaluate(
            createRequest('write_file', { filePath: 'a.txt', content: 'x', mode: 0o644 })
        );
        const decisionB = engine.evaluate(
            createRequest('write_file', { mode: 0o644, content: 'x', filePath: 'a.txt' })
        );

        expect(decisionA.effect).toBe('ask');
        expect(decisionB.effect).toBe('ask');
        expect(decisionA.ticket?.fingerprint).toBe(decisionB.ticket?.fingerprint);
        expect(decisionA.ticket?.id).not.toBe(decisionB.ticket?.id);
    });

    it('should support mode-aware rules via when predicate', () => {
        const engine = new PermissionEngine({
            useDefaultSources: false,
            rules: [
                {
                    effect: 'deny',
                    tool: 'write_file',
                    source: 'test_mode',
                    reason: 'blocked in plan mode',
                    when: (request) => request.planMode === true,
                },
            ],
        });

        const denied = engine.evaluate({ ...createRequest('write_file', { filePath: 'a.txt' }), planMode: true });
        const allowed = engine.evaluate({ ...createRequest('write_file', { filePath: 'a.txt' }), planMode: false });

        expect(denied.effect).toBe('deny');
        expect(allowed.effect).toBe('allow');
    });

    it('should keep legacy bash policy as default source', () => {
        process.env.BASH_TOOL_POLICY = 'guarded';

        const engine = new PermissionEngine();
        const decision = engine.evaluate(createRequest('bash', { command: 'sudo ls' }));

        expect(decision.effect).toBe('deny');
        expect(decision.source).toBe('legacy_bash');
        expect(decision.reason).toContain('blocked by security policy');
    });

    it('should keep legacy plan-mode policy opt-in only', () => {
        const engineDefault = new PermissionEngine({ useDefaultSources: true });
        const defaultDecision = engineDefault.evaluate({
            ...createRequest('write_file', { filePath: 'a.txt', content: 'x' }),
            planMode: true,
        });
        expect(defaultDecision.effect).toBe('allow');

        const engineWithPlanPolicy = new PermissionEngine({
            useDefaultSources: true,
            includeLegacyPlanModePolicy: true,
        });
        const deniedDecision = engineWithPlanPolicy.evaluate({
            ...createRequest('write_file', { filePath: 'a.txt', content: 'x' }),
            planMode: true,
        });
        expect(deniedDecision.effect).toBe('deny');
        expect(deniedDecision.source).toBe('legacy_plan_mode');
    });
});
