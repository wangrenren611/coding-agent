import type { IMemoryManager } from '../../memory/types';
import type { Message } from '../../session/types';
import { hasContent } from '../core-types';

const MANAGED_TASK_PARENT_ID = '__task_tool_managed__';

export interface CompletionCheckResult {
    done: boolean;
    blockedByTasks?: {
        inProgressCount: number;
        pendingCount: number;
        taskSignature: string;
    };
    blockedBySubtasks?: {
        queuedCount: number;
        runningCount: number;
        cancellingCount: number;
        taskSignature: string;
    };
}

export interface CompletionCheckParams {
    lastMessage?: Message;
    sessionId: string;
    memoryManager?: IMemoryManager;
}

export async function checkComplete(params: CompletionCheckParams): Promise<CompletionCheckResult> {
    const { lastMessage, sessionId, memoryManager } = params;
    if (!lastMessage) {
        return { done: false };
    }

    let completed = false;
    switch (lastMessage.role) {
        case 'user':
            completed = false;
            break;
        case 'tool':
            completed = false;
            break;
        case 'assistant':
            completed = checkAssistantComplete(lastMessage);
            break;
        default:
            completed = false;
            break;
    }

    if (!completed) {
        return { done: false };
    }

    if (!memoryManager) {
        return { done: true };
    }

    if (memoryManager.waitForInitialization) {
        await memoryManager.waitForInitialization();
    }

    const tasks = await memoryManager.queryTasks({
        sessionId,
        parentTaskId: MANAGED_TASK_PARENT_ID,
    });
    const pendingManagedTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress');

    const subTaskRuns = await memoryManager.querySubTaskRuns({
        parentSessionId: sessionId,
        mode: 'background',
    });
    const pendingSubTaskRuns = subTaskRuns.filter(
        (run) => run.status === 'queued' || run.status === 'running' || run.status === 'cancelling'
    );

    const result: CompletionCheckResult = { done: true };

    if (pendingManagedTasks.length > 0) {
        const taskSignature = pendingManagedTasks
            .slice()
            .sort((a, b) => a.taskId.localeCompare(b.taskId))
            .map((task) => `${task.taskId}:${task.status}`)
            .join('|');
        const inProgressCount = pendingManagedTasks.filter((task) => task.status === 'in_progress').length;
        const pendingCount = pendingManagedTasks.length - inProgressCount;
        result.done = false;
        result.blockedByTasks = {
            inProgressCount,
            pendingCount,
            taskSignature,
        };
    }

    if (pendingSubTaskRuns.length > 0) {
        const taskSignature = pendingSubTaskRuns
            .slice()
            .sort((a, b) => a.runId.localeCompare(b.runId))
            .map((run) => `${run.runId}:${run.status}`)
            .join('|');
        const runningCount = pendingSubTaskRuns.filter((run) => run.status === 'running').length;
        const queuedCount = pendingSubTaskRuns.filter((run) => run.status === 'queued').length;
        const cancellingCount = pendingSubTaskRuns.length - runningCount - queuedCount;
        result.done = false;
        result.blockedBySubtasks = {
            queuedCount,
            runningCount,
            cancellingCount,
            taskSignature,
        };
    }

    return result;
}

function checkAssistantComplete(message: Message): boolean {
    if (message.finish_reason) {
        switch (message.finish_reason) {
            case 'abort':
                return false;
            case 'length': {
                const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
                return hasAssistantOutput(message) && !hasTools;
            }
            case 'tool_calls':
                return false;
            case 'stop': {
                // finish_reason=stop 时，检查是否有实际内容
                const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
                if (hasTools) {
                    return false;
                }
                // 只有 reasoning_content 而没有 content 时，不认为已完成
                const hasOnlyReasoning =
                    !hasContent(message.content) && message.reasoning_content && hasContent(message.reasoning_content);
                if (hasOnlyReasoning) {
                    return false;
                }
                // 没有 content 时认为未完成（需要继续生成）
                if (!hasContent(message.content)) {
                    return false;
                }
                return true;
            }
        }

        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            return false;
        }

        if (isEmptyResponse(message)) {
            return false;
        }

        return true;
    }

    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    // 只有 reasoning_content 而没有 content 时，不认为已完成（需要继续生成）
    const hasOnlyReasoning =
        !hasContent(message.content) && message.reasoning_content && hasContent(message.reasoning_content);
    if (hasOnlyReasoning) {
        return false;
    }
    return message.type === 'text' && hasContent(message.content) && !hasToolCalls;
}

function isEmptyResponse(message: Message): boolean {
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    return message.role === 'assistant' && !hasToolCalls && !hasAssistantOutput(message);
}

function hasAssistantOutput(message: Pick<Message, 'content' | 'reasoning_content'>): boolean {
    return hasContent(message.content);
}
