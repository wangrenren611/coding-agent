import { describe, expect, it } from 'vitest';
import { InMemoryStateStore } from '../state-store';
import type { InterAgentMessage } from '../types';

function buildMessage(overrides?: Partial<InterAgentMessage>): InterAgentMessage {
    return {
        messageId: 'msg-1',
        timestamp: Date.now(),
        fromAgentId: 'agent-a',
        toAgentId: 'agent-b',
        payload: { topic: 't1' },
        ...overrides,
    };
}

describe('InMemoryStateStore messaging reliability', () => {
    it('receives and acks message', () => {
        const store = new InMemoryStateStore();
        store.enqueueMessage('agent-b', buildMessage());

        const received = store.receiveMessages('agent-b', { limit: 1, leaseMs: 5000 });
        expect(received).toHaveLength(1);
        expect(received[0]?.status).toBe('in_flight');
        expect(received[0]?.attempt).toBe(1);

        const acked = store.ackMessage('agent-b', received[0]!.messageId);
        expect(acked).toBe(true);
        expect(store.receiveMessages('agent-b')).toHaveLength(0);
    });

    it('nack requeues then dead-letters when attempts exhausted', () => {
        const store = new InMemoryStateStore();
        store.enqueueMessage('agent-b', buildMessage({ maxAttempts: 2 }));

        const first = store.receiveMessages('agent-b', { limit: 1 });
        expect(first).toHaveLength(1);

        const nack1 = store.nackMessage('agent-b', first[0]!.messageId, { error: 'temporary error' });
        expect(nack1.requeued).toBe(true);
        expect(nack1.deadLettered).toBe(false);

        const second = store.receiveMessages('agent-b', { limit: 1 });
        expect(second).toHaveLength(1);
        expect(second[0]?.attempt).toBe(2);

        const nack2 = store.nackMessage('agent-b', second[0]!.messageId, { error: 'still failing' });
        expect(nack2.requeued).toBe(false);
        expect(nack2.deadLettered).toBe(true);

        const deadLetters = store.listDeadLetters('agent-b');
        expect(deadLetters).toHaveLength(1);
        expect(deadLetters[0]?.status).toBe('dead_letter');
    });

    it('can requeue dead-letter with reset attempts', () => {
        const store = new InMemoryStateStore();
        store.enqueueMessage('agent-b', buildMessage({ maxAttempts: 1 }));

        const first = store.receiveMessages('agent-b', { limit: 1 });
        expect(first).toHaveLength(1);
        const nacked = store.nackMessage('agent-b', first[0]!.messageId, { error: 'permanent' });
        expect(nacked.deadLettered).toBe(true);
        expect(nacked.message).toBeDefined();

        const requeued = store.requeueDeadLetter('agent-b', first[0]!.messageId, { resetAttempts: true });
        expect(requeued).toBe(true);

        const next = store.receiveMessages('agent-b', { limit: 1 });
        expect(next).toHaveLength(1);
        expect(next[0]?.attempt).toBe(1);
        expect(next[0]?.status).toBe('in_flight');
    });

    it('enforces topic partition order while allowing other topics', () => {
        const store = new InMemoryStateStore();
        const now = Date.now();

        store.enqueueMessage(
            'agent-b',
            buildMessage({
                messageId: 'topic-a-1',
                topic: 'topic-a',
                visibleAt: now + 10_000,
            })
        );
        store.enqueueMessage(
            'agent-b',
            buildMessage({
                messageId: 'topic-a-2',
                topic: 'topic-a',
                visibleAt: now,
            })
        );
        store.enqueueMessage(
            'agent-b',
            buildMessage({
                messageId: 'topic-b-1',
                topic: 'topic-b',
                visibleAt: now,
            })
        );

        const firstReceive = store.receiveMessages('agent-b', { limit: 10, now, leaseMs: 5_000 });
        expect(firstReceive.map((item) => item.messageId)).toEqual(['topic-b-1']);
        store.ackMessage('agent-b', 'topic-b-1');

        const secondReceive = store.receiveMessages('agent-b', { limit: 10, now: now + 10_001, leaseMs: 5_000 });
        expect(secondReceive.map((item) => item.messageId)).toEqual(['topic-a-1']);
    });

    it('supports idempotency lookup with expiration', () => {
        const store = new InMemoryStateStore();
        const now = Date.now();
        store.enqueueMessage(
            'agent-b',
            buildMessage({
                messageId: 'idem-1',
                idempotencyKey: 'k1',
            })
        );
        store.saveIdempotency('agent-b', 'k1', 'idem-1', now + 1_000);

        const found = store.findMessageByIdempotency('agent-b', 'k1', now + 100);
        expect(found?.messageId).toBe('idem-1');

        const expired = store.findMessageByIdempotency('agent-b', 'k1', now + 2_000);
        expect(expired).toBeUndefined();
    });
});
