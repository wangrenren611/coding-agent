import * as path from 'node:path';
import type { MemoryStoreBundle } from '../ports/stores';
import type { MemoryBackendDescriptor, MemoryManagerOptions } from '../types';
import { createFileStoreBundle } from './file/file-store-bundle';
import { createUnsupportedStoreBundle } from './unsupported-store-bundle';
import { createMongoStoreBundle } from './mongodb/mongo-store-bundle';

function normalizeFileBasePath(descriptor: MemoryBackendDescriptor, defaultBasePath: string): string {
    const configBasePath =
        descriptor.config && typeof descriptor.config.basePath === 'string'
            ? (descriptor.config.basePath as string)
            : undefined;
    return configBasePath || descriptor.connectionString || defaultBasePath;
}

export function createBundleFromDescriptor(
    descriptor: MemoryBackendDescriptor,
    defaultFileBasePath: string
): MemoryStoreBundle {
    switch (descriptor.type) {
        case 'file':
            return createFileStoreBundle(normalizeFileBasePath(descriptor, defaultFileBasePath));
        case 'mysql':
        case 'redis':
            return createUnsupportedStoreBundle({
                type: descriptor.type,
                connectionString: descriptor.connectionString,
                config: descriptor.config,
            });
        case 'mongodb':
            return createMongoStoreBundle({
                type: 'mongodb',
                connectionString: descriptor.connectionString,
                config: descriptor.config,
            });
        default:
            return createUnsupportedStoreBundle({
                type: descriptor.type,
                connectionString: descriptor.connectionString,
                config: descriptor.config,
            });
    }
}

export function resolveFileBasePath(options: MemoryManagerOptions): string {
    const config = options.config as { basePath?: unknown } | undefined;
    const configBasePath = typeof config?.basePath === 'string' ? config.basePath : undefined;
    return configBasePath || options.connectionString || '.memory';
}

export function resolveHybridBaseRoot(options: MemoryManagerOptions): string {
    return resolveFileBasePath(options);
}

export function buildTierDefaultPath(rootBasePath: string, tier: 'short-term' | 'mid-term' | 'long-term'): string {
    return path.join(rootBasePath, tier);
}
