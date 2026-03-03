import type { BackgroundTaskStatus } from './shared';

export interface SubtaskStatusEvent {
    parentSessionId: string;
    runId: string;
    status: BackgroundTaskStatus;
    revision: number;
    timestamp: number;
    source: 'runtime';
}

export interface WaitForSubtaskChangeOptions {
    parentSessionId: string;
    sinceRevision: number;
    timeoutMs: number;
    signal?: AbortSignal;
}

export interface WaitForSubtaskChangeResult {
    changed: boolean;
    aborted: boolean;
    revision: number;
    event?: SubtaskStatusEvent;
}

type SessionListener = (event: SubtaskStatusEvent) => void;

const sessionRevisionMap = new Map<string, number>();
const sessionListeners = new Map<string, Set<SessionListener>>();
const sessionTaskStatusMap = new Map<string, Map<string, BackgroundTaskStatus>>();

function getNextRevision(parentSessionId: string): number {
    const next = (sessionRevisionMap.get(parentSessionId) || 0) + 1;
    sessionRevisionMap.set(parentSessionId, next);
    return next;
}

function getOrCreateTaskStatusMap(parentSessionId: string): Map<string, BackgroundTaskStatus> {
    let statusMap = sessionTaskStatusMap.get(parentSessionId);
    if (!statusMap) {
        statusMap = new Map<string, BackgroundTaskStatus>();
        sessionTaskStatusMap.set(parentSessionId, statusMap);
    }
    return statusMap;
}

function addSessionListener(parentSessionId: string, listener: SessionListener): () => void {
    let listeners = sessionListeners.get(parentSessionId);
    if (!listeners) {
        listeners = new Set<SessionListener>();
        sessionListeners.set(parentSessionId, listeners);
    }
    listeners.add(listener);

    return () => {
        const current = sessionListeners.get(parentSessionId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            sessionListeners.delete(parentSessionId);
        }
    };
}

export function getSubtaskNotifierRevision(parentSessionId: string): number {
    return sessionRevisionMap.get(parentSessionId) || 0;
}

/**
 * 发布子任务状态变化事件。
 * 为避免心跳造成噪音，仅在 runId 的状态真正变化时发射事件并推进 revision。
 */
export function notifySubtaskStatus(event: Omit<SubtaskStatusEvent, 'revision' | 'timestamp' | 'source'>): void {
    const statusMap = getOrCreateTaskStatusMap(event.parentSessionId);
    const previousStatus = statusMap.get(event.runId);
    if (previousStatus === event.status) {
        return;
    }
    statusMap.set(event.runId, event.status);

    const revision = getNextRevision(event.parentSessionId);
    const payload: SubtaskStatusEvent = {
        ...event,
        revision,
        timestamp: Date.now(),
        source: 'runtime',
    };

    const listeners = sessionListeners.get(event.parentSessionId);
    if (!listeners || listeners.size === 0) {
        return;
    }
    for (const listener of listeners) {
        listener(payload);
    }
}

/**
 * 等待子任务状态变化。
 * - 优先事件唤醒
 * - timeout 到期后返回 changed=false，供调用方执行兜底轮询
 */
export async function waitForSubtaskChange(options: WaitForSubtaskChangeOptions): Promise<WaitForSubtaskChangeResult> {
    const { parentSessionId, sinceRevision, timeoutMs, signal } = options;
    const currentRevision = getSubtaskNotifierRevision(parentSessionId);
    if (currentRevision > sinceRevision) {
        return {
            changed: true,
            aborted: false,
            revision: currentRevision,
        };
    }

    if (signal?.aborted) {
        return {
            changed: false,
            aborted: true,
            revision: currentRevision,
        };
    }

    return await new Promise<WaitForSubtaskChangeResult>((resolve) => {
        let settled = false;
        const timeoutHandle: NodeJS.Timeout = setTimeout(() => {
            finish({
                changed: false,
                aborted: false,
                revision: getSubtaskNotifierRevision(parentSessionId),
            });
        }, timeoutMs);
        const unsubscribe = addSessionListener(parentSessionId, (event) => {
            finish({
                changed: true,
                aborted: false,
                revision: event.revision,
                event,
            });
        });
        let abortHandler: (() => void) | undefined;

        const finish = (result: WaitForSubtaskChangeResult): void => {
            if (settled) return;
            settled = true;

            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
            if (unsubscribe) {
                unsubscribe();
            }
            if (signal && abortHandler) {
                signal.removeEventListener('abort', abortHandler);
            }
            resolve(result);
        };

        const refreshedRevision = getSubtaskNotifierRevision(parentSessionId);
        if (refreshedRevision > sinceRevision) {
            finish({
                changed: true,
                aborted: false,
                revision: refreshedRevision,
            });
            return;
        }

        if (signal) {
            abortHandler = () => {
                finish({
                    changed: false,
                    aborted: true,
                    revision: getSubtaskNotifierRevision(parentSessionId),
                });
            };
            signal.addEventListener('abort', abortHandler, { once: true });
        }
    });
}

export function clearSubtaskNotifierState(parentSessionId?: string): void {
    if (!parentSessionId) {
        sessionRevisionMap.clear();
        sessionListeners.clear();
        sessionTaskStatusMap.clear();
        return;
    }

    sessionRevisionMap.delete(parentSessionId);
    sessionListeners.delete(parentSessionId);
    sessionTaskStatusMap.delete(parentSessionId);
}
