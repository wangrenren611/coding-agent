# Orchestration V2

## Design goals

- Keep orchestration code simple and deterministic.
- Let LLM own high-entropy decisions (task decomposition, role prompt shaping, final summary).
- Keep code responsible for reliability: schema validation, timeout, retry, dependency scheduling, and event logging.

## Core flow

1. `controller` receives goal and outputs strict JSON plan.
2. Plan is schema-validated and DAG-validated.
3. Kernel schedules tasks by dependencies with bounded concurrency.
4. Role->agent resolution prefers template agents; missing roles are created dynamically.
5. Agent-to-agent messaging is available via tools:
    - `agent_send_message`
    - `agent_receive_messages`
    - `agent_ack_messages`
    - `agent_nack_message`
    - `agent_list_dead_letters`
6. Failures are retried with limits; terminal outputs are summarized by controller.

## Prompt system

- Build role-aware prompts from `buildSystemPrompt` baseline:
    - `buildControllerPrompt(...)`
    - `buildWorkerPrompt('frontend-coder' | 'backend-coder' | 'reviewer', ...)`
    - `buildDynamicRolePrompt(...)`
- Prompts include:
    - role-specific responsibilities and output contracts
    - inter-agent messaging tool usage (`agent_send_message`, `agent_receive_messages`, ...)
    - anti-hallucination and verifiability constraints

## Why this is practical

- Flexible under uncertainty: LLM can reshape the plan without code change.
- Operationally safe: invalid plan / timeout / failed tasks are captured by kernel guards.
- Evolvable: runtime protocol is minimal (`execute/abort/stream/status` + agent profile registry).
