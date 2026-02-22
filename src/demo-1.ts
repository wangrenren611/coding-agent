import dotenv from 'dotenv';
import { Agent } from './agent-v2/agent/agent';
import { ToolRegistry } from './agent-v2/tool/registry';
import BashTool from './agent-v2/tool/bash';
import { ProviderRegistry } from './providers';
import { EventType } from './agent-v2/eventbus';

import fs from 'fs';
import { AgentMessage, AgentMessageType } from './agent-v2/agent/stream-types';
import { createMemoryManager } from './agent-v2';
import { operatorPrompt } from './agent-v2/prompts/operator';

dotenv.config({
    path: './.env.development',
});

// ANSI 颜色
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// 状态追踪
let isReasoning = false;
let isTexting = false;

/**
 * 统一流式消息处理 - 支持推理内容显示
 */
function handleStreamMessage(message: AgentMessage) {
    switch (message.type) {
        // ==================== 推理/思考内容 (thinking 模式) ====================
        case AgentMessageType.REASONING_START:
            isReasoning = true;
            process.stdout.write(`${GRAY}┌─ 💭 思考过程${RESET}\n`);
            process.stdout.write(`${GRAY}│${RESET} `);
            break;

        case AgentMessageType.REASONING_DELTA:
            process.stdout.write(message.payload.content);
            break;

        case AgentMessageType.REASONING_COMPLETE:
            isReasoning = false;
            process.stdout.write('\n');
            process.stdout.write(`${GRAY}└─ 思考完成${RESET}\n\n`);
            break;

        // ==================== 正式文本回复 ====================
        case AgentMessageType.TEXT_START:
            isTexting = true;
            process.stdout.write(`${GREEN}┌─ 🤖 回复${RESET}\n`);
            process.stdout.write(`${GREEN}│${RESET} `);
            break;

        case AgentMessageType.TEXT_DELTA:
            process.stdout.write(message.payload.content);
            break;

        case AgentMessageType.TEXT_COMPLETE:
            isTexting = false;
            process.stdout.write('\n');
            process.stdout.write(`${GREEN}└─ 回复完成${RESET}\n`);
            break;

        // ==================== 工具调用 ====================
        case AgentMessageType.TOOL_CALL_CREATED:
            const tools = message.payload.tool_calls.map((call) => 
                `${call.toolName}(${call.args.slice(0, 50)}${call.args.length > 50 ? '...' : ''})`
            );
            process.stdout.write('\n');
            console.log(`${YELLOW}🔧 工具调用:${RESET}`, tools.join(', '));
            break;

        case AgentMessageType.TOOL_CALL_STREAM:
            // 工具执行中的流式输出（如终端输出）
            if (message.payload.output) {
                process.stdout.write(`${GRAY}${message.payload.output}${RESET}`);
            }
            break;

        case AgentMessageType.TOOL_CALL_RESULT:
            const status = message.payload.status === 'success' ? '✅' : '❌';
            const resultPreview = typeof message.payload.result === 'string' 
                ? message.payload.result.slice(0, 100)
                : JSON.stringify(message.payload.result).slice(0, 100);
            console.log(`${status} 工具结果 [${message.payload.callId}]:`, resultPreview);
            break;

        // ==================== 状态更新 ====================
        case AgentMessageType.STATUS:
            const state = message.payload.state;
            const statusIcons: Record<string, string> = {
                'idle': '⏸️',
                'thinking': '🤔',
                'running': '▶️',
                'completed': '✅',
                'failed': '❌',
                'aborted': '🛑',
                'retrying': '🔄',
            };
            const icon = statusIcons[state] || '📋';
            console.log(`\n${icon} 状态: ${state}${message.payload.message ? ` - ${message.payload.message}` : ''}`);
            break;

        // ==================== Token 使用量更新 ====================
        case AgentMessageType.USAGE_UPDATE:
            const usage = message.payload.usage;
            const cumulative = message.payload.cumulative;
            const cyan = '\x1b[36m';
            const dim = '\x1b[2m';
            
            // 显示当前请求的使用量
            process.stdout.write('\n');
            console.log(
                `${dim}📊 Token 使用: ` +
                `${cyan}${usage.total_tokens}${RESET} ` +
                `(输入: ${usage.prompt_tokens}, 输出: ${usage.completion_tokens})` +
                (cumulative ? ` | 累计: ${cumulative.total_tokens}` : '')
            );
            break;

        // ==================== 错误处理 ====================
        case AgentMessageType.ERROR:
            console.error(`\n❌ 错误: ${message.payload.error}`);
            if (message.payload.phase) {
                console.error(`   阶段: ${message.payload.phase}`);
            }
            break;

        // ==================== 代码补丁 ====================
        case AgentMessageType.CODE_PATCH:
            console.log(`\n📝 代码变更: ${message.payload.path}`);
            if (message.payload.language) {
                console.log(`   语言: ${message.payload.language}`);
            }
            break;

        default:
            // 未处理的消息类型，可以选择忽略或记录
            break;
    }
}

