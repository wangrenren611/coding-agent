import { v4 as uuid } from 'uuid';
import type { Message } from '../../session/types';
import {
    CompactContextOptions,
    CompactionRecord,
    ContextExclusionReason,
    CurrentContext,
    HistoryFilter,
    HistoryMessage,
    HistoryQueryOptions,
    QueryOptions,
    SessionData,
    SessionFilter,
} from '../types';
import type { MemoryStoreBundle } from '../ports/stores';
import {
    clone,
    findLastContextIndex,
    findLastHistoryIndex,
    paginate,
    sortByTimestamp,
    upsertContextMessage,
    upsertHistoryMessage,
} from '../domain/helpers';
import { ensureHistoryList, type MemoryCache, requireContext, requireSession } from './state';

export class SessionContextService {
    constructor(
        private readonly cache: MemoryCache,
        private readonly stores: MemoryStoreBundle
    ) {}

    async createSession(sessionId: string | undefined, systemPrompt: string): Promise<string> {
        const sid = sessionId || uuid();
        if (this.cache.sessions.has(sid)) {
            throw new Error(`Session already exists: ${sid}`);
        }

        const now = Date.now();
        const contextId = uuid();

        const session: SessionData = {
            id: sid,
            sessionId: sid,
            systemPrompt,
            currentContextId: contextId,
            totalMessages: 1,
            compactionCount: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        };

        const systemMessage: Message = {
            messageId: 'system',
            role: 'system',
            content: systemPrompt,
        };

        const context: CurrentContext = {
            id: contextId,
            contextId,
            sessionId: sid,
            systemPrompt,
            messages: [systemMessage],
            version: 1,
            createdAt: now,
            updatedAt: now,
            stats: {
                totalMessagesInHistory: 1,
                compactionCount: 0,
            },
        };

        const history: HistoryMessage[] = [
            {
                ...systemMessage,
                sequence: 1,
                turn: 0,
            },
        ];

        this.cache.sessions.set(sid, session);
        this.cache.contexts.set(sid, context);
        this.cache.histories.set(sid, history);
        this.cache.compactionRecords.set(sid, []);

        await Promise.all([
            this.stores.sessions.save(sid, session),
            this.stores.contexts.save(sid, context),
            this.stores.histories.save(sid, history),
            this.stores.compactions.save(sid, []),
        ]);

        return sid;
    }

    getSession(sessionId: string): SessionData | null {
        const session = this.cache.sessions.get(sessionId);
        return session ? clone(session) : null;
    }

    querySessions(filter?: SessionFilter, options?: QueryOptions): SessionData[] {
        let sessions = Array.from(this.cache.sessions.values());

        if (filter) {
            if (filter.sessionId) {
                sessions = sessions.filter((item) => item.sessionId === filter.sessionId);
            }
            if (filter.status) {
                sessions = sessions.filter((item) => item.status === filter.status);
            }
            if (filter.startTime !== undefined) {
                const startTime = filter.startTime;
                sessions = sessions.filter((item) => item.createdAt >= startTime);
            }
            if (filter.endTime !== undefined) {
                const endTime = filter.endTime;
                sessions = sessions.filter((item) => item.createdAt <= endTime);
            }
        }

        return paginate(sortByTimestamp(sessions, options), options).map((item) => clone(item));
    }

    getCurrentContext(sessionId: string): CurrentContext | null {
        const context = this.cache.contexts.get(sessionId);
        return context ? clone(context) : null;
    }

