# Agent v2 Architecture

This document describes the intended structure of `agent-v2` and the boundaries between modules.

## Module Boundaries

- `agent/`
  - Orchestrates one task lifecycle.
  - Owns retry loop, stream handling, tool execution workflow, and status events.
  - Delegates conversation state to `session/`.
- `session/`
  - Owns in-memory conversation state.
  - Handles message upsert semantics for streaming updates.
  - Coordinates persistence through `memory/`.
  - Optional context compaction via `session/compaction.ts`.
- `memory/`
  - Persistence abstraction (`IMemoryManager`) and concrete implementations.
  - `FileMemoryManager` stores session/context/history/task records.
  - Guarantees context/history consistency for message add/update.
- `tool/`
  - Tool contract, registry, execution, and built-in tool implementations.
- `eventbus/`
  - Internal event dispatch primitives.
- `prompts/`
  - Prompt templates and operator policy.

## Runtime Data Flow

1. `Agent.execute(query)` validates input and initializes `Session`.
2. User message is appended to session.
3. Agent loop calls provider with session messages.
4. Stream or normal response is converted to session message updates.
5. Tool calls (if any) are executed and tool-result messages are appended.
6. `Session` persists add/update operations sequentially to avoid races.
7. On task completion/failure, `Agent` forces a final `session.sync()`.

## Key Invariants

- A streamed assistant response should map to one logical message (`messageId`) in context/history.
- Message updates must not create duplicated history rows for the same logical message.
- Session persistence operations must be ordered.
- Compaction should be explicit and configurable, with provider dependency enforced.

## Practical Extension Rules

- Add orchestration behavior in `agent/`, not in `memory/`.
- Add storage behavior in `memory/`, not in `agent/`.
- Keep `Session` focused on state transitions and persistence coordination.
- Prefer adding small helpers over introducing new framework layers.

