import type { MemoryStoreBundle } from '../ports/stores';
import type { MemoryManagerOptions, SupportedMemoryManagerType } from '../types';
import { createBundleFromDescriptor, resolveFileBasePath } from './builders';
import { createHybridStoreBundle } from './hybrid/hybrid-store-bundle';
import { createUnsupportedStoreBundle } from './unsupported-store-bundle';
import { createMongoStoreBundle } from './mongodb/mongo-store-bundle';

export function isSupportedMemoryManagerType(type: string): type is SupportedMemoryManagerType {
    return type === 'file' || type === 'mysql' || type === 'redis' || type === 'mongodb' || type === 'hybrid';
}

export function createStoreBundle(options: MemoryManagerOptions): MemoryStoreBundle {
    switch (options.type) {
        case 'file': {
            return createBundleFromDescriptor(
                {
                    type: 'file',
                    connectionString: options.connectionString,
                    config: options.config,
                },
                resolveFileBasePath(options)
            );
        }
        case 'mysql':
        case 'redis':
            return createUnsupportedStoreBundle(options);
        case 'mongodb':
            return createMongoStoreBundle(options);
        case 'hybrid':
            return createHybridStoreBundle(options);
        default:
            throw new Error(`Unsupported memory manager type: ${options.type}`);
    }
}
