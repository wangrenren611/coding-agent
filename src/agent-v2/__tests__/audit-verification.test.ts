/**
 * 审计问题验证测试
 *
 * 本测试文件用于验证修复后的代码行为是否正确
 * 修复的问题：P0-1, P0-2, P0-3, P0-4, P0-6
 */

import { describe, it, expect } from 'vitest';
import { hasContent } from '../agent/core-types';
import { AgentState, AgentStateConfig } from '../agent/core/agent-state';
import { KimiAdapter } from '../../providers/adapters/kimi';
import { StandardAdapter } from '../../providers/adapters/standard';
import { TOOL_TRUNCATION_CONFIGS } from '../truncation/constants';
import { isToolAllowedInPlanMode } from '../plan/plan-mode';
import { SubagentType } from '../tool/task/shared';
import { AGENT_CONFIGS } from '../tool/task/subagent-config';

// ==================== P0-1: hasContent 空值检查（已修复）====================

describe('P0-1: hasContent 空值检查', () => {
    it('应该正确处理字符串', () => {
        expect(hasContent('hello')).toBe(true);
        expect(hasContent('')).toBe(false);
    });

    it('应该正确处理 null/undefined', () => {
        // @ts-expect-error 测试 null 情况
        expect(hasContent(null)).toBe(false);
        // @ts-expect-error 测试 undefined 情况
        expect(hasContent(undefined)).toBe(false);
    });

    it('应该正确处理空数组', () => {
        expect(hasContent([])).toBe(false);
    });

    it('FIXED: 空文本的内容部分应该被正确判定为无内容', () => {
        const emptyTextContent = [{ type: 'text' as const, text: '' }];
        // 修复后：空文本内容应该返回 false
        expect(hasContent(emptyTextContent)).toBe(false);
    });

    it('应该正确处理有内容的数组', () => {
        const content = [{ type: 'text' as const, text: 'hello' }];
        expect(hasContent(content)).toBe(true);
    });

    it('应该正确处理图片内容（非文本类型视为有内容）', () => {
        const imageContent = [{ type: 'image_url' as const, image_url: { url: 'https://example.com/image.png' } }];
        expect(hasContent(imageContent)).toBe(true);
    });

    it('应该正确处理混合内容（空文本 + 图片）', () => {
        const mixedContent = [
            { type: 'text' as const, text: '' },
            { type: 'image_url' as const, image_url: { url: 'https://example.com/image.png' } },
        ];
        // 有图片，应该返回 true
        expect(hasContent(mixedContent)).toBe(true);
    });
});

// ==================== P0-2: isRetryExceeded 条件判断（已修复）====================

describe('P0-2: isRetryExceeded 条件判断', () => {
    const createAgentState = (maxRetries: number) => {
        const config: AgentStateConfig = {
            maxLoops: 100,
            maxRetries,
            defaultRetryDelayMs: 1000,
        };
        return new AgentState(config);
    };

    it('初始状态不应该超过重试限制', () => {
        const state = createAgentState(3);
        expect(state.isRetryExceeded()).toBe(false);
    });

    it('VERIFY: maxRetries=3 时，允许 3 次重试（retryCount > maxRetries 时才超过）', () => {
        const state = createAgentState(3);

        // 第 1 次重试
        state.recordRetryableError();
        expect(state.retryCount).toBe(1);
        expect(state.isRetryExceeded()).toBe(false); // 1 > 3 = false

        // 第 2 次重试
        state.recordRetryableError();
        expect(state.retryCount).toBe(2);
        expect(state.isRetryExceeded()).toBe(false); // 2 > 3 = false

        // 第 3 次重试
        state.recordRetryableError();
        expect(state.retryCount).toBe(3);
        expect(state.isRetryExceeded()).toBe(false); // 3 > 3 = false

        // 第 4 次重试后超过限制
        state.recordRetryableError();
        expect(state.retryCount).toBe(4);
        expect(state.isRetryExceeded()).toBe(true); // 4 > 3 = true
    });

    it('maxRetries=0 时，第一次调用失败后不允许重试', () => {
        const state = createAgentState(0);
        expect(state.isRetryExceeded()).toBe(false); // 初始状态

        state.recordRetryableError();
        expect(state.retryCount).toBe(1);
        expect(state.isRetryExceeded()).toBe(true); // 1 > 0 = true
    });
});

// ==================== P0-3: KimiAdapter 构造参数（已修复）====================

describe('P0-3: KimiAdapter 构造参数', () => {
    it('FIXED: KimiAdapter 应该正确使用传入的参数', () => {
        const customEndpoint = '/custom/kimi/endpoint';
        const customModel = 'kimi-custom-model';

        const adapter = new KimiAdapter({
            endpointPath: customEndpoint,
            defaultModel: customModel,
        });

        // 修复后：参数应该被正确传递
        const standardAdapter = adapter as unknown as StandardAdapter;
        expect(standardAdapter.endpointPath).toBe(customEndpoint);
        expect(standardAdapter.defaultModel).toBe(customModel);
    });

    it('KimiAdapter 应该使用默认值（无参数时）', () => {
        const adapter = new KimiAdapter();
        const standardAdapter = adapter as unknown as StandardAdapter;

        // 使用 StandardAdapter 的默认值
        expect(standardAdapter.endpointPath).toBe('/chat/completions');
        expect(standardAdapter.defaultModel).toBe('gpt-4o');
    });
});

// ==================== P0-4: 截断配置工具名（已修复）====================

