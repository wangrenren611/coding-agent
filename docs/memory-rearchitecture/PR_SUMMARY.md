# Memory Rearchitecture PR Summary

## Branch

- `codex/memory-rearchitecture`

## Objective

Refactor `agent-v2/memory` from a monolithic file-based implementation to a layered, extensible architecture that supports future multi-backend and hybrid memory strategies.

## Key Changes

1. Split monolithic implementation into layers:
   - `ports/` for store contracts
   - `adapters/file/` for persistence implementation details
   - `orchestrator/` for domain behavior and coordination
   - `domain/` for shared behavior helpers

2. Replaced old monolithic `file-memory.ts` internals with composition:
   - `FileMemoryManager` is now a thin composition root.
   - `MemoryOrchestrator` is now a coordinator that delegates to focused services.

3. Added adapter factory and future-ready backend types:
   - Added `file/mysql/redis/mongodb/hybrid` type routing in factory.
   - `hybrid` now has live tier routing composition.
   - `mongodb` backend is implemented with runtime driver loading.
   - `mysql`/`redis` backends currently fail explicitly with clear "not implemented" messages.

4. Removed legacy compatibility behavior:
   - Removed managed-task legacy file migration when `memoryManager` is enabled.
   - Updated tests to assert strict non-legacy behavior.

5. Added explicit backend capability metadata:
   - `MEMORY_ADAPTER_DESCRIPTORS` for extension planning and feature visibility.

6. Added architecture docs and implementation runbook:
   - `TECHNICAL_DESIGN.md`
   - `IMPLEMENTATION_PLAN.md`
   - `HYBRID_CONFIG_EXAMPLES.md`

## Testing

Validated with:

- `pnpm typecheck`
- Memory/session/compaction/task integration tests
- File adapter contract and atomic-IO reliability tests
- Adapter factory tests and hybrid routing contract tests

## Remaining Follow-ups

1. Implement real `mysql` adapter.
2. Implement real `redis` adapter.
3. Extend `hybrid` with long-term routing and optional dual-write/cache policies.
4. Add integration tests against a real MongoDB instance in CI (in addition to mocked driver tests).
5. Expand contract suite to shared adapter test harness used by all backends.

## Hybrid Routing Note

Current hybrid routing behavior:

- `short-term` tier stores: `contexts` (hot working set only)
- `mid-term` tier stores: `sessions`, `histories`, `compactions`, `tasks`, `subtask-runs`
- `long-term` tier descriptor is accepted for future expansion but not yet consumed by current `IMemoryManager` operations.
- Redis design principle: keep Redis in short-term/cache roles; avoid using it as the primary store for large durable history datasets.
