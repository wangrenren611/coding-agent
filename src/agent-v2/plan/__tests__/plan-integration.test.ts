/**
 * Plan 功能集成测试
 *
 * 测试 Plan 功能与 Agent 的集成
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Agent } from '../../agent/agent';
import { ToolRegistry } from '../../tool/registry';
import { createPlanModeToolRegistry, createDefaultToolRegistry, getPlanModeTools, getDefaultTools } from '../../tool';
import { PlanCreateTool } from '../tools';
import { FilePlanStorage, createPlanStorage, getPlanFilePath, PlanStorageError } from '../storage';
import { isToolAllowedInPlanMode, READ_ONLY_TOOLS, BLOCKED_TOOL_PATTERNS } from '../plan-mode';
import { operatorPrompt } from '../../prompts/operator';
import type { ToolContext } from '../../tool/base';
import type { LLMGenerateOptions, LLMResponse, LLMProvider } from '../../../providers/types';

// ==================== Mock Provider ====================

class MockProvider {
    public callCount = 0;

    async generate(_messages: unknown[], _options?: LLMGenerateOptions) {
        this.callCount++;
        const response: LLMResponse = {
            messages: [
                {
                    messageId: 'msg-1',
                    role: 'assistant',
                    content: 'Hello',
                },
            ],
            usage: { inputTokens: 10, outputTokens: 5 },
            finishReason: 'stop',
        };
        return response;
    }

    generateStream = async function* (): AsyncGenerator<unknown> {
        yield { type: 'text', content: 'Hello' };
    };

    getLLMMaxTokens() {
        return 128000;
    }

    getMaxOutputTokens() {
        return 4096;
    }

    getTimeTimeout() {
        return 300000;
    }
}

// ==================== 测试目录 ====================

const TEST_DIR = path.join(process.cwd(), 'test-plan-integration');

// ==================== workingDirectory 传递测试 ====================

describe('workingDirectory 传递', () => {
    let tool: PlanCreateTool;
    let testContext: ToolContext;

    beforeEach(async () => {
        tool = new PlanCreateTool();
        testContext = {
            environment: 'test',
            platform: process.platform,
            time: new Date().toISOString(),
            workingDirectory: TEST_DIR,
            sessionId: 'test-session-working-dir',
        };
        await fs.mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
        try {
            await fs.rm(TEST_DIR, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('PlanCreateTool 应该使用 workingDirectory 作为 baseDir', async () => {
        const result = await tool.execute(
            {
                title: '测试计划',
                content: '# 测试内容',
            },
            testContext
        );

        expect(result.success).toBe(true);

        // 验证文件创建在正确的目录
        const planPath = path.join(TEST_DIR, 'plans', 'test-session-working-dir', 'plan.md');
        const content = await fs.readFile(planPath, 'utf-8');
        expect(content).toContain('# 测试内容');
    });

    it('Plan 文件路径应该与 getBySession 一致', async () => {
        await tool.execute(
            {
                title: '路径一致性测试',
                content: '# 路径一致性测试内容',
            },
            testContext
        );

        // 使用相同的 workingDirectory 创建 storage
        const storage = createPlanStorage(TEST_DIR);
        const plan = await storage.getBySession('test-session-working-dir');

        expect(plan).not.toBeNull();
        expect(plan?.content).toContain('# 路径一致性测试内容');
    });

    it('planBaseDir 应该优先于 workingDirectory', async () => {
        const planDir = path.join(process.cwd(), 'test-plan-basedir');
        const workDir = path.join(process.cwd(), 'test-plan-workdir');

        try {
            await tool.execute(
                {
                    title: 'planBaseDir 优先级测试',
                    content: '# planBaseDir 测试',
                },
                {
                    ...testContext,
                    workingDirectory: workDir,
                    planBaseDir: planDir,
                    sessionId: 'planbasedir-priority-test',
                }
            );

            // 验证文件创建在 planBaseDir 目录
            const planPath = path.join(planDir, 'plans', 'planbasedir-priority-test', 'plan.md');
            const content = await fs.readFile(planPath, 'utf-8');
            expect(content).toContain('# planBaseDir 测试');

            // 验证 storage 可以正确读取
            const storage = createPlanStorage(planDir);
            const planResult = await storage.getBySession('planbasedir-priority-test');
            expect(planResult).not.toBeNull();
            expect(planResult?.meta.title).toBe('planBaseDir 优先级测试');
        } finally {
            try {
                await fs.rm(planDir, { recursive: true, force: true });
                await fs.rm(workDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        }
    });
});

// ==================== Plan 模式工具注册表测试 ====================

describe('Plan 模式工具注册表', () => {
    it('createPlanModeToolRegistry 应该只包含只读工具', () => {
        const registry = createPlanModeToolRegistry({ workingDirectory: process.cwd() });
        const tools = registry.toLLMTools();
        const toolNames = tools.map((t) => t.function.name);

        // 检查包含只读工具
        expect(toolNames).toContain('read_file');
        expect(toolNames).toContain('glob');
        expect(toolNames).toContain('grep');
        expect(toolNames).toContain('plan_create');

        // 检查不包含写工具
        expect(toolNames).not.toContain('write_file');
        expect(toolNames).not.toContain('precise_replace');
        expect(toolNames).not.toContain('batch_replace');
        expect(toolNames).not.toContain('bash');
    });

    it('createDefaultToolRegistry 应该包含所有工具', () => {
        const registry = createDefaultToolRegistry({ workingDirectory: process.cwd() });
        const tools = registry.toLLMTools();
        const toolNames = tools.map((t) => t.function.name);

        // 检查包含所有工具
        expect(toolNames).toContain('read_file');
        expect(toolNames).toContain('write_file');
        expect(toolNames).toContain('precise_replace');
        expect(toolNames).toContain('batch_replace');
        expect(toolNames).toContain('bash');
        expect(toolNames).toContain('plan_create');
    });

    it('getPlanModeTools 返回的工具数量应该少于 getDefaultTools', () => {
        const planModeTools = getPlanModeTools(process.cwd());
        const defaultTools = getDefaultTools(process.cwd());

        expect(planModeTools.length).toBeLessThan(defaultTools.length);
    });
});

// ==================== ToolRegistry context 测试 ====================

describe('ToolRegistry buildToolContext', () => {
    it('应该正确设置 workingDirectory', () => {
        const registry = new ToolRegistry({ workingDirectory: TEST_DIR });
        expect(registry.workingDirectory).toBe(TEST_DIR);
    });

    it('应该正确设置 planBaseDir', () => {
        const planDir = path.join(process.cwd(), 'test-plan-dir');
        const registry = new ToolRegistry({
            workingDirectory: TEST_DIR,
            planBaseDir: planDir,
        });
        expect(registry.planBaseDir).toBe(planDir);
    });

    it('planBaseDir 应该是可选的', () => {
        const registry = new ToolRegistry({ workingDirectory: TEST_DIR });
        expect(registry.planBaseDir).toBeUndefined();
    });

    it('createPlanModeToolRegistry 应该支持 planBaseDir', () => {
        const planDir = path.join(process.cwd(), 'test-plan-registry-dir');
        const registry = createPlanModeToolRegistry({
            workingDirectory: TEST_DIR,
            planBaseDir: planDir,
        });
        expect(registry.planBaseDir).toBe(planDir);
    });

    it('createDefaultToolRegistry 应该支持 planBaseDir', () => {
        const planDir = path.join(process.cwd(), 'test-plan-registry-dir');
        const registry = createDefaultToolRegistry({
            workingDirectory: TEST_DIR,
            planBaseDir: planDir,
        });
        expect(registry.planBaseDir).toBe(planDir);
    });
});

// ==================== Plan Storage 边界测试 ====================

describe('Plan Storage 边界情况', () => {
    let storage: FilePlanStorage;
    const testDir = path.join(process.cwd(), 'test-plan-boundary');

    beforeEach(async () => {
        storage = new FilePlanStorage(testDir);
        await fs.mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    describe('特殊字符标题', () => {
        it('应该处理包含特殊字符的标题', async () => {
            const meta = await storage.create({
                title: '测试 <script>alert(1)</script> 特殊字符',
                content: '# 内容',
                sessionId: 'session-special-chars',
            });

            expect(meta.title).toContain('特殊字符');
        });

        it('应该处理 Unicode 标题', async () => {
            const meta = await storage.create({
                title: '实现 用户 认证 功能 🔐',
                content: '# Unicode 测试',
                sessionId: 'session-unicode',
            });

            expect(meta.title).toContain('🔐');
        });
    });

    describe('空值处理', () => {
        it('getBySession 应该处理不存在的 session', async () => {
            const result = await storage.getBySession('non-existent-session');
            expect(result).toBeNull();
        });

        it('get 应该处理不存在的 planId', async () => {
            const result = await storage.get('plan-nonexistent');
            expect(result).toBeNull();
        });

        it('delete 应该返回 false 处理不存在的 planId', async () => {
            const result = await storage.delete('plan-nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('sessionId 安全验证', () => {
        it('应该拒绝路径遍历 sessionId', async () => {
            await expect(
                storage.create({
                    title: '测试',
                    content: '# 内容',
                    sessionId: '../../../escape',
                })
            ).rejects.toThrow(PlanStorageError);
        });

        it('应该拒绝包含空格的 sessionId', async () => {
            await expect(
                storage.create({
                    title: '测试',
                    content: '# 内容',
                    sessionId: 'session with spaces',
                })
            ).rejects.toThrow(PlanStorageError);
        });

        it('应该接受有效的 sessionId', async () => {
            const meta = await storage.create({
                title: '测试',
                content: '# 内容',
                sessionId: 'valid-session_123',
            });
            expect(meta.sessionId).toBe('valid-session_123');
        });
    });
});

// ==================== createPlanStorage 工厂函数测试 ====================

describe('createPlanStorage 工厂函数', () => {
    const testDir = path.join(process.cwd(), 'test-plan-factory');

    afterEach(async () => {
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('应该返回 FilePlanStorage', () => {
        const storage = createPlanStorage(testDir);
        expect(storage).toBeInstanceOf(FilePlanStorage);
    });

    it('无 baseDir 时应该使用 process.cwd()', () => {
        const storage = createPlanStorage();
        expect(storage).toBeInstanceOf(FilePlanStorage);
    });
});

// ==================== getPlanFilePath 测试 ====================

describe('getPlanFilePath', () => {
    it('应该返回正确的路径格式', () => {
        const filePath = getPlanFilePath('/data', 'session-123');
        expect(filePath).toMatch(/[\\/]data[\\/]plans[\\/]session-123[\\/]plan\.md/);
    });
});

// ==================== Agent Plan Mode 集成测试 ====================

describe('Agent Plan Mode 集成', () => {
    let provider: MockProvider;

    beforeEach(() => {
        provider = new MockProvider();
    });

    describe('系统提示词', () => {
        it('Plan Mode 下系统提示词应该包含关键指令', () => {
            // 使用 operatorPrompt 构建包含 Plan Mode 指令的系统提示词
            // operatorPrompt 已在顶部导入
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                planMode: true,
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
                planMode: true,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find((m) => m.role === 'system');

            expect(systemMessage?.content).toContain('Plan Mode');
            expect(systemMessage?.content).toContain('plan_create');
            expect(systemMessage?.content).toContain('MUST');
        });

        it('非 Plan Mode 下系统提示词不应该包含 Plan Mode 指令', () => {
            // 使用 operatorPrompt 构建不包含 Plan Mode 指令的系统提示词
            // operatorPrompt 已在顶部导入
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                planMode: false,
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
                planMode: false,
            });

            const messages = agent.getMessages();
            const systemMessage = messages.find((m) => m.role === 'system');

            // 不应该包含 Plan Mode 相关指令
            expect(systemMessage?.content).not.toContain('Plan Mode');
            expect(systemMessage?.content).not.toContain('plan_create');
        });
    });

    describe('planBaseDir 配置', () => {
        it('Agent 应该支持 planBaseDir 配置', () => {
            const planDir = path.join(process.cwd(), 'test-agent-plan-dir');
            const systemPrompt = operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
                planMode: true,
            });

            const agent = new Agent({
                provider: provider as unknown as LLMProvider,
                systemPrompt,
                planMode: true,
                planBaseDir: planDir,
            });

            // Agent 创建成功即表示配置有效
            expect(agent).toBeDefined();
            expect(agent.getSessionId()).toBeDefined();
        });
    });
});

// ==================== Plan Mode 工具过滤深度测试 ====================

describe('Plan Mode 工具过滤深度测试', () => {
    describe('所有允许的工具', () => {
        it('READ_ONLY_TOOLS 应该包含所有必要的只读工具', () => {
            const expectedTools = [
                'read_file',
                'glob',
                'grep',
                'lsp',
                'web_search',
                'web_fetch',
                'plan_create',
                'task',
                'task_create',
                'task_get',
                'task_list',
                'task_update',
                'task_stop',
                'skill',
            ];

            for (const tool of expectedTools) {
                expect(READ_ONLY_TOOLS.has(tool)).toBe(true);
            }
        });

        it('READ_ONLY_TOOLS 不应该包含写工具', () => {
            expect(READ_ONLY_TOOLS.has('write_file')).toBe(false);
            expect(READ_ONLY_TOOLS.has('bash')).toBe(false);
        });
    });

    describe('阻止模式测试', () => {
        it('BLOCKED_TOOL_PATTERNS 应该阻止精确的工具名', () => {
            const blockedTools = ['write_file', 'precise_replace', 'batch_replace', 'bash'];

            for (const tool of blockedTools) {
                const isBlocked = BLOCKED_TOOL_PATTERNS.some((p) => p.test(tool));
                expect(isBlocked).toBe(true);
            }
        });

        it('BLOCKED_TOOL_PATTERNS 不应该阻止只读工具', () => {
            const allowedTools = ['read_file', 'glob', 'grep', 'plan_create', 'task'];

            for (const tool of allowedTools) {
                const isBlocked = BLOCKED_TOOL_PATTERNS.some((p) => p.test(tool));
                expect(isBlocked).toBe(false);
            }
        });
    });

    describe('isToolAllowedInPlanMode 边界情况', () => {
        it('应该拒绝空字符串工具名', () => {
            expect(isToolAllowedInPlanMode('')).toBe(false);
        });
    });
});
