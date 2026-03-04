import { describe, expect, it } from 'vitest';
import { sanitizeStringContent, sanitizeToolResult, toolResultToString } from '../index';

describe('security sanitizeStringContent', () => {
    it('should not redact code expressions that only reference header lookup', () => {
        const input = "const apiKey = request.headers['x-api-key'];";
        expect(sanitizeStringContent(input)).toBe(input);
    });

    it('should not redact documentation text and file paths', () => {
        const input = [
            '1. API Key (X-API-Key header)',
            "const keyName = 'x-api-key';",
            '/Users/wrr/work/coding-agent/agent-service-doc/10-LLM-Provider设计.md',
            '/Users/wrr/work/coding-agent/agent-service-doc/12-Worker基础知识详解.md',
        ].join('\n');

        expect(sanitizeStringContent(input)).toBe(input);
    });

    it('should not redact non-secret config names that only contain sensitive words', () => {
        const input = [
            'X_API_KEY_HEADER=x-api-key',
            'TOKEN_HEADER_NAME=Authorization',
            'PASSWORD_HINT=at least 12 chars',
        ].join('\n');
        const output = sanitizeStringContent(input);

        expect(output).toBe(input);
    });

    it('should redact env-style sensitive assignments while preserving keys', () => {
        const input = [
            'API_KEY=sk-1234567890',
            'POSTGRES_PASSWORD=postgres',
            'GF_SECURITY_ADMIN_PASSWORD=admin123',
        ].join('\n');

        const output = sanitizeStringContent(input);
        expect(output).toContain('API_KEY=[REDACTED]');
        expect(output).toContain('POSTGRES_PASSWORD=[REDACTED]');
        expect(output).toContain('GF_SECURITY_ADMIN_PASSWORD=[REDACTED]');
        expect(output).not.toContain('POSTGRES_[REDACTED]');
        expect(output).not.toContain('GF_SECURITY_ADMIN_[REDACTED]');
    });

    it('should redact sensitive env assignments with export and keep trailing comments', () => {
        const input = [
            'export OPENAI_API_KEY=sk-abc123456789 # production key',
            'export AWS_SECRET_ACCESS_KEY=ABCDEFGHIJKLMNOPQRSTUV0123456789 # do not share',
        ].join('\n');
        const output = sanitizeStringContent(input);

        expect(output).toContain('export OPENAI_API_KEY=[REDACTED] # production key');
        expect(output).toContain('export AWS_SECRET_ACCESS_KEY=[REDACTED] # do not share');
        expect(output).not.toContain('sk-abc123456789');
        expect(output).not.toContain('ABCDEFGHIJKLMNOPQRSTUV0123456789');
    });

    it('should redact quoted sensitive assignments in code while preserving assignment shape', () => {
        const input = `const apiKey = "my-very-secret-key";\nconst password = 'superpass123';`;
        const output = sanitizeStringContent(input);

        expect(output).toContain('apiKey = "[REDACTED]"');
        expect(output).toContain("password = '[REDACTED]'");
    });

    it('should keep key names intact while redacting only values', () => {
        const input = [
            'POSTGRES_PASSWORD=postgres',
            'GF_SECURITY_ADMIN_PASSWORD=admin123',
            'AWS_SECRET_ACCESS_KEY=ABCDEFGHIJKLMNOPQRSTUV0123456789',
        ].join('\n');
        const output = sanitizeStringContent(input);

        expect(output).toContain('POSTGRES_PASSWORD=[REDACTED]');
        expect(output).toContain('GF_SECURITY_ADMIN_PASSWORD=[REDACTED]');
        expect(output).toContain('AWS_SECRET_ACCESS_KEY=[REDACTED]');
        expect(output).not.toContain('POSTGRES_[REDACTED]');
        expect(output).not.toContain('GF_SECURITY_ADMIN_[REDACTED]');
        expect(output).not.toContain('AWS_SECRET_ACCESS_[REDACTED]');
    });
});

describe('security sanitizeToolResult', () => {
    it('should keep code snippet readable and still redact real secret values', () => {
        const sanitized = sanitizeToolResult({
            tool_call_id: 'call-1',
            result: {
                success: true,
                output: "const apiKey = request.headers['x-api-key'];\nAPI_KEY=abcdef1234567890",
            },
        });

        const output = toolResultToString(sanitized);
        expect(output).toContain("const apiKey = request.headers['x-api-key'];");
        expect(output).toContain('API_KEY=[REDACTED]');
        expect(output).not.toContain('abcdef1234567890');
    });

    it('should avoid false replacement in mixed documentation output', () => {
        const sanitized = sanitizeToolResult({
            tool_call_id: 'call-2',
            result: {
                success: true,
                output: [
                    "const apiKey = request.headers['x-api-key'];",
                    '/Users/wrr/work/coding-agent/agent-service-doc/10-LLM-Provider设计.md',
                    'POSTGRES_PASSWORD=postgres',
                ].join('\n'),
            },
        });

        const output = toolResultToString(sanitized);
        expect(output).toContain("const apiKey = request.headers['x-api-key'];");
        expect(output).toContain('/Users/wrr/work/coding-agent/agent-service-doc/10-LLM-Provider设计.md');
        expect(output).toContain('POSTGRES_PASSWORD=[REDACTED]');
        expect(output).not.toContain('POSTGRES_[REDACTED]');
    });
});
