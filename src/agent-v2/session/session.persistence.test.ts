import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createMemoryManager } from '../memory';
import type { IMemoryManager } from '../memory/types';
import { Session } from './index';
import type { Usage } from '../../providers';

function createUsage(total = 36): Usage {
    return {
        prompt_tokens: Math.floor(total / 2),
        completion_tokens: total - Math.floor(total / 2),
        total_tokens: total,
        prompt_cache_miss_tokens: Math.floor(total / 2),
        prompt_cache_hit_tokens: 0,
    };
}

describe('Session persistence queue', () => {
    let tempDir: string;
    let memoryManager: IMemoryManager;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-memory-'));
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();
    });

    afterEach(async () => {
        await memoryManager.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should persist streamed message updates as a single history entry after sync', async () => {
        const sessionId = 'session-sync-upsert';
        const usage = createUsage(64);

        const session = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await session.initialize();

        session.addMessage({
            messageId: 'assistant-1',
            role: 'assistant',
            content: 'partial',
            type: 'text',
        });

        session.addMessage({
            messageId: 'assistant-1',
            role: 'assistant',
            content: 'final',
            type: 'text',
            finish_reason: 'stop',
            usage,
        });

        await session.sync();

        const history = await memoryManager.getFullHistory({ sessionId });
        const assistantMessages = history.filter((item) => item.messageId === 'assistant-1');
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0].content).toBe('final');
        expect(assistantMessages[0].usage).toEqual(usage);
    });

    it('should repair interrupted tool calls after restart and keep repair idempotent', async () => {
        const sessionId = 'session-repair-tool-calls';
        const session = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await session.initialize();

        session.addMessage({
            messageId: 'assistant-tool-1',
            role: 'assistant',
            content: '',
            type: 'tool-call',
            finish_reason: 'tool_calls',
            tool_calls: [
                { id: 'call_1', type: 'function', index: 0, function: { name: 'tool_a', arguments: '{}' } },
                { id: 'call_2', type: 'function', index: 1, function: { name: 'tool_b', arguments: '{}' } },
            ],
        });
        await session.sync();

        await memoryManager.close();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        const resumed = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await resumed.initialize();

        const firstPassCompacted = await resumed.compactBeforeLLMCall();
        expect(firstPassCompacted).toBe(false);

        const firstPassToolMessages = resumed
            .getMessages()
            .filter((msg) => msg.role === 'tool')
            .map((msg) => msg as { tool_call_id?: string; content: string });
        expect(firstPassToolMessages.map((msg) => msg.tool_call_id)).toEqual(['call_1', 'call_2']);
        for (const toolMessage of firstPassToolMessages) {
            const payload = JSON.parse(toolMessage.content);
            expect(payload.error).toBe('TOOL_CALL_INTERRUPTED');
            expect(payload.interrupted).toBe(true);
        }

        const secondPassCompacted = await resumed.compactBeforeLLMCall();
        expect(secondPassCompacted).toBe(false);
        const secondPassToolMessages = resumed.getMessages().filter((msg) => msg.role === 'tool');
        expect(secondPassToolMessages).toHaveLength(2);

        const historyAfterRepair = await memoryManager.getFullHistory({ sessionId });
        const interruptedToolInHistory = historyAfterRepair.filter(
            (msg) => msg.role === 'tool' && String(msg.content || '').includes('TOOL_CALL_INTERRUPTED')
        );
        expect(interruptedToolInHistory).toHaveLength(0);
    });

    it('should only repair missing tool results when some tool calls are already completed', async () => {
        const sessionId = 'session-repair-partial-tool-calls';
        const session = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await session.initialize();

        session.addMessage({
            messageId: 'assistant-tool-2',
            role: 'assistant',
            content: '',
            type: 'tool-call',
            finish_reason: 'tool_calls',
            tool_calls: [
                { id: 'call_a', type: 'function', index: 0, function: { name: 'tool_a', arguments: '{}' } },
                { id: 'call_b', type: 'function', index: 1, function: { name: 'tool_b', arguments: '{}' } },
            ],
        });
        session.addMessage({
            messageId: 'tool-result-a',
            role: 'tool',
            type: 'tool-result',
            tool_call_id: 'call_a',
            content: JSON.stringify({ success: true, output: 'ok' }),
        });
        await session.sync();

        await memoryManager.close();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        const resumed = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await resumed.initialize();
        await resumed.compactBeforeLLMCall();

        const repairedMessages = resumed
            .getMessages()
            .filter((msg) => msg.role === 'tool')
            .map((msg) => msg as { tool_call_id?: string; content: string });
        expect(repairedMessages).toHaveLength(2);
        expect(repairedMessages.map((msg) => msg.tool_call_id)).toEqual(['call_a', 'call_b']);

        const preserved = JSON.parse(repairedMessages[0].content);
        expect(preserved.success).toBe(true);

        const repaired = JSON.parse(repairedMessages[1].content);
        expect(repaired.error).toBe('TOOL_CALL_INTERRUPTED');
        expect(repaired.interrupted).toBe(true);

        const historyAfterRepair = await memoryManager.getFullHistory({ sessionId });
        const toolHistory = historyAfterRepair.filter((msg) => msg.role === 'tool');
        expect(toolHistory).toHaveLength(1);
        expect(toolHistory[0].tool_call_id).toBe('call_a');
        expect(String(toolHistory[0].content || '')).not.toContain('TOOL_CALL_INTERRUPTED');
    });

    it('should repair interleaved tool result in context only and keep history untouched', async () => {
        const sessionId = 'session-repair-interleaved-tool-result';
        const session = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await session.initialize();

        session.addMessage({
            messageId: 'assistant-tool-interleaved',
            role: 'assistant',
            content: '',
            type: 'tool-call',
            finish_reason: 'tool_calls',
            tool_calls: [{ id: 'call_ctx_1', type: 'function', index: 0, function: { name: 'tool_x', arguments: '{}' } }],
        });
        session.addMessage({
            messageId: 'user-interleaved',
            role: 'user',
            content: '继续',
            type: 'text',
        });
        session.addMessage({
            messageId: 'tool-late-result',
            role: 'tool',
            type: 'tool-result',
            tool_call_id: 'call_ctx_1',
            content: JSON.stringify({ success: true, output: 'late' }),
        });
        await session.sync();

        await memoryManager.close();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        const resumed = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await resumed.initialize();

        const repairedContextTools = resumed
            .getMessages()
            .filter((msg) => msg.role === 'tool')
            .map((msg) => msg as { tool_call_id?: string; content: string });
        expect(repairedContextTools).toHaveLength(1);
        expect(repairedContextTools[0].tool_call_id).toBe('call_ctx_1');
        expect(repairedContextTools[0].content).toContain('TOOL_CALL_INTERRUPTED');

        const fullHistory = await memoryManager.getFullHistory({ sessionId });
        const historyTools = fullHistory.filter((msg) => msg.role === 'tool');
        expect(historyTools).toHaveLength(1);
        expect(historyTools[0].tool_call_id).toBe('call_ctx_1');
        expect(String(historyTools[0].content || '')).toContain('"output":"late"');
        expect(String(historyTools[0].content || '')).not.toContain('TOOL_CALL_INTERRUPTED');
    });

    it('should drop duplicate/unexpected tool results in context and keep raw history', async () => {
        const sessionId = 'session-repair-duplicate-tool-results';
        const session = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await session.initialize();

        session.addMessage({
            messageId: 'assistant-tool-duplicate',
            role: 'assistant',
            content: '',
            type: 'tool-call',
            finish_reason: 'tool_calls',
            tool_calls: [
                { id: 'call_keep', type: 'function', index: 0, function: { name: 'tool_a', arguments: '{}' } },
                { id: 'call_missing', type: 'function', index: 1, function: { name: 'tool_b', arguments: '{}' } },
            ],
        });
        session.addMessage({
            messageId: 'tool-keep-first',
            role: 'tool',
            type: 'tool-result',
            tool_call_id: 'call_keep',
            content: JSON.stringify({ success: true, output: 'first' }),
        });
        session.addMessage({
            messageId: 'tool-keep-duplicate',
            role: 'tool',
            type: 'tool-result',
            tool_call_id: 'call_keep',
            content: JSON.stringify({ success: true, output: 'duplicate' }),
        });
        session.addMessage({
            messageId: 'tool-unexpected',
            role: 'tool',
            type: 'tool-result',
            tool_call_id: 'call_unknown',
            content: JSON.stringify({ success: true, output: 'unknown' }),
        });
        await session.sync();

        await memoryManager.close();
        memoryManager = createMemoryManager({
            type: 'file',
            connectionString: tempDir,
        });
        await memoryManager.initialize();

        const resumed = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await resumed.initialize();

        const contextTools = resumed
            .getMessages()
            .filter((msg) => msg.role === 'tool')
            .map((msg) => msg as { tool_call_id?: string; content: string });
        expect(contextTools).toHaveLength(2);
        expect(contextTools.map((msg) => msg.tool_call_id)).toEqual(['call_keep', 'call_missing']);
        expect(contextTools[0].content).toContain('"output":"first"');
        expect(contextTools[1].content).toContain('TOOL_CALL_INTERRUPTED');

        const fullHistory = await memoryManager.getFullHistory({ sessionId });
        const historyTools = fullHistory.filter((msg) => msg.role === 'tool');
        expect(historyTools).toHaveLength(3);
        expect(historyTools.map((msg) => msg.tool_call_id)).toEqual(['call_keep', 'call_keep', 'call_unknown']);
        expect(historyTools.some((msg) => String(msg.content || '').includes('TOOL_CALL_INTERRUPTED'))).toBe(false);
    });

    it('should remove message from context while preserving full history', async () => {
        const sessionId = 'session-remove-message';
        const session = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await session.initialize();

        session.addMessage({
            messageId: 'user-1',
            role: 'user',
            content: 'hello',
        });
        session.addMessage({
            messageId: 'assistant-empty-1',
            role: 'assistant',
            content: '',
            type: 'text',
        });
        await session.sync();

        const removed = await session.removeMessageById('assistant-empty-1');
        expect(removed?.messageId).toBe('assistant-empty-1');

        const inMemory = session.getMessages().filter((m) => m.messageId === 'assistant-empty-1');
        expect(inMemory).toHaveLength(0);

        const history = await memoryManager.getFullHistory({ sessionId });
        const inHistory = history.filter((m) => m.messageId === 'assistant-empty-1');
        expect(inHistory).toHaveLength(1);
        expect(inHistory[0].excludedFromContext).toBe(true);
        expect(inHistory[0].excludedReason).toBe('manual');
    });

    it('should persist explicit exclusion reason when removing message from context', async () => {
        const sessionId = 'session-remove-message-with-reason';
        const session = new Session({
            sessionId,
            systemPrompt: 'test',
            memoryManager,
        });
        await session.initialize();

        session.addMessage({
            messageId: 'assistant-empty-2',
            role: 'assistant',
            content: '',
            type: 'text',
        });
        await session.sync();

        const removed = await session.removeMessageById('assistant-empty-2', 'empty_response');
        expect(removed?.messageId).toBe('assistant-empty-2');

        const history = await memoryManager.getFullHistory({ sessionId });
        const inHistory = history.filter((m) => m.messageId === 'assistant-empty-2');
        expect(inHistory).toHaveLength(1);
        expect(inHistory[0].excludedFromContext).toBe(true);
        expect(inHistory[0].excludedReason).toBe('empty_response');
    });
});
