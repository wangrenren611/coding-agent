import type { ToolCall } from '../../../providers';

export interface ToolLoopDetectorOptions {
    threshold?: number;
}

export interface ToolLoopDetectionResult {
    repeated: boolean;
    threshold: number;
    toolNames: string[];
}

const DEFAULT_THRESHOLD = 3;

function normalizeForStableJSONStringify(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeForStableJSONStringify(item));
    }
    if (value && typeof value === 'object') {
        const normalized: Record<string, unknown> = {};
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
        for (const [key, nested] of entries) {
            normalized[key] = normalizeForStableJSONStringify(nested);
        }
        return normalized;
    }
    return value;
}

export class ToolLoopDetector {
    private readonly threshold: number;
    private recentSignatures: string[] = [];

    constructor(options?: ToolLoopDetectorOptions) {
        const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
        this.threshold = threshold > 0 ? threshold : DEFAULT_THRESHOLD;
    }

    reset(): void {
        this.recentSignatures = [];
    }

    record(toolCalls: ToolCall[]): ToolLoopDetectionResult {
        const signature = this.buildSignature(toolCalls);
        this.recentSignatures.push(signature);
        if (this.recentSignatures.length > this.threshold) {
            this.recentSignatures.shift();
        }

        const repeated =
            this.recentSignatures.length >= this.threshold && this.recentSignatures.every((item) => item === signature);

        return {
            repeated,
            threshold: this.threshold,
            toolNames: this.extractToolNames(toolCalls),
        };
    }

    private buildSignature(toolCalls: ToolCall[]): string {
        return JSON.stringify(
            toolCalls.map((toolCall) => ({
                toolName: toolCall.function?.name || '',
                args: this.normalizeToolCallArguments(toolCall.function?.arguments || ''),
            }))
        );
    }

    private normalizeToolCallArguments(argumentsText: string): string {
        const trimmed = argumentsText.trim();
        if (!trimmed) return '';

        try {
            const parsed = JSON.parse(trimmed) as unknown;
            return JSON.stringify(normalizeForStableJSONStringify(parsed));
        } catch {
            return trimmed;
        }
    }

    private extractToolNames(toolCalls: ToolCall[]): string[] {
        return Array.from(
            new Set(
                toolCalls
                    .map((toolCall) => toolCall.function?.name || '')
                    .map((name) => name.trim())
                    .filter((name) => name.length > 0)
            )
        );
    }
}
