import type { HistoryMessage, QueryOptions } from '../types';
import type { Message } from '../../session/types';

export interface Timestamped {
    createdAt: number;
    updatedAt: number;
}

export function clone<T>(value: T): T {
    return structuredClone(value);
}

export function sortByTimestamp<T extends Timestamped>(items: T[], options?: QueryOptions): T[] {
    const orderBy = options?.orderBy ?? 'updatedAt';
    const direction = options?.orderDirection ?? 'desc';

    return [...items].sort((a, b) => {
        const comparison = a[orderBy] - b[orderBy];
        return direction === 'asc' ? comparison : -comparison;
    });
}

export function paginate<T>(items: T[], options?: { limit?: number; offset?: number }): T[] {
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = Math.max(0, options?.limit ?? items.length);
    return items.slice(offset, offset + limit);
}

export function findLastHistoryIndex(history: HistoryMessage[], messageId: string): number {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index].messageId === messageId) {
            return index;
        }
    }
    return -1;
}

export function findLastContextIndex(messages: Message[], messageId: string): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].messageId === messageId) {
            return index;
        }
    }
    return -1;
}

export function upsertHistoryMessage(
    history: HistoryMessage[],
    message: Message,
    extras: Partial<HistoryMessage> = {}
): void {
    const existingIndex = findLastHistoryIndex(history, message.messageId);

    if (existingIndex === -1) {
        history.push({
            ...clone(message),
            sequence: history.length + 1,
            ...extras,
        });
        return;
    }

    history[existingIndex] = {
        ...history[existingIndex],
        ...clone(message),
        ...extras,
        sequence: history[existingIndex].sequence,
    };
}

export function upsertContextMessage(
    messages: Message[],
    message: Message
): { messages: Message[]; inserted: boolean } {
    const next = [...messages];
    const last = next[next.length - 1];
    if (last?.messageId === message.messageId) {
        next[next.length - 1] = clone(message);
        return { messages: next, inserted: false };
    }

    next.push(clone(message));
    return { messages: next, inserted: true };
}
