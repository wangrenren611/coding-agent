/**
 * Agent 统一导出
 *
 * 导出 Provider 和 Agent-v2 模块
 */

// =============================================================================
// Provider 模块导出
// =============================================================================
export * from './providers';

// =============================================================================
// Agent-v2 模块导出
// =============================================================================
export * from './agent-v2';

// =============================================================================
// 示例代码 - 使用 Agent-v2
// =============================================================================
import { Agent } from './agent-v2/agent/agent';
import { ToolRegistry } from './agent-v2/tool/registry';
import { createMemoryManager } from './agent-v2/memory';
import { ProviderRegistry } from './providers/registry';
import { operatorPrompt } from './agent-v2/prompts/operator';
import { AgentMessageType, type AgentMessage } from './agent-v2/agent/stream-types';
import BashTool from './agent-v2/tool/bash';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });

// ANSI 颜色
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/**
 * 统一流式消息处理
 */
function handleStreamMessage(message: AgentMessage) {
    switch (message.type) {
        case AgentMessageType.REASONING_START:
            process.stdout.write(`${GRAY}┌─ 💭 思考过程${RESET}\n`);
            process.stdout.write(`${GRAY}│${RESET} `);
            break;
        case AgentMessageType.REASONING_DELTA:
            process.stdout.write(message.payload.content);
            break;
        case AgentMessageType.REASONING_COMPLETE:
            process.stdout.write('\n');
            process.stdout.write(`${GRAY}└─ 思考完成${RESET}\n\n`);
            break;
        case AgentMessageType.TEXT_START:
            process.stdout.write(`${GREEN}┌─ 🤖 回复${RESET}\n`);
            process.stdout.write(`${GREEN}│${RESET} `);
            break;
        case AgentMessageType.TEXT_DELTA:
            process.stdout.write(message.payload.content);
            break;
        case AgentMessageType.TEXT_COMPLETE:
            process.stdout.write('\n');
            process.stdout.write(`${GREEN}└─ 回复完成${RESET}\n`);
            break;
        case AgentMessageType.TOOL_CALL_CREATED:
            const tools = message.payload.tool_calls.map((call) => 
                `${call.toolName}(${call.args.slice(0, 50)}${call.args.length > 50 ? '...' : ''})`
            );
            console.log(`${YELLOW}🔧 工具调用:${RESET}`, tools.join(', '));
            break;
        case AgentMessageType.TOOL_CALL_STREAM:
            if (message.payload.output) {
                process.stdout.write(`${GRAY}${message.payload.output}${RESET}`);
            }
            break;
        case AgentMessageType.TOOL_CALL_RESULT:
            console.log(`${YELLOW}🔧 工具结果 [${message.payload.callId}]${RESET}`);
            break;
        case AgentMessageType.CODE_PATCH:
            console.log(`${YELLOW}📝 代码补丁:${RESET} ${message.payload.path}`);
            break;
        case AgentMessageType.USAGE_UPDATE:
            console.log(`${CYAN}📊 Token:${RESET} ${message.payload.usage.total_tokens}`);
            break;
        case AgentMessageType.ERROR:
            console.error(`❌ ${message.payload.error}`);
            break;
        case AgentMessageType.STATUS:
            console.log(`\n📋 状态: ${message.payload.state}`);
            break;
        default:
            break;
    }
}

/**
 * 示例: 使用 Agent-v2
 */
async function demo() {
    console.log('='.repeat(60));
    console.log('🤖 Agent-v2 Demo');
    console.log('='.repeat(60));
    console.log();

    const toolRegistry = new ToolRegistry({
        workingDirectory: process.cwd(),
    });
    toolRegistry.register([new BashTool()]);

    const memoryManager = createMemoryManager({
        type: 'file',
        connectionString: './data/agent-memory',
    });
    await memoryManager.initialize();

    try {
        const agent = new Agent({
            provider: ProviderRegistry.createFromEnv('glm-4.7'),
            systemPrompt: operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
            }),
            toolRegistry,
            stream: true,
            thinking: true,
            enableCompaction: true,
            memoryManager,
            streamCallback: handleStreamMessage,
        });

        const query = process.argv[2] || '你好，请介绍一下你自己';
        console.log(`${CYAN}❯${RESET} ${query}\n`);

        const response = await agent.execute(query);

        console.log('\n' + '='.repeat(60));
        console.log('📋 最终响应:');
        console.log('='.repeat(60));
        console.log(`会话 ID: ${agent.getSessionId()}`);
        console.log(`消息数: ${agent.getMessages().length}`);
        if (response.usage) {
            console.log(`Token 使用: ${response.usage.total_tokens}`);
        }

    } finally {
        await memoryManager.close();
    }
}

// 导出
export { demo };

// 如果直接运行此文件，执行 demo
if (require.main === module) {
    demo().catch(console.error);
}
