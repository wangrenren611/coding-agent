import { v4 as uuid } from 'uuid';
import type { Message } from '../../session/types';
import { clone } from '../domain/helpers';
import type { MemoryStoreBundle } from '../ports/stores';
import type { CurrentContext, HistoryMessage } from '../types';
import { normalizeSubTaskRun } from './state';
import type { MemoryCache } from './state';

export async function prepareStores(stores: MemoryStoreBundle): Promise<void> {
    await Promise.all([
        stores.sessions.prepare(),
        stores.contexts.prepare(),
        stores.histories.prepare(),
        stores.compactions.prepare(),
        stores.tasks.prepare(),
        stores.subTaskRuns.prepare(),
    ]);
}

export async function loadAndRepairCache(cache: MemoryCache, stores: MemoryStoreBundle): Promise<void> {
    cache.sessions = await stores.sessions.loadAll();
    cache.contexts = await stores.contexts.loadAll();
    cache.histories = await stores.histories.loadAll();
    cache.compactionRecords = await stores.compactions.loadAll();
    cache.tasks = await stores.tasks.loadAll();

    const loadedRuns = await stores.subTaskRuns.loadAll();
    cache.subTaskRuns.clear();
    for (const [runId, run] of loadedRuns.entries()) {
        cache.subTaskRuns.set(runId, normalizeSubTaskRun(run));
    }

    await repairLoadedData(cache, stores);
}

async function repairLoadedData(cache: MemoryCache, stores: MemoryStoreBundle): Promise<void> {
    const writeBackJobs: Promise<void>[] = [];

    for (const [sessionId, session] of cache.sessions.entries()) {
        if (!cache.contexts.has(sessionId)) {
            const now = Date.now();
            const repairedContextId = session.currentContextId || uuid();
            const history = cache.histories.get(sessionId) || [];
            const activeMessages: Message[] = history
                .filter((item) => !item.archivedBy && !item.excludedFromContext)
                .map((item) => {
                    const { sequence, turn, isSummary, archivedBy, excludedFromContext, excludedReason, ...message } =
                        item;
                    void sequence;
                    void turn;
                    void isSummary;
                    void archivedBy;
                    void excludedFromContext;
                    void excludedReason;
                    return clone(message);
                });

            const systemMessage: Message = {
                messageId: 'system',
                role: 'system',
                content: session.systemPrompt,
            };

            const repairedMessages = activeMessages.length > 0 ? activeMessages : [systemMessage];
            if (!repairedMessages.some((item) => item.role === 'system')) {
                repairedMessages.unshift(systemMessage);
            }

            const repairedContext: CurrentContext = {
                id: repairedContextId,
                contextId: repairedContextId,
                sessionId,
                systemPrompt: session.systemPrompt,
                messages: repairedMessages,
                version: 1,
                createdAt: now,
                updatedAt: now,
                stats: {
                    totalMessagesInHistory: history.length || repairedMessages.length,
                    compactionCount: session.compactionCount,
                },
            };

            cache.contexts.set(sessionId, repairedContext);
            session.currentContextId = repairedContextId;
            if (history.length > 0) {
                session.totalMessages = history.length;
            }

            writeBackJobs.push(stores.contexts.save(sessionId, repairedContext));
            writeBackJobs.push(stores.sessions.save(sessionId, session));
        }

        if (!cache.histories.has(sessionId)) {
            const context = cache.contexts.get(sessionId);
            const repairedHistory: HistoryMessage[] = (context?.messages || []).map((message, index) => ({
                ...clone(message),
                sequence: index + 1,
                turn: index === 0 && message.role === 'system' ? 0 : undefined,
            }));

            cache.histories.set(sessionId, repairedHistory);
            session.totalMessages = repairedHistory.length;
            session.updatedAt = Date.now();

            writeBackJobs.push(stores.histories.save(sessionId, repairedHistory));
            writeBackJobs.push(stores.sessions.save(sessionId, session));
        }

        if (!cache.compactionRecords.has(sessionId)) {
            cache.compactionRecords.set(sessionId, []);
            writeBackJobs.push(stores.compactions.save(sessionId, []));
        }
    }

    if (writeBackJobs.length > 0) {
        await Promise.all(writeBackJobs);
    }
}