    async saveCurrentContext(context: Omit<CurrentContext, 'createdAt' | 'updatedAt'>): Promise<void> {
        const session = requireSession(this.cache, context.sessionId);
        const now = Date.now();
        const existing = this.cache.contexts.get(context.sessionId);

        const nextContext: CurrentContext = {
            ...clone(context),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        this.cache.contexts.set(context.sessionId, nextContext);
        session.updatedAt = now;

        await Promise.all([
            this.stores.contexts.save(context.sessionId, nextContext),
            this.stores.sessions.save(context.sessionId, session),
        ]);
    }

    async addMessageToContext(
        sessionId: string,
        message: Message,
        options: { addToHistory?: boolean } = {}
    ): Promise<void> {
        const session = requireSession(this.cache, sessionId);
        const context = requireContext(this.cache, sessionId);
        const nextContextResult = upsertContextMessage(context.messages, message);
        context.messages = nextContextResult.messages;

        const shouldAddToHistory = options.addToHistory !== false;
        let historyChanged = false;
        let historyLength = this.cache.histories.get(sessionId)?.length ?? 0;

        if (shouldAddToHistory) {
            const history = ensureHistoryList(this.cache, sessionId);
            upsertHistoryMessage(history, message);
            historyChanged = true;
            historyLength = history.length;
            session.totalMessages = historyLength;
        }

        const now = Date.now();
        context.updatedAt = now;
        if (nextContextResult.inserted) {
            context.version += 1;
        }
        if (context.stats) {
            context.stats.totalMessagesInHistory = historyLength;
        }
        session.updatedAt = now;

        const writes: Promise<void>[] = [
            this.stores.contexts.save(sessionId, context),
            this.stores.sessions.save(sessionId, session),
        ];
        if (historyChanged) {
            writes.push(this.stores.histories.save(sessionId, this.cache.histories.get(sessionId) || []));
        }
        await Promise.all(writes);
    }

    async updateMessageInContext(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void> {
        const session = requireSession(this.cache, sessionId);
        const context = requireContext(this.cache, sessionId);
        const contextIndex = findLastContextIndex(context.messages, messageId);
        if (contextIndex === -1) {
            throw new Error(`Message not found in context: ${messageId}`);
        }

        const safeUpdates = clone(updates);
        delete safeUpdates.messageId;

        context.messages[contextIndex] = {
            ...context.messages[contextIndex],
            ...safeUpdates,
        };

        const history = this.cache.histories.get(sessionId);
        let historyChanged = false;
        if (history) {
            const historyIndex = findLastHistoryIndex(history, messageId);
            if (historyIndex !== -1) {
                history[historyIndex] = {
                    ...history[historyIndex],
                    ...safeUpdates,
                    sequence: history[historyIndex].sequence,
                };
                historyChanged = true;
            }
        }

        const now = Date.now();
        context.updatedAt = now;
        session.updatedAt = now;

        const writes: Promise<void>[] = [
            this.stores.contexts.save(sessionId, context),
            this.stores.sessions.save(sessionId, session),
        ];
        if (historyChanged) {
            writes.push(this.stores.histories.save(sessionId, history || []));
        }
        await Promise.all(writes);
    }

    async removeMessageFromContext(
        sessionId: string,
        messageId: string,
        reason: ContextExclusionReason = 'manual'
    ): Promise<boolean> {
        const session = requireSession(this.cache, sessionId);
        const context = requireContext(this.cache, sessionId);
        const history = this.cache.histories.get(sessionId);

        const contextIndex = findLastContextIndex(context.messages, messageId);
        const historyIndex = history ? findLastHistoryIndex(history, messageId) : -1;

        if (contextIndex === -1) return false;

        const target = context.messages[contextIndex];
        if (!target || target.role === 'system') return false;

        context.messages.splice(contextIndex, 1);
        context.version += 1;

        let historyChanged = false;
        if (history && historyIndex !== -1) {
            const historyItem = history[historyIndex];
            if (historyItem.role !== 'system') {
                history[historyIndex] = {
                    ...historyItem,
                    excludedFromContext: true,
                    excludedReason: reason,
                };
                historyChanged = true;
            }
        }

        const now = Date.now();
        context.updatedAt = now;
        session.updatedAt = now;
        if (context.stats) {
            context.stats.totalMessagesInHistory = history ? history.length : context.messages.length;
        }
        session.totalMessages = history ? history.length : context.messages.length;

        const writes: Promise<void>[] = [
            this.stores.contexts.save(sessionId, context),
            this.stores.sessions.save(sessionId, session),
        ];
        if (historyChanged) {
            writes.push(this.stores.histories.save(sessionId, history || []));
        }
        await Promise.all(writes);
        return true;
    }

    async clearContext(sessionId: string): Promise<void> {
        const session = requireSession(this.cache, sessionId);
        const context = requireContext(this.cache, sessionId);

        const systemMessage = context.messages.find((item) => item.role === 'system');
        context.messages = systemMessage ? [systemMessage] : [];
        context.version += 1;

        const now = Date.now();
        context.updatedAt = now;
        session.updatedAt = now;

        await Promise.all([this.stores.contexts.save(sessionId, context), this.stores.sessions.save(sessionId, session)]);
    }

    async compactContext(sessionId: string, options: CompactContextOptions): Promise<CompactionRecord> {
        const session = requireSession(this.cache, sessionId);
        const context = requireContext(this.cache, sessionId);
        const history = ensureHistoryList(this.cache, sessionId);

        const keepLastN = Math.max(0, options.keepLastN);
        const now = Date.now();

        const systemMessage = context.messages.find((item) => item.role === 'system');
        const nonSystemMessages = context.messages.filter((item) => item.role !== 'system');

        const archiveCount = Math.max(0, nonSystemMessages.length - keepLastN);
        const messagesToArchive = nonSystemMessages.slice(0, archiveCount);
        const keptMessages = nonSystemMessages.slice(archiveCount);

        const archivedMessageIds = messagesToArchive.map((item) => item.messageId);
        const archivedIdSet = new Set(archivedMessageIds);

        const summaryMessage: Message = {
            ...clone(options.summaryMessage),
            type: options.summaryMessage.type ?? 'summary',
        };

        const recordId = uuid();
        for (const message of history) {
            if (archivedIdSet.has(message.messageId)) {
                message.archivedBy = recordId;
            }
        }

        upsertHistoryMessage(history, summaryMessage, {
            isSummary: true,
            archivedBy: undefined,
        });

        const previousMessageCount = context.messages.length;
        context.messages = systemMessage ? [systemMessage, summaryMessage, ...keptMessages] : [summaryMessage, ...keptMessages];
        context.version += 1;
        context.lastCompactionId = recordId;
        context.updatedAt = now;

        session.compactionCount += 1;
        session.totalMessages = history.length;
        session.updatedAt = now;

        context.stats = {
            totalMessagesInHistory: history.length,
            compactionCount: session.compactionCount,
            lastCompactionAt: now,
        };

        const record: CompactionRecord = {
            id: recordId,
            recordId,
            sessionId,
            compactedAt: now,
            messageCountBefore: previousMessageCount,
            messageCountAfter: context.messages.length,
            archivedMessageIds,
            summaryMessageId: summaryMessage.messageId,
            reason: options.reason ?? 'manual',
            metadata: {
                tokenCountBefore: options.tokenCountBefore,
                tokenCountAfter: options.tokenCountAfter,
                triggerMessageId: options.triggerMessageId,
            },
            createdAt: now,
            updatedAt: now,
        };

        const records = this.cache.compactionRecords.get(sessionId) || [];
        records.push(record);
        this.cache.compactionRecords.set(sessionId, records);

        await Promise.all([
            this.stores.contexts.save(sessionId, context),
            this.stores.histories.save(sessionId, history),
            this.stores.sessions.save(sessionId, session),
            this.stores.compactions.save(sessionId, records),
        ]);

        return clone(record);
    }

    getFullHistory(filter: HistoryFilter, options?: HistoryQueryOptions): HistoryMessage[] {
        let result = [...(this.cache.histories.get(filter.sessionId) || [])];

        if (filter.messageIds && filter.messageIds.length > 0) {
            const messageIdSet = new Set(filter.messageIds);
            result = result.filter((item) => messageIdSet.has(item.messageId));
        }
        if (filter.sequenceStart !== undefined) {
            const sequenceStart = filter.sequenceStart;
            result = result.filter((item) => item.sequence >= sequenceStart);
        }
        if (filter.sequenceEnd !== undefined) {
            const sequenceEnd = filter.sequenceEnd;
            result = result.filter((item) => item.sequence <= sequenceEnd);
        }
        if (filter.includeSummary === false) {
            result = result.filter((item) => !item.isSummary);
        }
        if (filter.archivedBy) {
            result = result.filter((item) => item.archivedBy === filter.archivedBy);
        }

        const direction = options?.orderDirection ?? 'asc';
        result.sort((a, b) => {
            const comparison = a.sequence - b.sequence;
            return direction === 'asc' ? comparison : -comparison;
        });

        return paginate(result, options).map((item) => clone(item));
    }

    getCompactionRecords(sessionId: string): CompactionRecord[] {
        const records = this.cache.compactionRecords.get(sessionId) || [];
        return records.map((item) => clone(item));
    }
}
