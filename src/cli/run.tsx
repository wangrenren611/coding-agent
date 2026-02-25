#!/usr/bin/env bun
/**
 * QPSCode CLI 运行脚本
 *
 * 使用方法:
 *   bun run src/cli/run.ts
 *
 * 环境变量:
 *   GLM_API_KEY - 智谱 AI API Key (用于 glm-4.7, glm-5)
 *   MINIMAX_API_KEY - MiniMax API Key
 *   KIMI_API_KEY - Kimi API Key
 *   DEEPSEEK_API_KEY - DeepSeek API Key
 *   QEPSEEK_API_KEY - 通义千问 API Key
 *   LLM_MODEL - 模型 ID (默认自动检测)
 *
 * 支持的模型:
 *   - glm-5, glm-4.7 (需要 GLM_API_KEY)
 *   - minimax-2.5 (需要 MINIMAX_API_KEY)
 *   - kimi-k2.5 (需要 KIMI_API_KEY)
 *   - deepseek-chat (需要 DEEPSEEK_API_KEY)
 *   - qwen3.5-plus, qwen-kimi-k2.5 (需要 QEPSEEK_API_KEY)
 */

import { config } from 'dotenv';
import { startCLI } from './index.tsx';

// 加载环境变量
config();

// 模型到 API Key 的映射
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
 * 自动检测可用的模型
 */
function detectAvailableModel(): { model: string; key: string } | null {
    // 1. 如果明确指定了 LLM_MODEL，使用它
    const explicitModel = process.env.LLM_MODEL;
    if (explicitModel && MODEL_CONFIGS[explicitModel]) {
        const config = MODEL_CONFIGS[explicitModel];
        if (process.env[config.apiKey]) {
            return { model: explicitModel, key: config.apiKey };
        }
        console.error(`\n❌ Error: Model "${explicitModel}" requires ${config.apiKey} to be set.`);
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

async function main() {
    const detected = detectAvailableModel();

    if (!detected) {
        console.error('\n❌ Error: No API key found!');
        console.error('\nPlease set one of the following environment variables:');
        console.error('  - GLM_API_KEY        (for glm-5, glm-4.7)');
        console.error('  - QEPSEEK_API_KEY    (for qwen3.5-plus, qwen-kimi-k2.5)');
        console.error('  - DEEPSEEK_API_KEY   (for deepseek-chat)');
        console.error('  - KIMI_API_KEY       (for kimi-k2.5)');
        console.error('  - MINIMAX_API_KEY    (for minimax-2.5)');
        console.error('\nOr specify a model with LLM_MODEL environment variable.\n');
        process.exit(1);
    }

    // 设置 LLM_MODEL 环境变量，让 agent context 使用
    // process.env.LLM_MODEL = detected.model;

    // const modelName = MODEL_CONFIGS[detected.model].name;
    // console.log("Starting QPSCode CLI...");
    // console.log(`Model: ${modelName} (${detected.model})`);
    // console.log("Press Ctrl+C to exit\n");

    // 启动 CLI
    await startCLI({
        onExit: async () => {
            // 清理工作
        },
    });

    // console.log("\nGoodbye!");
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
