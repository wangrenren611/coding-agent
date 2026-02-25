/**
 * Tests for skill/parser.ts
 */

import { describe, it, expect } from 'vitest';
import {
    parseFrontmatter,
    stripFrontmatter,
    extractFileRefs,
    extractShellCommands,
    parseSkillFile,
    formatSkillForContext,
    isValidSkillName,
    isValidDescription,
} from '../parser';

describe('Skill Parser', () => {
    describe('parseFrontmatter', () => {
        it('should parse valid frontmatter', () => {
            const content = `---
name: test-skill
description: A test skill
---

Body content here.`;

            const result = parseFrontmatter(content);
            expect(result).not.toBeNull();
            expect(result?.name).toBe('test-skill');
            expect(result?.description).toBe('A test skill');
        });

        it('should parse frontmatter with optional fields', () => {
            const content = `---
name: test-skill
description: A test skill
version: 1.0.0
author: Test Author
license: MIT
---

Body content.`;

            const result = parseFrontmatter(content);
            expect(result).not.toBeNull();
            expect(result?.version).toBe('1.0.0');
            expect(result?.author).toBe('Test Author');
            expect(result?.license).toBe('MIT');
        });

        it('should handle quoted values', () => {
            const content = `---
name: "test-skill"
description: 'A description with "quotes"'
---

Body.`;

            const result = parseFrontmatter(content);
            expect(result).not.toBeNull();
            expect(result?.name).toBe('test-skill');
            expect(result?.description).toBe('A description with "quotes"');
        });

        it('should return null for missing name', () => {
            const content = `---
description: A test skill
---

Body.`;

            const result = parseFrontmatter(content);
            expect(result).toBeNull();
        });

        it('should return null for missing description', () => {
            const content = `---
name: test-skill
---

Body.`;

            const result = parseFrontmatter(content);
            expect(result).toBeNull();
        });

        it('should return null when no frontmatter exists', () => {
            const content = 'Just regular markdown content.';
            const result = parseFrontmatter(content);
            expect(result).toBeNull();
        });

        it('should handle empty frontmatter', () => {
            const content = `---
---

Body.`;

            const result = parseFrontmatter(content);
            expect(result).toBeNull();
        });
    });

    describe('stripFrontmatter', () => {
        it('should remove frontmatter from content', () => {
            const content = `---
name: test-skill
description: Test
---

# Heading

Body content.`;

            const result = stripFrontmatter(content);
            expect(result).not.toContain('---');
            expect(result).toContain('# Heading');
            expect(result).toContain('Body content.');
        });

        it('should return original content when no frontmatter', () => {
            const content = '# Just markdown';
            const result = stripFrontmatter(content);
            expect(result).toBe(content);
        });
    });

    describe('extractFileRefs', () => {
        it('should extract file references', () => {
            const content = 'See @src/app.ts and @lib/utils.ts for details.';
            const refs = extractFileRefs(content);
            expect(refs).toContain('src/app.ts');
            expect(refs).toContain('lib/utils.ts');
        });

        it('should handle relative paths', () => {
            const content = 'Check @./local/file.ts and @../parent/file.ts';
            const refs = extractFileRefs(content);
            expect(refs).toContain('./local/file.ts');
            expect(refs).toContain('../parent/file.ts');
        });

        it('should not extract email addresses', () => {
            const content = 'Contact user@example.com for help.';
            const refs = extractFileRefs(content);
            expect(refs).toHaveLength(0);
        });

        it('should not extract from code blocks', () => {
            const content = '```\nconst x = "@fake/file.ts";\n```\nSee @real/file.ts';
            const refs = extractFileRefs(content);
            expect(refs).toContain('real/file.ts');
            expect(refs).not.toContain('fake/file.ts');
        });

        it('should deduplicate references', () => {
            const content = 'See @app.ts and @app.ts again.';
            const refs = extractFileRefs(content);
            expect(refs).toHaveLength(1);
        });

        it('should handle empty content', () => {
            const refs = extractFileRefs('');
            expect(refs).toHaveLength(0);
        });
    });

    describe('extractShellCommands', () => {
        it('should extract shell commands', () => {
            const content = 'Run !`npm install` and then !`npm test`';
            const cmds = extractShellCommands(content);
            expect(cmds).toContain('npm install');
            expect(cmds).toContain('npm test');
        });

        it('should deduplicate commands', () => {
            const content = 'Run !`npm install` and !`npm install` again';
            const cmds = extractShellCommands(content);
            expect(cmds).toHaveLength(1);
        });

        it('should handle commands with spaces', () => {
            const content = 'Run !`npm run build --prod`';
            const cmds = extractShellCommands(content);
            expect(cmds).toContain('npm run build --prod');
        });

        it('should handle empty content', () => {
            const cmds = extractShellCommands('');
            expect(cmds).toHaveLength(0);
        });
    });

    describe('parseSkillFile', () => {
        it('should parse complete skill file', () => {
            const content = `---
name: my-skill
description: My skill
---

# Heading

See @src/file.ts
Run !\`npm test\`
`;

            const result = parseSkillFile(content, '/skills/my-skill');

            expect(result.metadata.name).toBe('my-skill');
            expect(result.metadata.description).toBe('My skill');
            expect(result.metadata.path).toBe('/skills/my-skill');
            expect(result.content).toContain('# Heading');
            expect(result.fileRefs).toContain('src/file.ts');
            expect(result.shellCommands).toContain('npm test');
        });
    });

    describe('formatSkillForContext', () => {
        it('should format skill for LLM context', () => {
            const skill = {
                metadata: {
                    name: 'test-skill',
                    description: 'A test',
                    path: '/skills/test',
                },
                content: '# Test\n\nBody content.',
                fileRefs: ['src/app.ts'],
                shellCommands: ['npm test'],
            };

            const formatted = formatSkillForContext(skill);

            expect(formatted).toContain('## Skill: test-skill');
            expect(formatted).toContain('**Description**: A test');
            expect(formatted).toContain('**Base directory**: /skills/test');
            expect(formatted).toContain('**Referenced files**:');
            expect(formatted).toContain('src/app.ts');
            expect(formatted).toContain('**Shell commands**:');
            expect(formatted).toContain('npm test');
            expect(formatted).toContain('# Test');
        });

        it('should handle skill without file refs or commands', () => {
            const skill = {
                metadata: {
                    name: 'simple',
                    description: 'Simple',
                    path: '/skills/simple',
                },
                content: 'Just content.',
            };

            const formatted = formatSkillForContext(skill);

            expect(formatted).toContain('## Skill: simple');
            expect(formatted).not.toContain('**Referenced files**:');
            expect(formatted).not.toContain('**Shell commands**:');
        });
    });

    describe('isValidSkillName', () => {
        it('should accept valid names', () => {
            expect(isValidSkillName('test-skill')).toBe(true);
            expect(isValidSkillName('my-awesome-skill')).toBe(true);
            expect(isValidSkillName('skill123')).toBe(true);
            expect(isValidSkillName('a')).toBe(true);
            expect(isValidSkillName('skill-v2')).toBe(true);
        });

        it('should reject invalid names', () => {
            expect(isValidSkillName('TestSkill')).toBe(false); // uppercase
            expect(isValidSkillName('test_skill')).toBe(false); // underscore
            expect(isValidSkillName('-test')).toBe(false); // starts with hyphen
            expect(isValidSkillName('test-')).toBe(false); // ends with hyphen
            expect(isValidSkillName('')).toBe(false); // empty
            expect(isValidSkillName('a'.repeat(65))).toBe(false); // too long
        });
    });

    describe('isValidDescription', () => {
        it('should accept valid descriptions', () => {
            expect(isValidDescription('A valid description')).toBe(true);
            expect(isValidDescription('a')).toBe(true);
            expect(isValidDescription('x'.repeat(1024))).toBe(true);
        });

        it('should reject invalid descriptions', () => {
            expect(isValidDescription('')).toBe(false); // empty
            expect(isValidDescription('x'.repeat(1025))).toBe(false); // too long
        });
    });
});
