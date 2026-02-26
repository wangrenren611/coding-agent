/**
 * Tests for skill/skill-tool.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkillTool, createSkillTool, defaultSkillTool, simpleSkillTool } from '../skill-tool';
import { SkillTestEnvironment, SAMPLE_SKILL_CONTENT } from './test-utils';
import { getSkillLoader, initializeSkillLoader } from '../loader';

// Mock the global loader to avoid side effects
vi.mock('../loader', async () => {
    const actual = await vi.importActual('../loader');
    return {
        ...actual,
        initializeSkillLoader: vi.fn().mockResolvedValue(undefined),
        getSkillLoader: vi.fn(),
    };
});

describe('SkillTool', () => {
    let env: SkillTestEnvironment;
    let mockLoader: any;

    beforeEach(async () => {
        env = new SkillTestEnvironment('skill-tool');
        await env.setup();

        // Create mock loader
        mockLoader = {
            initialize: vi.fn().mockResolvedValue(undefined),
            getAllMetadata: vi.fn().mockReturnValue([
                { name: 'test-skill', description: 'A test skill for testing', path: '/skills/test-skill' },
                { name: 'another-skill', description: 'Another skill', path: '/skills/another-skill' },
            ]),
            hasSkill: vi.fn((name: string) => ['test-skill', 'another-skill'].includes(name)),
            loadSkill: vi.fn(),
        };

        vi.mocked(getSkillLoader).mockReturnValue(mockLoader);
    });

    afterEach(async () => {
        await env.teardown();
        vi.clearAllMocks();
    });

    describe('properties', () => {
        it('should have correct name', () => {
            const tool = new SkillTool();
            expect(tool.name).toBe('skill');
        });

        it('should have schema defined', () => {
            const tool = new SkillTool();
            expect(tool.schema).toBeDefined();
        });
    });

    describe('description', () => {
        it('should include skill list when includeSkillList is true', () => {
            const tool = new SkillTool(true);
            const desc = tool.description;

            expect(desc).toContain('Load a skill');
            expect(desc).toContain('test-skill');
            expect(desc).toContain('A test skill for testing');
            expect(desc).toContain('another-skill');
        });

        it('should not include skill list when includeSkillList is false', () => {
            const tool = new SkillTool(false);
            const desc = tool.description;

            expect(desc).toContain('Load a skill');
            expect(desc).not.toContain('test-skill');
        });

        it('should handle empty skill list', () => {
            mockLoader.getAllMetadata.mockReturnValue([]);
            const tool = new SkillTool(true);
            const desc = tool.description;

            expect(desc).toContain('No skills are currently available');
        });

        it('should cache description', () => {
            const tool = new SkillTool();
            const desc1 = tool.description;
            const desc2 = tool.description;

            expect(desc1).toBe(desc2);
            // getAllMetadata should only be called once due to caching
            expect(mockLoader.getAllMetadata).toHaveBeenCalledTimes(1);
        });
    });

    describe('refreshDescription', () => {
        it('should regenerate description on refresh', () => {
            const tool = new SkillTool();
            const desc1 = tool.description;

            mockLoader.getAllMetadata.mockClear();
            tool.refreshDescription();
            const desc2 = tool.description;

            expect(desc1).toBe(desc2); // Same content
            // Should call getAllMetadata again after refresh
            expect(mockLoader.getAllMetadata).toHaveBeenCalled();
        });
    });

    describe('execute', () => {
        it('should load skill successfully', async () => {
            mockLoader.loadSkill.mockResolvedValue({
                metadata: {
                    name: 'test-skill',
                    description: 'A test skill',
                    path: '/skills/test-skill',
                },
                content: '# Test Skill\n\nContent here.',
                fileRefs: ['src/app.ts'],
                shellCommands: ['npm test'],
                loadedAt: Date.now(),
            });

            const tool = new SkillTool();
            const result = await tool.execute({ name: 'test-skill' });

            expect(result.success).toBe(true);
            expect(result.metadata?.name).toBe('test-skill');
            expect(result.metadata?.description).toBe('A test skill');
            expect(result.metadata?.baseDir).toBe('/skills/test-skill');
            expect(result.metadata?.content).toContain('# Test Skill');
            expect(result.metadata?.fileRefs).toContain('src/app.ts');
            expect(result.metadata?.shellCommands).toContain('npm test');
            expect(result.output).toContain('## Skill: test-skill');
        });

        it('should initialize loader before executing', async () => {
            const tool = new SkillTool();
            await tool.execute({ name: 'test-skill' });

            expect(initializeSkillLoader).toHaveBeenCalled();
        });

        it('should return error for non-existent skill', async () => {
            mockLoader.hasSkill.mockReturnValue(false);

            const tool = new SkillTool();
            const result = await tool.execute({ name: 'non-existent' });

            expect(result.success).toBe(false);
            expect(result.output).toContain('not found');
            expect(result.output).toContain('Available skills');
        });

        it('should handle skill load failure', async () => {
            mockLoader.loadSkill.mockResolvedValue(null);

            const tool = new SkillTool();
            const result = await tool.execute({ name: 'test-skill' });

            expect(result.success).toBe(false);
            expect(result.output).toContain('Failed to load skill');
        });
    });

    describe('createSkillTool', () => {
        it('should create tool with default options', () => {
            const tool = createSkillTool();
            expect(tool).toBeInstanceOf(SkillTool);
        });

        it('should create tool with includeSkillList false', () => {
            const tool = createSkillTool({ includeSkillList: false });
            expect(tool.description).not.toContain('test-skill');
        });
    });

    describe('default instances', () => {
        it('should export defaultSkillTool', () => {
            expect(defaultSkillTool).toBeInstanceOf(SkillTool);
        });

        it('should export simpleSkillTool', () => {
            expect(simpleSkillTool).toBeInstanceOf(SkillTool);
            expect(simpleSkillTool.description).not.toContain('test-skill');
        });
    });
});
