import { afterEach, describe, expect, it } from 'vitest';
import {
    clearSubtaskNotifierState,
    getSubtaskNotifierRevision,
    notifySubtaskStatus,
    waitForSubtaskChange,
} from '../subtask-notifier';

describe('subtask-notifier', () => {
    afterEach(() => {
        clearSubtaskNotifierState();
    });

    it('should wake waiter when status changes', async () => {
        const sessionId = 'session-wakeup';
        const startRevision = getSubtaskNotifierRevision(sessionId);
        const waitPromise = waitForSubtaskChange({
            parentSessionId: sessionId,
            sinceRevision: startRevision,
            timeoutMs: 1000,
        });

        setTimeout(() => {
            notifySubtaskStatus({
                parentSessionId: sessionId,
                runId: 'task-1',
                status: 'completed',
            });
        }, 20);

        const result = await waitPromise;
        expect(result.changed).toBe(true);
        expect(result.aborted).toBe(false);
        expect(result.event?.status).toBe('completed');
        expect(result.revision).toBeGreaterThan(startRevision);
    });

    it('should timeout when no event arrives', async () => {
        const sessionId = 'session-timeout';
        const startRevision = getSubtaskNotifierRevision(sessionId);
        const result = await waitForSubtaskChange({
            parentSessionId: sessionId,
            sinceRevision: startRevision,
            timeoutMs: 30,
        });

        expect(result.changed).toBe(false);
        expect(result.aborted).toBe(false);
        expect(result.revision).toBe(startRevision);
    });
});
