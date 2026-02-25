---
name: example-skill
description: An example skill demonstrating the skill system capabilities
version: 1.0.0
author: Agent Team
---

# Example Skill

This is an example skill that demonstrates how to create and use skills in the agent system.

## Overview

Skills provide specialized knowledge and step-by-step guidance for specific tasks. They are loaded progressively to minimize context usage.

## Usage

1. Identify when a task matches the skill's description
2. Call the `skill` tool with the skill name
3. Follow the instructions provided

## Best Practices

- Keep skill descriptions concise (max 1024 characters)
- Use valid skill names (lowercase, numbers, hyphens)
- Include file references like @src/utils.ts for context
- Use shell command notation !`npm test` for commands

## Example Code

See @src/agent-v2/skill/index.ts for the main module exports.

## Testing

Run !`npm run test:run -- src/agent-v2/skill/` to execute skill module tests.
