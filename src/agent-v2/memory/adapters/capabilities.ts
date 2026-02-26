import type { SupportedMemoryManagerType } from '../types';

export type MemoryAdapterCapability =
    | 'atomic_write'
    | 'ttl'
    | 'secondary_index'
    | 'semantic_search'
    | 'tier_routing'
    | 'cross_store_transaction';

export interface MemoryAdapterDescriptor {
    type: SupportedMemoryManagerType;
    capabilities: MemoryAdapterCapability[];
    status: 'ready' | 'planned';
    notes?: string;
}

export const MEMORY_ADAPTER_DESCRIPTORS: Record<SupportedMemoryManagerType, MemoryAdapterDescriptor> = {
    file: {
        type: 'file',
        status: 'ready',
        capabilities: ['atomic_write'],
        notes: 'Current production adapter for local persistence and tests.',
    },
    mysql: {
        type: 'mysql',
        status: 'planned',
        capabilities: ['secondary_index'],
        notes: 'Planned for structured mid-term memory storage.',
    },
    mongodb: {
        type: 'mongodb',
        status: 'ready',
        capabilities: ['secondary_index'],
        notes: 'Document-oriented durable memory storage. Requires MongoDB driver module (default: mongodb).',
    },
    redis: {
        type: 'redis',
        status: 'planned',
        capabilities: ['ttl'],
        notes: 'Planned for short-term hot context/cache state, not durable large history storage.',
    },
    hybrid: {
        type: 'hybrid',
        status: 'ready',
        capabilities: ['tier_routing'],
        notes: 'Composition mode implemented. mysql/redis tier adapters are still planned.',
    },
};
