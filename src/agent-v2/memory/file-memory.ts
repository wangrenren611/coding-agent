import { MemoryManager } from './memory-manager';
import type { MemoryManagerOptions } from './types';

interface FileStorageConfig {
    basePath: string;
}

/**
 * File-backed MemoryManager.
 *
 * Responsibilities:
 * - Resolve file storage configuration.
 * - Compose file store adapters.
 * - Delegate all memory domain behavior to MemoryOrchestrator.
 */
export class FileMemoryManager extends MemoryManager {
    readonly basePath: string;

    constructor(options: MemoryManagerOptions) {
        const config = resolveConfig(options);
        super({
            ...options,
            type: 'file',
            connectionString: options.connectionString ?? config.basePath,
            config: {
                ...(options.config || {}),
                basePath: config.basePath,
            },
        });
        this.basePath = config.basePath;
    }
}

function resolveConfig(options: MemoryManagerOptions): FileStorageConfig {
    const config = options.config as { basePath?: unknown } | undefined;
    const configBasePath = typeof config?.basePath === 'string' ? config.basePath : undefined;

    return {
        basePath: configBasePath || options.connectionString || '.memory',
    };
}
