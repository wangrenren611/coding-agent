import { buildSubTaskRunData, saveSubTaskRunRecord } from './subtask-run-store';
import {
    BACKGROUND_HEARTBEAT_INTERVAL_MS,
    BACKGROUND_HEARTBEAT_PERSIST_INTERVAL_MS,
    BackgroundExecution,
    getMessageCount,
    normalizeMessagesForStorage,
    nowIso,
    nowMs,
    pickLastToolName,
} from './shared';

const backgroundExecutions = new Map<string, BackgroundExecution>();

export function getBackgroundExecution(taskId: string): BackgroundExecution | undefined {
    return backgroundExecutions.get(taskId);
}

export function setBackgroundExecution(taskId: string, execution: BackgroundExecution): void {
    backgroundExecutions.set(taskId, execution);
}

export async function waitWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
): Promise<{ timedOut: boolean; value?: T }> {
    let timer: NodeJS.Timeout | null = null;
    try {
        const timeoutPromise = new Promise<{ timedOut: boolean }>((resolve) => {
            timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
        });
        const valuePromise = promise.then((value) => ({ timedOut: false, value }));
        return await Promise.race([valuePromise, timeoutPromise]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function persistExecutionSnapshot(execution: BackgroundExecution): Promise<void> {
    execution.storage = await saveSubTaskRunRecord(
        execution.memoryManager,
        buildSubTaskRunData({
            runId: execution.taskId,
            parentSessionId: execution.parentSessionId,
            childSessionId: execution.childSessionId,
            mode: 'background',
            status: execution.status,
            createdAt: execution.createdAt,
            startedAt: execution.startedAt,
            finishedAt: execution.finishedAt,
            lastActivityAt: execution.lastActivityAt,
            lastToolName: execution.lastToolName,
            description: execution.description,
            prompt: execution.prompt,
            subagentType: execution.subagentType,
            model: execution.model,
            resume: execution.resume,
            turns: execution.turns,
            toolsUsed: execution.toolsUsed,
            output: execution.output,
            error: execution.error,
            messageCount: getMessageCount(execution.messages),
        })
    );
}

export async function refreshExecutionProgress(execution: BackgroundExecution, forcePersist = false): Promise<void> {
    if (!execution.agent) return;
    if (execution.status !== 'running' && execution.status !== 'cancelling') return;

    const snapshot = normalizeMessagesForStorage(execution.agent.getMessages());
    const messageCount = getMessageCount(snapshot);
    const nextLastTool = pickLastToolName(snapshot);
    const previousCount = getMessageCount(execution.messages);
    const changed = messageCount !== previousCount || nextLastTool !== execution.lastToolName;
    if (!changed && !forcePersist) return;

    execution.messages = snapshot;
    if (changed) {
        execution.lastActivityAt = nowIso();
        execution.lastToolName = nextLastTool;
    }

    const now = nowMs();
    const shouldPersist =
        forcePersist ||
        (changed &&
            (!execution.lastHeartbeatPersistAt ||
                now - execution.lastHeartbeatPersistAt >= BACKGROUND_HEARTBEAT_PERSIST_INTERVAL_MS));
    if (!shouldPersist) return;

    execution.lastHeartbeatPersistAt = now;
    execution.lastPersistedMessageCount = messageCount;
    await persistExecutionSnapshot(execution);
}

export function startExecutionHeartbeat(execution: BackgroundExecution): void {
    stopExecutionHeartbeat(execution);
    execution.heartbeatTimer = setInterval(() => {
        void refreshExecutionProgress(execution).catch(() => undefined);
    }, BACKGROUND_HEARTBEAT_INTERVAL_MS);
}

export function stopExecutionHeartbeat(execution: BackgroundExecution): void {
    if (!execution.heartbeatTimer) return;
    clearInterval(execution.heartbeatTimer);
    execution.heartbeatTimer = undefined;
}

export function clearBackgroundExecutions(sessionId?: string): void {
    for (const [taskId, execution] of backgroundExecutions.entries()) {
        if (
            sessionId &&
            execution.parentSessionId !== sessionId &&
            execution.childSessionId !== sessionId &&
            !execution.childSessionId.startsWith(`${sessionId}::subtask::`)
        ) {
            continue;
        }

        stopExecutionHeartbeat(execution);
        if (execution.status === 'queued' || execution.status === 'running' || execution.status === 'cancelling') {
            execution.stopRequested = true;
            execution.agent?.abort();
            execution.status = 'cancelled';
            execution.finishedAt = nowIso();
            execution.error = 'TASK_CANCELLED';
            execution.output = execution.output || 'Task cancelled by cleanup.';
        }
        backgroundExecutions.delete(taskId);
    }
}
