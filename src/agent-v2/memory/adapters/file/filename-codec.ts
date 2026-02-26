export function encodeEntityFileName(id: string): string {
    return `${encodeURIComponent(id)}.json`;
}

export function decodeEntityFileName(fileName: string): string {
    return decodeURIComponent(fileName.replace(/\.json$/, ''));
}

export function safeDecodeEntityFileName(fileName: string): string | null {
    try {
        return decodeEntityFileName(fileName);
    } catch (error) {
        console.error(`Skipping invalid entity filename: ${fileName}`, error);
        return null;
    }
}

export function encodeTaskListFileName(sessionId: string): string {
    return `task-list-${encodeURIComponent(sessionId)}.json`;
}

export function decodeTaskListFileName(fileName: string): string {
    return decodeURIComponent(fileName.replace(/^task-list-/, '').replace(/\.json$/, ''));
}

export function safeDecodeTaskListFileName(fileName: string): string | null {
    try {
        return decodeTaskListFileName(fileName);
    } catch (error) {
        console.error(`Skipping invalid task-list filename: ${fileName}`, error);
        return null;
    }
}

export function encodeSubTaskRunFileName(runId: string): string {
    return `subtask-run-${encodeURIComponent(runId)}.json`;
}

export function decodeSubTaskRunFileName(fileName: string): string {
    return decodeURIComponent(fileName.replace(/^subtask-run-/, '').replace(/\.json$/, ''));
}

export function safeDecodeSubTaskRunFileName(fileName: string): string | null {
    try {
        return decodeSubTaskRunFileName(fileName);
    } catch (error) {
        console.error(`Skipping invalid subtask-run filename: ${fileName}`, error);
        return null;
    }
}
