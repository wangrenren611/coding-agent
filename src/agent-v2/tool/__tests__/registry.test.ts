import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../../../providers';
import { ToolRegistry } from '../registry';

describe('ToolRegistry argument validation', () => {
    it('should not reject large arguments for non-write_file tools', () => {
        const registry = new ToolRegistry({
            workingDirectory: process.cwd(),
        });
        const call: ToolCall = {
            id: 'call-big-read',
            type: 'function',
            index: 0,
            function: {
                name: 'read_file',
                arguments: JSON.stringify({ filePath: '/tmp/x.txt', padding: 'x'.repeat(256) }),
            },
        };

        expect(() => registry.validateToolCalls([call])).not.toThrow();
    });

    it('should keep large write_file payload unchanged', () => {
        const registry = new ToolRegistry({
            workingDirectory: process.cwd(),
        });
        const call: ToolCall = {
            id: 'call-big-write',
            type: 'function',
            index: 0,
            function: {
                name: 'write_file',
                arguments: JSON.stringify({
                    filePath: '/tmp/demo.txt',
                    content: 'a'.repeat(4096),
                }),
            },
        };

        expect(() => registry.validateToolCalls([call])).not.toThrow();
        const parsed = JSON.parse(call.function.arguments);
        expect(parsed.filePath).toBe('/tmp/demo.txt');
        expect(typeof parsed.content).toBe('string');
    });
});
