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

/**
 * 统一流式消息处理 - 只需监听这一个回调
 */
function handleStreamMessage(message: AgentMessage) {


    switch (message.type) {
        case AgentMessageType.TOOL_CALL_RESULT:
            console.log('工具调用结果:', `${message.payload.callId} ${message.payload.status} ${message.payload.result}`);
            break;
        case AgentMessageType.STATUS:
            console.log('任务状态更新:', message.payload.message);
            break;
        case AgentMessageType.TOOL_CALL_CREATED:
            console.log('工具调用创建:', message.payload.tool_calls.map((call) => `${call.toolName}(${call.args})`));
            break;
        case AgentMessageType.TEXT_START:
        case AgentMessageType.TEXT_DELTA:
        case AgentMessageType.TEXT_COMPLETE:
            process.stdout.write(message.payload.content);
            break;

        default:
            console.log('未知消息类型:', message.type);
            break;
    }
}

async function demo1() {
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
            provider: ProviderRegistry.createFromEnv('glm-4.7'),
            systemPrompt: operatorPrompt({
                directory: process.cwd(),
                language: 'Chinese',
            }),
        //    sessionId: '93a7eea8-c0b9-467a-81f9-a2ef0efbdfb0',
            stream: true,
            memoryManager,  // 传入 memoryManager 启用持久化
            // 只需设置这一个回调，就能获取所有信息
            streamCallback: handleStreamMessage,
        });

        // EventBus 仍然可用，用于其他监听场景（如日志记录）
        agent.on(EventType.TASK_START, (data) => {
            // 可以在这里添加额外的日志记录
        });

        const response = await agent.execute(`深度分析https://www.anthropic.com/engineering/multi-agent-research-system 这篇文章文章内容，中文输出详细md文档`);
        console.log('\n\n最终响应:', response);

        // 输出会话 ID，用于后续恢复会话
        console.log('\n===================');
        console.log('会话 ID:', agent.getSessionId());
        console.log('===================');
        console.log('提示: 使用以下命令恢复此会话继续对话:');
        console.log(`SESSION_ID=${agent.getSessionId()} npx ts-node src/demo-session-restore.ts`);
        console.log('===================\n');
        // await agent.execute('帮我看一下/Users/wrr/work/coding-agent/src/providers 目录实现了什么');
        console.log('\n===================');
        // console.log('会话 ID:', agent.getSessionId());
        console.log('===================');
        // await agent.execute('帮我看一下https://claude.com/blog/complete-guide-to-building-skills-for-claude 这个文章将了什么');
        console.log('\n===================');
        // console.log('会话 ID:', agent.getSessionId());
        console.log('===================');
        fs.writeFileSync('./demo-1.json', JSON.stringify(agent.getMessages(), null, 2));
    } catch (error) {
        console.error('demo1 执行失败:', error);
        if (agent) {
            fs.writeFileSync('./demo-1.error.messages.json', JSON.stringify(agent.getMessages(), null, 2));
        }
        process.exitCode = 1;
    } finally {
        // 关闭 memoryManager，确保数据保存
        await memoryManager.close();
    }
}

demo1().catch((error) => {
    console.error('demo1 未捕获异常:', error);
    process.exit(1);
});
