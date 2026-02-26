import { createStoreBundle } from './adapters/factory';
import { MemoryOrchestrator } from './orchestrator/memory-orchestrator';
import type { MemoryManagerOptions } from './types';

/**
 * Configurable memory manager that composes stores through adapter factory.
 */
export class MemoryManager extends MemoryOrchestrator {
    constructor(options: MemoryManagerOptions) {
        super(createStoreBundle(options));
    }
}
