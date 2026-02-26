import type { MemoryStoreBundle } from '../../ports/stores';
import type { HybridMemoryConfig, MemoryBackendDescriptor, MemoryManagerOptions } from '../../types';
import { buildTierDefaultPath, createBundleFromDescriptor, resolveHybridBaseRoot } from '../builders';

function buildTierDescriptor(
    config: HybridMemoryConfig | undefined,
    tier: 'shortTerm' | 'midTerm' | 'longTerm',
    fallback: MemoryBackendDescriptor
): MemoryBackendDescriptor {
    return config?.[tier] || fallback;
}

function uniqueBundles(bundles: MemoryStoreBundle[]): MemoryStoreBundle[] {
    const seen = new Set<MemoryStoreBundle>();
    const unique: MemoryStoreBundle[] = [];
    for (const bundle of bundles) {
        if (seen.has(bundle)) continue;
        seen.add(bundle);
        unique.push(bundle);
    }
    return unique;
}

export function createHybridStoreBundle(options: MemoryManagerOptions): MemoryStoreBundle {
    const rootBasePath = resolveHybridBaseRoot(options);
    const hybridConfig = options.config?.hybrid;

    const shortTermDescriptor = buildTierDescriptor(hybridConfig, 'shortTerm', {
        type: 'file',
        connectionString: buildTierDefaultPath(rootBasePath, 'short-term'),
    });
    const midTermDescriptor = buildTierDescriptor(hybridConfig, 'midTerm', {
        type: 'file',
        connectionString: buildTierDefaultPath(rootBasePath, 'mid-term'),
    });
    const longTermDescriptor = buildTierDescriptor(hybridConfig, 'longTerm', {
        type: 'file',
        connectionString: buildTierDefaultPath(rootBasePath, 'long-term'),
    });

    const shortBundle = createBundleFromDescriptor(
        shortTermDescriptor,
        buildTierDefaultPath(rootBasePath, 'short-term')
    );
    const midBundle = createBundleFromDescriptor(midTermDescriptor, buildTierDefaultPath(rootBasePath, 'mid-term'));
    const longBundle = createBundleFromDescriptor(longTermDescriptor, buildTierDefaultPath(rootBasePath, 'long-term'));

    const bundlesToClose = uniqueBundles([shortBundle, midBundle, longBundle]);

    return {
        // Durable state should not rely on short-term stores (e.g., redis).
        sessions: midBundle.sessions,
        contexts: shortBundle.contexts,
        histories: midBundle.histories,
        compactions: midBundle.compactions,
        tasks: midBundle.tasks,
        subTaskRuns: midBundle.subTaskRuns,
        close: async () => {
            await Promise.all(bundlesToClose.map((bundle) => bundle.close()));
        },
    };
}
