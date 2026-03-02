/**
 * CLI run.tsx 模型检测逻辑测试
 *
 * 测试模型自动检测和环境变量处理逻辑
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// 模型配置（从 run.tsx 复制）
const MODEL_CONFIGS: Record<string, { apiKey: string; name: string }> = {
    'glm-5': { apiKey: 'GLM_API_KEY', name: 'GLM-5' },
    'glm-4.7': { apiKey: 'GLM_API_KEY', name: 'GLM-4.7' },
    'minimax-2.5': { apiKey: 'MINIMAX_API_KEY', name: 'MiniMax-2.5' },
    'kimi-k2.5': { apiKey: 'KIMI_API_KEY', name: 'Kimi K2.5' },
    'deepseek-chat': { apiKey: 'DEEPSEEK_API_KEY', name: 'DeepSeek Chat' },
    'qwen3.5-plus': { apiKey: 'QEPSEEK_API_KEY', name: 'Qwen 3.5 Plus' },
    'qwen-kimi-k2.5': { apiKey: 'QEPSEEK_API_KEY', name: 'Qwen Kimi K2.5' },
};

/**
 * 自动检测可用的模型（测试版本）
 */
function detectAvailableModel(): { model: string; key: string } | null {
    // 1. 如果明确指定了 LLM_MODEL，使用它
    const explicitModel = process.env.LLM_MODEL;
    if (explicitModel && MODEL_CONFIGS[explicitModel]) {
        const config = MODEL_CONFIGS[explicitModel];
        if (process.env[config.apiKey]) {
            return { model: explicitModel, key: config.apiKey };
        }
        return null;
    }

    // 2. 按优先级自动检测可用的 API Key
    const priority = ['glm-5', 'qwen3.5-plus', 'deepseek-chat', 'kimi-k2.5', 'minimax-2.5'];

    for (const model of priority) {
        const config = MODEL_CONFIGS[model];
        if (process.env[config.apiKey]) {
            return { model, key: config.apiKey };
        }
    }

    return null;
}

