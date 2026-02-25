/**
 * Test utilities for skill module tests
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Test environment for skill tests
 */
export class SkillTestEnvironment {
    private tempDir!: string;

    constructor(private prefix: string = 'skill-test') {}

    /**
     * Setup test environment
     */
    async setup(): Promise<void> {
        this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${this.prefix}-`));
    }

    /**
     * Cleanup test environment
     */
    async teardown(): Promise<void> {
        try {
            await fs.rm(this.tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    }

    /**
     * Get temp directory path
     */
    getTempDir(): string {
        return this.tempDir;
    }

    /**
     * Create a skill directory with SKILL.md
     */
    async createSkill(name: string, content: string): Promise<string> {
        const skillDir = path.join(this.tempDir, 'skills', name);
        await fs.mkdir(skillDir, { recursive: true });
        const skillFile = path.join(skillDir, 'SKILL.md');
        await fs.writeFile(skillFile, content, 'utf-8');
        return skillDir;
    }

    /**
     * Create a simple skill with frontmatter
     */
    async createSimpleSkill(name: string, description: string, body: string): Promise<string> {
        const content = `---
name: ${name}
description: ${description}
---

${body}
`;
        return this.createSkill(name, content);
    }
}

/**
 * Sample skill content for testing
 */
export const SAMPLE_SKILL_CONTENT = `---
name: test-skill
description: A test skill for unit testing
version: 1.0.0
author: Test Author
---

# Test Skill

This is a test skill for unit testing.

## Usage

1. Step one
2. Step two
3. Step three

## File References

See @src/utils.ts and @lib/helper.ts for examples.

## Commands

Run !\`npm install\` to install dependencies.
Run !\`npm test\` to run tests.
`;

/**
 * Skill with invalid name
 */
export const INVALID_NAME_SKILL = `---
name: InvalidSkillName
description: This has an invalid name
---

Content here.
`;

/**
 * Skill with missing description
 */
export const MISSING_DESC_SKILL = `---
name: missing-desc
---

Content here.
`;

/**
 * Skill with long description
 */
export const LONG_DESC_SKILL = `---
name: long-desc
description: ${'A'.repeat(2000)}
---

Content here.
`;
