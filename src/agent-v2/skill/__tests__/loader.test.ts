/**
 * Tests for skill/loader.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillLoader, getSkillLoader } from '../loader';
import {
    SkillTestEnvironment,
    SAMPLE_SKILL_CONTENT,
    INVALID_NAME_SKILL,
    MISSING_DESC_SKILL,
    LONG_DESC_SKILL,
} from './test-utils';

describe('SkillLoader', () => {
    let env: SkillTestEnvironment;

    beforeEach(async () => {
        env = new SkillTestEnvironment('skill-loader');
        await env.setup();
    });

    afterEach(async () => {
        await env.teardown();
    });

    describe('initialize', () => {
        it('should load skill metadata on initialize', async () => {
            await env.createSkill('test-skill', SAMPLE_SKILL_CONTENT);

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            expect(loader.size).toBe(1);
            expect(loader.hasSkill('test-skill')).toBe(true);
        });

        it('should handle multiple skills', async () => {
            await env.createSimpleSkill('skill-a', 'Skill A', 'Content A');
            await env.createSimpleSkill('skill-b', 'Skill B', 'Content B');
            await env.createSimpleSkill('skill-c', 'Skill C', 'Content C');

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            expect(loader.size).toBe(3);
            expect(loader.hasSkill('skill-a')).toBe(true);
            expect(loader.hasSkill('skill-b')).toBe(true);
            expect(loader.hasSkill('skill-c')).toBe(true);
        });

        it('should handle nested skill directories', async () => {
            // Create a skill in a nested directory, but with a valid name in frontmatter
            const skillContent = `---
name: nested-skill
description: A nested skill
---

Content here.`;
            await env.createSkill('category/sub-skill', skillContent);

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            expect(loader.size).toBe(1);
            expect(loader.hasSkill('nested-skill')).toBe(true);
        });

        it('should skip skills with invalid names', async () => {
            await env.createSkill('invalid', INVALID_NAME_SKILL);

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            expect(loader.size).toBe(0);
        });

        it('should skip skills with missing description', async () => {
            await env.createSkill('missing-desc', MISSING_DESC_SKILL);

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            expect(loader.size).toBe(0);
        });

        it('should skip skills with too long description', async () => {
            await env.createSkill('long-desc', LONG_DESC_SKILL);

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            expect(loader.size).toBe(0);
        });

        it('should handle non-existent skills directory', async () => {
            const loader = new SkillLoader({
                skillsDir: '/non/existent/path',
            });

            // Should not throw
            await loader.initialize();
            expect(loader.size).toBe(0);
        });

        it('should be idempotent', async () => {
            await env.createSimpleSkill('test', 'Test', 'Content');

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();
            const size1 = loader.size;

            await loader.initialize();
            const size2 = loader.size;

            expect(size1).toBe(size2);
        });
    });

    describe('getAllMetadata', () => {
        it('should return all skill metadata', async () => {
            await env.createSimpleSkill('skill-1', 'First skill', 'Content');
            await env.createSimpleSkill('skill-2', 'Second skill', 'Content');

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            const metadata = loader.getAllMetadata();

            expect(metadata).toHaveLength(2);
            expect(metadata.map((m) => m.name)).toContain('skill-1');
            expect(metadata.map((m) => m.name)).toContain('skill-2');
        });

        it('should return empty array when no skills', async () => {
            const loader = new SkillLoader({
                skillsDir: env.getTempDir(),
            });

            await loader.initialize();

            expect(loader.getAllMetadata()).toHaveLength(0);
        });
    });

    describe('loadSkill (lazy loading)', () => {
        it('should load skill content on demand', async () => {
            await env.createSkill('test-skill', SAMPLE_SKILL_CONTENT);

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            // Metadata loaded, but content not yet
            expect(loader.size).toBe(1);

            // Now load full skill
            const skill = await loader.loadSkill('test-skill');

            expect(skill).not.toBeNull();
            expect(skill?.metadata.name).toBe('test-skill');
            expect(skill?.content).toContain('Test Skill');
            expect(skill?.content).toContain('Step one');
            expect(skill?.fileRefs).toContain('src/utils.ts');
            expect(skill?.shellCommands).toContain('npm install');
            expect(skill?.loadedAt).toBeGreaterThan(0);
        });

        it('should return null for non-existent skill', async () => {
            const loader = new SkillLoader();
            await loader.initialize();

            const skill = await loader.loadSkill('non-existent');
            expect(skill).toBeNull();
        });

        it('should cache loaded skills', async () => {
            await env.createSimpleSkill('cached', 'Cached skill', 'Content');

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            const skill1 = await loader.loadSkill('cached');
            const skill2 = await loader.loadSkill('cached');

            // Same object reference (cached)
            expect(skill1).toBe(skill2);
            expect(skill1?.loadedAt).toBe(skill2?.loadedAt);
        });

        it('should clear cache', async () => {
            await env.createSimpleSkill('to-clear', 'To clear', 'Content');

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            const skill1 = await loader.loadSkill('to-clear');
            loader.clearCache('to-clear');
            const skill2 = await loader.loadSkill('to-clear');

            // Different objects (cache was cleared)
            expect(skill1).not.toBe(skill2);
        });

        it('should clear all cache', async () => {
            await env.createSimpleSkill('skill-1', 'Skill 1', 'Content');
            await env.createSimpleSkill('skill-2', 'Skill 2', 'Content');

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            await loader.loadSkill('skill-1');
            await loader.loadSkill('skill-2');

            loader.clearCache();

            // Skills will be re-loaded on next access
            const skill1 = await loader.loadSkill('skill-1');
            expect(skill1).not.toBeNull();
        });

        it('should reload skill', async () => {
            await env.createSimpleSkill('reload-test', 'To reload', 'Original');

            const loader = new SkillLoader({
                skillsDir: `${env.getTempDir()}/skills`,
            });

            await loader.initialize();

            const skill1 = await loader.loadSkill('reload-test');
            const skill2 = await loader.reloadSkill('reload-test');

            expect(skill1).not.toBe(skill2);
        });
    });
});

describe('Global loader functions', () => {
    it('should return same instance from getSkillLoader', () => {
        // Note: These tests may affect global state
        const loader1 = getSkillLoader();
        const loader2 = getSkillLoader();

        expect(loader1).toBe(loader2);
    });
});