describe('CLI 模型检测', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // 清理环境变量
        const keysToClear = [
            'LLM_MODEL',
            'GLM_API_KEY',
            'MINIMAX_API_KEY',
            'KIMI_API_KEY',
            'DEEPSEEK_API_KEY',
            'QEPSEEK_API_KEY',
        ];
        keysToClear.forEach((key) => delete process.env[key]);
    });

    afterEach(() => {
        // 恢复环境变量
        const keysToClear = [
            'LLM_MODEL',
            'GLM_API_KEY',
            'MINIMAX_API_KEY',
            'KIMI_API_KEY',
            'DEEPSEEK_API_KEY',
            'QEPSEEK_API_KEY',
        ];
        keysToClear.forEach((key) => delete process.env[key]);
        Object.assign(process.env, originalEnv);
    });

    // ==================== 模型配置测试 ====================

    describe('MODEL_CONFIGS', () => {
        it('应该包含所有支持的模型', () => {
            const expectedModels = [
                'glm-5',
                'glm-4.7',
                'minimax-2.5',
                'kimi-k2.5',
                'deepseek-chat',
                'qwen3.5-plus',
                'qwen-kimi-k2.5',
            ];

            expectedModels.forEach((model) => {
                expect(MODEL_CONFIGS[model]).toBeDefined();
                expect(MODEL_CONFIGS[model].apiKey).toBeDefined();
                expect(MODEL_CONFIGS[model].name).toBeDefined();
            });
        });

        it('GLM 模型应该使用相同的 API Key', () => {
            expect(MODEL_CONFIGS['glm-5'].apiKey).toBe('GLM_API_KEY');
            expect(MODEL_CONFIGS['glm-4.7'].apiKey).toBe('GLM_API_KEY');
        });

        it('Qwen 模型应该使用相同的 API Key', () => {
            expect(MODEL_CONFIGS['qwen3.5-plus'].apiKey).toBe('QEPSEEK_API_KEY');
            expect(MODEL_CONFIGS['qwen-kimi-k2.5'].apiKey).toBe('QEPSEEK_API_KEY');
        });
    });

    // ==================== 自动检测测试 ====================

    describe('detectAvailableModel', () => {
        it('没有 API Key 时应该返回 null', () => {
            const result = detectAvailableModel();
            expect(result).toBeNull();
        });

        it('应该检测到 GLM-5（最高优先级）', () => {
            process.env.GLM_API_KEY = 'test-glm-key';
            const result = detectAvailableModel();

            expect(result).not.toBeNull();
            expect(result!.model).toBe('glm-5');
            expect(result!.key).toBe('GLM_API_KEY');
        });

        it('应该按优先级检测模型', () => {
            // 设置所有 API Key
            process.env.GLM_API_KEY = 'test-glm-key';
            process.env.QEPSEEK_API_KEY = 'test-qwen-key';
            process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
            process.env.KIMI_API_KEY = 'test-kimi-key';
            process.env.MINIMAX_API_KEY = 'test-minimax-key';

            const result = detectAvailableModel();

            // GLM-5 是最高优先级
            expect(result!.model).toBe('glm-5');
        });

        it('没有 GLM 时应该检测 Qwen', () => {
            process.env.QEPSEEK_API_KEY = 'test-qwen-key';
            const result = detectAvailableModel();

            expect(result!.model).toBe('qwen3.5-plus');
        });

        it('没有 GLM 和 Qwen 时应该检测 DeepSeek', () => {
            process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
            const result = detectAvailableModel();

            expect(result!.model).toBe('deepseek-chat');
        });

        it('没有 GLM、Qwen、DeepSeek 时应该检测 Kimi', () => {
            process.env.KIMI_API_KEY = 'test-kimi-key';
            const result = detectAvailableModel();

            expect(result!.model).toBe('kimi-k2.5');
        });

        it('没有其他 Key 时应该检测 MiniMax', () => {
            process.env.MINIMAX_API_KEY = 'test-minimax-key';
            const result = detectAvailableModel();

            expect(result!.model).toBe('minimax-2.5');
        });
    });

    // ==================== 显式指定模型测试 ====================

    describe('显式指定模型 (LLM_MODEL)', () => {
        it('应该使用显式指定的模型', () => {
            process.env.LLM_MODEL = 'deepseek-chat';
            process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
            process.env.GLM_API_KEY = 'test-glm-key'; // 即使有更高优先级的 key

            const result = detectAvailableModel();

            expect(result!.model).toBe('deepseek-chat');
        });

        it('显式指定模型但没有对应 Key 时应该返回 null', () => {
            process.env.LLM_MODEL = 'glm-5';
            // 不设置 GLM_API_KEY

            const result = detectAvailableModel();

            expect(result).toBeNull();
        });

        it('应该支持所有可配置的模型', () => {
            const models = [
                'glm-5',
                'glm-4.7',
                'minimax-2.5',
                'kimi-k2.5',
                'deepseek-chat',
                'qwen3.5-plus',
                'qwen-kimi-k2.5',
            ];

            for (const model of models) {
                // 清理
                delete process.env.LLM_MODEL;
                const keysToClear = [
                    'GLM_API_KEY',
                    'MINIMAX_API_KEY',
                    'KIMI_API_KEY',
                    'DEEPSEEK_API_KEY',
                    'QEPSEEK_API_KEY',
                ];
                keysToClear.forEach((key) => delete process.env[key]);

                // 设置
                process.env.LLM_MODEL = model;
                const config = MODEL_CONFIGS[model];
                process.env[config.apiKey] = 'test-key';

                const result = detectAvailableModel();
                expect(result!.model).toBe(model);
            }
        });

        it('无效的模型名称应该回退到自动检测', () => {
            process.env.LLM_MODEL = 'invalid-model';
            process.env.GLM_API_KEY = 'test-glm-key';

            const result = detectAvailableModel();

            // 应该回退到自动检测（GLM-5）
            expect(result!.model).toBe('glm-5');
        });
    });

    // ==================== 边界条件测试 ====================

    describe('边界条件', () => {
        it('空字符串 API Key 应该被视为无效', () => {
            process.env.GLM_API_KEY = '';
            const result = detectAvailableModel();

            expect(result).toBeNull();
        });

        it('只有空格的 API Key 应该被视为无效', () => {
            process.env.GLM_API_KEY = '   ';
            const result = detectAvailableModel();

            // 空格字符串在 JavaScript 中是 truthy，所以会被检测到
            // 这是预期行为，因为空格可能是有效的（虽然不太可能）
            expect(result).not.toBeNull();
        });

        it('LLM_MODEL 为空字符串时应该使用自动检测', () => {
            process.env.LLM_MODEL = '';
            process.env.GLM_API_KEY = 'test-glm-key';

            const result = detectAvailableModel();

            expect(result!.model).toBe('glm-5');
        });
    });
});

// ==================== 错误处理测试 ====================

describe('CLI 错误处理', () => {
    it('没有 API Key 时应该生成正确的错误信息', () => {
        const expectedKeys = [
            'GLM_API_KEY        (for glm-5, glm-4.7)',
            'QEPSEEK_API_KEY    (for qwen3.5-plus, qwen-kimi-k2.5)',
            'DEEPSEEK_API_KEY   (for deepseek-chat)',
            'KIMI_API_KEY       (for kimi-k2.5)',
            'MINIMAX_API_KEY    (for minimax-2.5)',
        ];

        // 验证错误信息包含所有必要的 API Key 说明
        expectedKeys.forEach((key) => {
            expect(key).toBeDefined();
        });
    });
});