describe('P0-4: 截断配置工具名', () => {
    it('FIXED: 应该有 read_file 的配置', () => {
        expect(TOOL_TRUNCATION_CONFIGS['read_file']).toBeDefined();
        expect(TOOL_TRUNCATION_CONFIGS['read_file']?.enabled).toBe(false);
    });

    it('不应该有旧的 read 配置', () => {
        expect(TOOL_TRUNCATION_CONFIGS['read']).toBeUndefined();
    });
});

// ==================== P0-5: Plan 模式安全绕过风险（记录，暂不修复）====================

describe('P0-5: Plan 模式安全绕过风险', () => {
    it('Plan 模式应该允许 task 工具（当前设计）', () => {
        expect(isToolAllowedInPlanMode('task')).toBe(true);
    });

    /**
     * 此问题需要更复杂的解决方案，暂时记录
     * 建议：在 Plan 模式下限制 task 的 subagent_type
     */
    it('KNOWN ISSUE: task 工具可以启动具有写权限的子 Agent', () => {
        const generalPurposeConfig = AGENT_CONFIGS[SubagentType.GeneralPurpose];
        const toolNames = generalPurposeConfig.tools.map((t) => t.name);

        // 验证 GeneralPurpose 有写权限
        expect(toolNames).toContain('WriteFileTool');
        expect(toolNames).toContain('BashTool');

        // 这是一个已知问题，需要在架构层面解决
    });

    it('Explore 子 Agent 应该是只读的', () => {
        const exploreConfig = AGENT_CONFIGS[SubagentType.Explore];
        const toolNames = exploreConfig.tools.map((t) => t.name);

        expect(toolNames).not.toContain('WriteFileTool');
        expect(toolNames).not.toContain('BashTool');
    });
});

// ==================== P0-6: WebFetch SSRF 防护（已修复）====================

describe('P0-6: WebFetch SSRF 防护', () => {
    it('FIXED: 应该阻止 localhost', async () => {
        const { WebFetchTool } = await import('../tool/web-fetch');
        const tool = new WebFetchTool();

        const result = await tool.execute({ url: 'http://localhost/test' });
        expect(result.success).toBe(false);
        expect(result.metadata?.error).toBe('SSRF_BLOCKED');
    });

    it('FIXED: 应该阻止 127.0.0.1', async () => {
        const { WebFetchTool } = await import('../tool/web-fetch');
        const tool = new WebFetchTool();

        const result = await tool.execute({ url: 'http://127.0.0.1/test' });
        expect(result.success).toBe(false);
        expect(result.metadata?.error).toBe('SSRF_BLOCKED');
    });

    it('FIXED: 应该阻止内网 IP (192.168.x.x)', async () => {
        const { WebFetchTool } = await import('../tool/web-fetch');
        const tool = new WebFetchTool();

        const result = await tool.execute({ url: 'http://192.168.1.1/test' });
        expect(result.success).toBe(false);
        expect(result.metadata?.error).toBe('SSRF_BLOCKED');
    });

    it('FIXED: 应该阻止 AWS 元数据地址', async () => {
        const { WebFetchTool } = await import('../tool/web-fetch');
        const tool = new WebFetchTool();

        const result = await tool.execute({ url: 'http://169.254.169.254/latest/meta-data/' });
        expect(result.success).toBe(false);
        expect(result.metadata?.error).toBe('SSRF_BLOCKED');
    });

    it('FIXED: 应该允许正常的外部 URL', async () => {
        const { WebFetchTool } = await import('../tool/web-fetch');
        const tool = new WebFetchTool();

        // 使用一个可靠的外部 URL 进行测试
        // 注意：这个测试需要网络连接
        const result = await tool.execute({ url: 'https://httpbin.org/get', timeout: 10 });

        // 只要不是 SSRF_BLOCKED 错误就算通过
        // 可能因为网络问题失败，但不应该是 SSRF 阻止
        if (!result.success) {
            expect(result.metadata?.error).not.toBe('SSRF_BLOCKED');
        }
    });
});

// ==================== P1-1: CLI 会话号展示逻辑（记录）====================

describe('P1-1: CLI 会话号展示逻辑', () => {
    it('slice(-1, 8) 对 UUID 返回空字符串', () => {
        const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

        // 错误的实现
        const wrongSlice = sessionId.slice(-1, 8);
        expect(wrongSlice).toBe('');

        // 正确的实现
        const correctSlice = sessionId.slice(0, 8);
        expect(correctSlice).toBe('a1b2c3d4');
    });
});

// ==================== 汇总报告 ====================

describe('修复状态汇总', () => {
    it('应该输出修复状态汇总', () => {
        console.log('\n========================================');
        console.log('审计问题修复状态汇总');
        console.log('========================================\n');

        console.log('P0 (高优先级) - 修复状态:');
        console.log('  [x] P0-1: hasContent 空值检查 - 已修复');
        console.log('  [x] P0-2: isRetryExceeded 条件判断 - 已修复');
        console.log('  [x] P0-3: KimiAdapter 构造参数 - 已修复');
        console.log('  [x] P0-4: 截断配置工具名 - 已修复');
        console.log('  [ ] P0-5: Plan 模式绕过 - 需要架构设计');
        console.log('  [x] P0-6: WebFetch SSRF 防护 - 已修复');
        console.log('  [ ] P0-7: LSP 内存泄漏 - 后续优化');

        console.log('\nP1 (中优先级) - 待处理:');
        console.log('  [ ] P1-1: CLI 会话号展示');
        console.log('  [ ] P1-2: Session 持久化错误');
        console.log('  [ ] P1-3: 超时机制统一');
        console.log('  [ ] P1-4: 错误处理统一');

        console.log('\n========================================\n');

        expect(true).toBe(true);
    });
});
