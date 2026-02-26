# Memory Rearchitecture Technical Design

## 1. Background and Goals

The current memory implementation is centered around a single large class:

- `src/agent-v2/memory/file-memory.ts`

Problems:

- Too many responsibilities in one class (domain rules, storage IO, repair, query, persistence safety).
- Difficult to add a second backend (MySQL/Redis) without large rewrites.
- Hard to support mixed storage topologies (different stores for different memory tiers).
- Tight coupling between storage details and business semantics.

Goals:

- Make memory modular and backend-agnostic.
- Support short-term, mid-term, and long-term memory as first-class concepts.
- Support one or many backend adapters (file/mysql/redis/mongodb/vector) through composition.
- Keep the system easy to maintain and evolve.
- **No backward compatibility requirements for old on-disk formats.**

### Current Implementation Snapshot (2026-02-26)

- Implemented:
  - Layered file adapter (`adapters/file/*`)
  - Store ports (`ports/stores.ts`)
  - Thin orchestrator coordinator + split services (`orchestrator/*`)
  - Adapter factory (`file/mysql/redis/mongodb/hybrid`) with live `hybrid` tier routing
  - MongoDB adapter (`adapters/mongodb/*`) with full store-bundle support
  - `hybrid` practical with mixed tier descriptors where adapter is ready (`file`/`mongodb`)
  - `mysql`/`redis` remain explicit planned stubs with clear runtime failures
- Removed:
  - Legacy task-list migration path when `memoryManager` is enabled
  - Monolithic `file-memory.ts` business+IO implementation

## 2. Non-Goals

- Migrating legacy `.memory` data formats.
- Keeping compatibility with old helper/fallback stores that bypass the new architecture.
- Introducing distributed transactions across heterogeneous databases.

## 3. New Architecture Overview

Layered architecture:

1. `MemoryFacade` (public API for Session/Agent/Tools)
2. `MemoryOrchestrator` (business rules, tier routing, compaction/exclusion semantics)
3. `Store Ports` (interfaces per aggregate/data set)
4. `Store Adapters` (file/mysql/redis/mongodb/vector implementations)
5. `Policy Modules` (retention, compaction, promotion, retrieval ranking)

### 3.1 Directory Layout (Target)

```text
src/agent-v2/memory/
  index.ts
  facade/
    memory-facade.ts
  orchestrator/
    memory-orchestrator.ts
  domain/
    models.ts
    rules.ts
  ports/
    session-store.ts
    context-store.ts
    history-store.ts
    compaction-store.ts
    task-store.ts
    subtask-run-store.ts
  policies/
    retention-policy.ts
    compaction-policy.ts
  adapters/
    file/
      file-adapter.ts
      atomic-json.ts
      filename-codec.ts
      repositories/
        file-session-store.ts
        file-context-store.ts
        file-history-store.ts
        file-compaction-store.ts
        file-task-store.ts
        file-subtask-run-store.ts
```

## 4. Public API Strategy

`Session/Agent/Tool` should depend on one stable interface:

- `IMemoryManager` remains the external contract for now.
- Internally, implementation is delegated to `MemoryOrchestrator`.
- Existing call sites can stay simple while internals become extensible.

Later, a v2 API can be introduced for richer memory tier operations.

## 5. Core Domain Semantics

Domain invariants:

1. A streamed assistant response maps to one logical message (`messageId`) in context/history.
2. History is append/upsert by domain rule, not by storage adapter behavior.
3. Removing from context must preserve history with exclusion markers.
4. Compaction is a domain operation with explicit archived set and summary insertion.
5. Store adapters are dumb persistence components; they do not decide domain behavior.

## 6. Tiered Memory Model

Memory tiers:

- Short-term: active context window, fast mutable state (Redis/file/in-memory).
- Mid-term: structured session/task/fact records (MySQL/file).
- Long-term: semantic/document memory (vector DB + metadata store).

Routing and promotion:

- Orchestrator decides where data lands.
- Policies trigger promotion (e.g. summary/facts move from short -> mid/long).
- Retrieval merges multi-tier results under token budget.

## 7. Extensibility Pattern

Follow providers-style extensibility:

- `MemoryAdapterFactory` creates concrete adapter graph from config.
- `MemoryRegistry` optionally lists supported adapter types/capabilities.
- Adapters advertise capabilities (ttl/filter/semantic/range).
- Orchestrator picks strategy based on capabilities, not concrete classes.

## 8. Consistency and Reliability Model

- No cross-store distributed transaction.
- Use idempotent writes and deterministic IDs.
- Prefer eventual consistency for cross-tier replication/promotion.
- File adapter uses atomic write and backup strategy but only for file concerns.
- Domain-level repair stays in orchestrator/policies, not in repository classes.

## 9. Test Strategy

Test pyramid:

1. Contract tests for store ports (shared test suite for each adapter).
2. Orchestrator tests for domain invariants.
3. Integration tests with Session/Agent/Tool flows.
4. Fault-injection tests for file adapter IO corruption/recovery.

## 10. Migration Strategy (Code, Not Data)

Phase migration:

1. Introduce layered modules and keep external `IMemoryManager` entry.
2. Move logic from monolith into orchestrator + repositories.
3. Keep behavior parity for current tests where desired.
4. Remove legacy-only paths and compatibility branches.
5. Add adapter factory and progressively land backend implementations.

## 11. Risks and Mitigations

- Risk: behavior drift during extraction.
  - Mitigation: contract tests + incremental commits + targeted snapshots.

- Risk: over-abstraction slows delivery.
  - Mitigation: only introduce interfaces required by real use cases now.

- Risk: mixed-backend complexity.
  - Mitigation: explicit capabilities and policy-driven orchestration.

## 12. Definition of Done (Architecture)

- `file-memory.ts` no longer a monolithic rule+storage implementation.
- Business rules live in orchestrator/domain modules.
- File adapter only contains file persistence details.
- Session/Agent/Tool integration uses the new internal architecture.
- Docs and plan remain the source of truth for next iterations.
