import type { IMemoryManager, SubTaskRunData } from '../../memory/types';
import { BackgroundTaskStatus, ModelHint, SubagentType, nowMs, toRunTimestamps } from './shared';

const subTaskRunFallbackStore = new Map<string, SubTaskRunData>();

export function buildSubTaskRunData(params: {
    runId: string;
    parentSessionId: string;
    childSessionId: string;
    mode: 'foreground' | 'background';
    status: BackgroundTaskStatus;
    createdAt: string;
    startedAt: string;
    finishedAt?: string;
    lastActivityAt?: string;
    lastToolName?: string;
    description: string;
    prompt: string;
    subagentType: SubagentType;
    model?: ModelHint;
    resume?: string;
    turns?: number;
    toolsUsed: string[];
    output?: string;
    error?: string;
    messageCount?: number;
}): Omit<SubTaskRunData, 'createdAt' | 'updatedAt'> {
    const { startedAt, finishedAt } = toRunTimestamps(params.createdAt, params.startedAt, params.finishedAt);

    return {
        id: params.runId,
        runId: params.runId,
        parentSessionId: params.parentSessionId,
        childSessionId: params.childSessionId,
        mode: params.mode,
        status: params.status,
        description: params.description,
        prompt: params.prompt,
        subagentType: params.subagentType,
        model: params.model,
        resume: params.resume,
        startedAt,
        ...(finishedAt !== undefined ? { finishedAt } : {}),
        ...(params.lastActivityAt ? { lastActivityAt: new Date(params.lastActivityAt).getTime() } : {}),
        ...(params.lastToolName ? { lastToolName: params.lastToolName } : {}),
        turns: params.turns,
        toolsUsed: params.toolsUsed,
        output: params.output,
        error: params.error,
        messageCount: params.messageCount,
        metadata: {
            createdAtIso: params.createdAt,
            startedAtIso: params.startedAt,
            ...(params.finishedAt ? { finishedAtIso: params.finishedAt } : {}),
        },
    };
}

export async function saveSubTaskRunRecord(
    memoryManager: IMemoryManager | undefined,
    run: Omit<SubTaskRunData, 'createdAt' | 'updatedAt'>
): Promise<'memory_manager' | 'memory_fallback'> {
    if (memoryManager) {
        await memoryManager.saveSubTaskRun(run);
        return 'memory_manager';
    }

    const existing = subTaskRunFallbackStore.get(run.runId);
    const now = nowMs();
    subTaskRunFallbackStore.set(run.runId, {
        ...run,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
    return 'memory_fallback';
}

export async function getSubTaskRunRecord(
    memoryManager: IMemoryManager | undefined,
    runId: string
): Promise<SubTaskRunData | null> {
    if (memoryManager) {
        return memoryManager.getSubTaskRun(runId);
    }
    return subTaskRunFallbackStore.get(runId) || null;
}

export function clearSubTaskRunFallbackStore(sessionId?: string): void {
    if (!sessionId) {
        subTaskRunFallbackStore.clear();
        return;
    }

    for (const [runId, run] of subTaskRunFallbackStore.entries()) {
        if (
            run.parentSessionId === sessionId ||
            run.childSessionId === sessionId ||
            run.childSessionId.startsWith(`${sessionId}::subtask::`)
        ) {
            subTaskRunFallbackStore.delete(runId);
        }
    }
}
