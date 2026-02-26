# Memory Rearchitecture Implementation Plan

## Usage

This file is the execution checklist for the memory refactor.  
If context is lost, resume work from the first unchecked item.

Status legend:

- `[ ]` pending
- `[~]` in progress
- `[x]` completed

---

## Phase 0: Baseline and Scope

- [x] Confirm branch strategy (`codex/*` branch for isolated refactor).
- [x] Freeze target scope: no legacy data-format compatibility.
- [x] Define architecture and layering in technical design doc.

Deliverables:

- `docs/memory-rearchitecture/TECHNICAL_DESIGN.md`
- `docs/memory-rearchitecture/IMPLEMENTATION_PLAN.md`

---

## Phase 1: Extract Core Building Blocks

- [x] Create `domain/` with core model helpers and invariants.
- [x] Create `ports/` store interfaces split by aggregate.
- [x] Create file adapter utility modules (`atomic-json`, filename codec, shared IO queue).
- [x] Create file repository modules per aggregate:
  - sessions
  - contexts
  - histories
  - compactions
  - tasks
  - subtask-runs

Acceptance criteria:

- No behavior logic in repository classes beyond persistence mapping.
- Utilities have focused unit tests.

---

## Phase 2: Orchestrator and Facade

- [x] Implement `MemoryOrchestrator` for domain operations:
  - create/load session
  - add/update/remove message
  - compact context/history
  - query/list operations
- [x] Implement `MemoryFacade` that satisfies `IMemoryManager`.
- [x] Replace old monolithic internals with orchestrator delegation.

Acceptance criteria:

- `IMemoryManager` behavior preserved where still expected by agent/session tests.
- Domain rules are centralized in orchestrator.

---

## Phase 3: Integrate with Session/Agent/Tool

- [x] Update session layer to use refactored memory implementation entry points.
- [x] Update task/subtask stores to align with new memory write/query semantics.
- [x] Remove obsolete compatibility branches and fallback logic not required anymore.

Acceptance criteria:

- Session persistence + compaction + repair flows work end-to-end.
- Task/subtask persistence flows work end-to-end.

---

## Phase 4: Adapter Readiness for Multi-Backend

- [x] Add `MemoryAdapterFactory` skeleton and configuration schema.
- [x] Add adapter capability declarations.
- [x] Add placeholders/stubs for `mysql` and `redis` adapters (no full impl required yet).
- [x] Implement MongoDB adapter with runtime driver loading and tests.
- [x] Add mixed-topology configuration examples in docs.

Acceptance criteria:

- New adapter types can be wired without changing orchestrator core.

---

## Phase 5: Testing and Hardening

- [x] Add contract tests for memory store ports.
- [x] Re-run existing memory/session/tool tests and fix regressions.
- [x] Add tests for compaction invariants and exclusion semantics in new architecture.
- [x] Add corruption/recovery tests for file adapter utilities.

Acceptance criteria:

- Target test suites pass.
- No monolithic file > 500 lines for core memory implementation units.

---

## Phase 6: Cleanup

- [x] Remove dead code paths from old file-memory monolith.
- [x] Ensure docs reflect final module structure and extension points.
- [x] Prepare PR summary with architecture rationale and migration notes.

Acceptance criteria:

- Refactor is maintainable and ready for future short/mid/long memory growth.

---

## Current Execution Log

- 2026-02-26: Phase 0 completed (docs created, architecture baseline set).
- 2026-02-26: Phase 1 completed (ports + file adapter + repositories extracted).
- 2026-02-26: Phase 2 completed (orchestrator introduced; monolithic `file-memory.ts` replaced by composition root).
- 2026-02-26: Phase 3 partially completed (integration stayed stable via `IMemoryManager`; no callsite changes required).
- 2026-02-26: Validation passed (`pnpm typecheck`, memory/session/compaction targeted tests).
- 2026-02-26: Removed managed-task legacy migration path (`task-list.json` -> memory manager), updated tests to strict non-legacy behavior.
- 2026-02-26: Added adapter factory and non-file backend stubs (`mysql`, `redis`, `mongodb`, `hybrid`) with explicit not-implemented failures.
- 2026-02-26: Added adapter capability descriptors and hybrid configuration examples doc.
- 2026-02-26: Split orchestrator into dedicated modules (`bootstrap`, `session-context-service`, `task-service`, `subtask-run-service`) and reduced `memory-orchestrator.ts` to thin coordinator.
- 2026-02-26: Re-validated with `pnpm typecheck` and targeted memory/session/compaction/task test suites.
- 2026-02-26: Added store-port contract test (`file-store-bundle.contract.test.ts`).
- 2026-02-26: Added file adapter utility reliability tests (`atomic-json.test.ts`).
- 2026-02-26: Added PR summary (`PR_SUMMARY.md`) with architecture rationale and follow-up roadmap.
- 2026-02-26: Implemented live `hybrid` store bundle routing for tiered backends (short-term hot contexts, mid-term durable conversation/task metadata).
- 2026-02-26: Added hybrid persistence test proving cross-tier file routing behavior.
- 2026-02-26: Full targeted validation passed (44 tests across memory/session/compaction/task/adapter suites + typecheck).
- 2026-02-26: Added adapter factory tests and hybrid store bundle contract tests.
- 2026-02-26: Re-validated expanded targeted suite (48 tests + typecheck), all green.
- 2026-02-26: Adjusted hybrid routing to practical storage policy: short-term only for hot contexts; durable sessions/histories/tasks/compactions/subtask runs routed to mid-term.
- 2026-02-26: Implemented MongoDB store bundle (sessions/contexts/histories/compactions/tasks/subtask-runs) with runtime module loading.
- 2026-02-26: Added MongoDB persistence test using injected fake driver module and updated factory tests for ready-state behavior.
