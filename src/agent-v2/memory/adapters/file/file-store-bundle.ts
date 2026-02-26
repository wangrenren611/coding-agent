import type { MemoryStoreBundle } from '../../ports/stores';
import { AtomicJsonStore } from './atomic-json';
import { FileCompactionStore } from './repositories/file-compaction-store';
import { FileContextStore } from './repositories/file-context-store';
import { FileHistoryStore } from './repositories/file-history-store';
import { FileSessionStore } from './repositories/file-session-store';
import { FileSubTaskRunStore } from './repositories/file-subtask-run-store';
import { FileTaskStore } from './repositories/file-task-store';

export function createFileStoreBundle(basePath: string): MemoryStoreBundle {
    const io = new AtomicJsonStore();

    return {
        sessions: new FileSessionStore(basePath, io),
        contexts: new FileContextStore(basePath, io),
        histories: new FileHistoryStore(basePath, io),
        compactions: new FileCompactionStore(basePath, io),
        tasks: new FileTaskStore(basePath, io),
        subTaskRuns: new FileSubTaskRunStore(basePath, io),
        close: async () => {
            await io.close();
        },
    };
}