async function demo1() {
    console.log('='.repeat(60));
    console.log('🤖 Agent Demo - 支持 Thinking 模式');
    console.log('='.repeat(60));
    console.log();

    const toolRegistry = new ToolRegistry({
        workingDirectory: process.cwd(),
    });

    toolRegistry.register([
        new BashTool(),
    ]);

    const preferredMemoryPath = './data/agent-memory';
    const fallbackMemoryPath = '.memory/agent-memory';
    let memoryPath = preferredMemoryPath;

    try {
        fs.mkdirSync(preferredMemoryPath, { recursive: true });
        fs.accessSync(preferredMemoryPath, fs.constants.W_OK);
    } catch {
        memoryPath = fallbackMemoryPath;
        fs.mkdirSync(memoryPath, { recursive: true });
        console.warn(`[demo1] 存储目录不可写，已回退到: ${memoryPath}`);
    }

    const memoryManager = createMemoryManager({
        type: 'file',
        connectionString: memoryPath,
    });

    await memoryManager.initialize();

    let agent: Agent | undefined;
    try {
        agent = new Agent({
            provider: ProviderRegistry.createFromEnv('glm-5',{
                timeout: 1000*60*3,
            }),
            systemPrompt: operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
            }),
            // 如需恢复会话，请取消注释并填入有效 sessionId
           sessionId: 'agent-2',
            stream: true,
            thinking: true,  // 启用 thinking 模式，支持推理内容
            enableCompaction: true,  // 启用上下文压缩
            // sessionId: '063347b3-d379-4d0b-8674-d65a1936a469',
            compactionConfig: {
                keepMessagesNum: 40,    // 保留最近 40 条消息
                triggerRatio: 0.90,     // Token 使用达 90% 时触发压缩
            },
            memoryManager,
            streamCallback: handleStreamMessage,
        });

        // EventBus 监听重试事件
        agent.on(EventType.TASK_RETRY, (data) => {
            console.log('🔄 任务重试中:', data);
        });

        // 执行查询
        const query = process.argv[2] || '你好，请介绍一下你自己';
        console.log(`${CYAN}❯${RESET} ${query}\n`);

        const response = await agent.execute(query);

        console.log('\n' + '='.repeat(60));
        console.log('📋 最终响应:');
        console.log('='.repeat(60));
        console.log(`角色: ${response.role}`);
        console.log(`类型: ${response.type}`);
        if (response.finish_reason) {
            console.log(`结束原因: ${response.finish_reason}`);
        }
        if (response.usage) {
            console.log(`Token 使用: prompt=${response.usage.prompt_tokens}, completion=${response.usage.completion_tokens}, total=${response.usage.total_tokens}`);
        }

        // 输出会话信息
        console.log('\n' + '='.repeat(60));
        console.log('📋 会话信息:');
        console.log('='.repeat(60));
        console.log(`会话 ID: ${agent.getSessionId()}`);
        console.log(`消息数: ${agent.getMessages().length}`);


    } catch (error) {
        console.error('\n❌ demo1 执行失败:', error);
        if (agent) {
            fs.writeFileSync('./demo-1.error.messages.json', JSON.stringify(agent.getMessages(), null, 2));
        }
        process.exitCode = 1;
    } finally {
        await memoryManager.close();
    }
}

demo1().catch((error) => {
    console.error('❌ demo1 未捕获异常:', error);
    process.exit(1);
});
