/**
 * Providers 使用示例
 *
 * 本示例展示了如何使用 providers 模块调用各种 LLM 服务
 */

import { ProviderRegistry, ModelId } from './providers/registry';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import type { LLMRequestMessage, LLMRequest } from './providers/typing';
import dotenv from 'dotenv';
dotenv.config({
    path: './.env.development',
});
// =============================================================================
// 示例 1: 使用 ProviderRegistry 从环境变量创建 Provider
// =============================================================================

async function example1_UsingRegistry() {
    console.log('=== 示例 1: 使用 ProviderRegistry ===\n');

    // 创建 GLM-4.7 Provider (需要设置 GLM_API_KEY 环境变量)
    const provider = ProviderRegistry.createFromEnv('glm-4.7', {
        temperature: 0.7,
    });

    const messages: LLMRequestMessage[] = [
        { role: 'user', content: '你好，请用一句话介绍你自己' },
    ];

    const response = await provider.generate(messages);

    console.log('Response:', response);
}

// =============================================================================
// 示例 2: 使用手动配置创建 Provider
// =============================================================================

async function example2_ManualConfig() {
    console.log('\n=== 示例 2: 手动配置 Provider ===\n');

    const provider = new OpenAICompatibleProvider({
        apiKey: 'your-api-key',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4',
        temperature: 0.5,
        max_tokens: 2000,
        LLMMAX_TOKENS: 8000,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
    });

    const messages: LLMRequestMessage[] = [
        { role: 'system', content: '你是一个有帮助的助手' },
        { role: 'user', content: '什么是 TypeScript?' },
    ];

    const response = await provider.generate(messages);
    console.log('Response:', response.choices[0].message.content);
}

// =============================================================================
// 示例 3: 流式请求
// =============================================================================

async function example3_Streaming() {
    console.log('\n=== 示例 3: 流式请求 ===\n');

    const provider = ProviderRegistry.createFromEnv('deepseek-chat');

    const messages: LLMRequestMessage[] = [
        { role: 'user', content: '写一首关于编程的诗' },
    ];

    const options: LLMRequest = {
        stream: true,
        streamCallback: (chunk) => {
            // 实时接收每个流式数据块
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
                process.stdout.write(content); // 逐字输出
            }
        },
    };

    await provider.generate(messages, options);
    console.log('\n');
}

// =============================================================================
// 示例 4: 工具调用 (Function Calling)
// =============================================================================

async function example4_ToolCalling() {
    console.log('\n=== 示例 4: 工具调用 ===\n');

    const provider = ProviderRegistry.createFromEnv('kimi-k2.5');

    // 定义工具
    const tools = [
        {
            type: 'function',
            function: {
                name: 'get_weather',
                description: '获取指定城市的天气信息',
                parameters: {
                    type: 'object',
                    properties: {
                        city: {
                            type: 'string',
                            description: '城市名称',
                        },
                    },
                    required: ['city'],
                },
            },
        },
    ];

    const messages: LLMRequestMessage[] = [
        { role: 'user', content: '北京今天天气怎么样?' },
    ];

    const response = await provider.generate(messages, { tools });

    const toolCalls = response.choices[0].message.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
        console.log('模型请求调用工具:');
        for (const toolCall of toolCalls) {
            console.log(`  - ${toolCall.function.name}`);
            console.log(`    参数: ${toolCall.function.arguments}`);
        }

        // 模拟执行工具并返回结果
        messages.push(response.choices[0].message);
        messages.push({
            role: 'tool',
            content: '{"temperature": "22°C", "condition": "晴朗"}',
            tool_call_id: toolCalls[0].id,
        });

        const finalResponse = await provider.generate(messages);
        console.log('\n最终回复:', finalResponse.choices[0].message.content);
    }
}

// =============================================================================
// 示例 5: 列出所有可用模型
// =============================================================================

function example5_ListModels() {
    console.log('\n=== 示例 5: 可用模型列表 ===\n');

    // 获取所有模型
    const models = ProviderRegistry.listModels();
    console.log('所有可用模型:');
    models.forEach(m => {
        console.log(`  - ${m.id} (${m.provider}): ${m.name}`);
        console.log(`    特性: ${m.features.join(', ')}`);
    });

    // 按厂商筛选
    console.log('\nGLM 厂商的模型:');
    const glmModels = ProviderRegistry.listModelsByProvider('glm');
    glmModels.forEach(m => {
        console.log(`  - ${m.id}: ${m.name}`);
    });
}

// =============================================================================
// 示例 6: 多轮对话
// =============================================================================

async function example6_MultiTurnConversation() {
    console.log('\n=== 示例 6: 多轮对话 ===\n');

    const provider = ProviderRegistry.createFromEnv('minimax-2.1');

    const messages: LLMRequestMessage[] = [
        { role: 'system', content: '你是一个专业的技术顾问' },
    ];

    // 第一轮
    messages.push({ role: 'user', content: '什么是 React?' });
    let response = await provider.generate(messages);
    console.log('Assistant:', response.choices[0].message.content);

    // 第二轮
    messages.push(response.choices[0].message);
    messages.push({ role: 'user', content: '它和 Vue 有什么区别?' });
    response = await provider.generate(messages);
    console.log('\nAssistant:', response.choices[0].message.content);
}

// =============================================================================
// 示例 7: 带中止信号的请求
// =============================================================================

async function example7_WithAbortSignal() {
    console.log('\n=== 示例 7: 带中止信号的请求 ===\n');

    const provider = ProviderRegistry.createFromEnv('glm-4.7');

    const messages: LLMRequestMessage[] = [
        { role: 'user', content: '请详细解释量子计算' },
    ];

    // 创建可中止的控制器
    const controller = new AbortController();

    // 模拟 3 秒后中止请求
    setTimeout(() => {
        console.log('中止请求...');
        controller.abort();
    }, 3000);

    try {
        await provider.generate(messages, {
            abortSignal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log('请求已被中止');
        }
    }
}

// =============================================================================
// 主入口
// =============================================================================

async function main() {
    // 运行示例
    try {
         await example1_UsingRegistry();
        // example2_ManualConfig();
        // example3_Streaming();
        // example4_ToolCalling();
        example5_ListModels();
        // example6_MultiTurnConversation();
        // example7_WithAbortSignal();
    } catch (error) {
        console.error('Error:', error);
    }
}

// 导出示例函数供外部使用
export {
    example1_UsingRegistry,
    example2_ManualConfig,
    example3_Streaming,
    example4_ToolCalling,
    example5_ListModels,
    example6_MultiTurnConversation,
    example7_WithAbortSignal,
};

// 如果直接运行此文件，执行 main
if (require.main === module) {
    main();
}
