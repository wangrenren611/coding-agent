import { clone, paginate, sortByTimestamp } from '../domain/helpers';
import type { MemoryStoreBundle } from '../ports/stores';
import type { QueryOptions, SubTaskRunData, SubTaskRunFilter } from '../types';
import { normalizeSubTaskRun, type MemoryCache } from './state';

export class SubTaskRunService {
    constructor(
        private readonly cache: MemoryCache,
        private readonly stores: MemoryStoreBundle
    ) {}

    async saveSubTaskRun(run: Omit<SubTaskRunData, 'createdAt' | 'updatedAt'>): Promise<void> {
        const now = Date.now();
        const existing = this.cache.subTaskRuns.get(run.runId);
        const normalized = normalizeSubTaskRun(run as SubTaskRunData);

        const runData: SubTaskRunData = {
            ...normalized,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        this.cache.subTaskRuns.set(run.runId, runData);
        await this.stores.subTaskRuns.save(run.runId, runData);
    }

    getSubTaskRun(runId: string): SubTaskRunData | null {
        const run = this.cache.subTaskRuns.get(runId);
        return run ? clone(run) : null;
    }

    querySubTaskRuns(filter?: SubTaskRunFilter, options?: QueryOptions): SubTaskRunData[] {
        let runs = Array.from(this.cache.subTaskRuns.values());

        if (filter) {
            if (filter.runId) {
                runs = runs.filter((item) => item.runId === filter.runId);
            }
            if (filter.parentSessionId) {
                runs = runs.filter((item) => item.parentSessionId === filter.parentSessionId);
            }
            if (filter.childSessionId) {
                runs = runs.filter((item) => item.childSessionId === filter.childSessionId);
            }
            if (filter.status) {
                runs = runs.filter((item) => item.status === filter.status);
            }
            if (filter.mode) {
                runs = runs.filter((item) => item.mode === filter.mode);
            }
        }

        return paginate(sortByTimestamp(runs, options), options).map((item) => clone(item));
    }

    async deleteSubTaskRun(runId: string): Promise<void> {
        this.cache.subTaskRuns.delete(runId);
        await this.stores.subTaskRuns.delete(runId);
    }
}
