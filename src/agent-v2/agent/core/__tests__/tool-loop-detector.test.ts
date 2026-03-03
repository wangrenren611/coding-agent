import { describe, it, expect } from 'vitest';
import type { ToolCall } from '../../../../providers';
import { ToolLoopDetector } from '../tool-loop-detector';

function createToolCall(name: string, args: string, id = 'call-1', index = 0): ToolCall {
    return {
        id,
        type: 'function',
        index,
        function: {
            name,
            arguments: args,
        },
    };
}

describe('ToolLoopDetector', () => {
    it('should detect repeated tool calls at threshold', () => {
        const detector = new ToolLoopDetector({ threshold: 3 });
        const toolCalls = [createToolCall('glob', '{"pattern":"src/**/*.ts"}')];

        expect(detector.record(toolCalls).repeated).toBe(false);
        expect(detector.record(toolCalls).repeated).toBe(false);
        expect(detector.record(toolCalls).repeated).toBe(true);
    });

    it('should treat semantically equivalent json arguments as same', () => {
        const detector = new ToolLoopDetector({ threshold: 3 });
        const a = [createToolCall('read_file', '{"b":2,"a":1}')];
        const b = [createToolCall('read_file', '{"a":1,"b":2}')];

        expect(detector.record(a).repeated).toBe(false);
        expect(detector.record(b).repeated).toBe(false);
        expect(detector.record(b).repeated).toBe(true);
    });

    it('should not detect when tool call signature changes', () => {
        const detector = new ToolLoopDetector({ threshold: 3 });

        expect(detector.record([createToolCall('glob', '{"pattern":"*.ts"}')]).repeated).toBe(false);
        expect(detector.record([createToolCall('glob', '{"pattern":"*.js"}')]).repeated).toBe(false);
        expect(detector.record([createToolCall('glob', '{"pattern":"*.ts"}')]).repeated).toBe(false);
    });

    it('should clear history after reset', () => {
        const detector = new ToolLoopDetector({ threshold: 3 });
        const toolCalls = [createToolCall('glob', '{"pattern":"src/**/*.ts"}')];

        detector.record(toolCalls);
        detector.record(toolCalls);
        detector.reset();

        expect(detector.record(toolCalls).repeated).toBe(false);
    });
});
