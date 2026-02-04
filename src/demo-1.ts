import dotenv from 'dotenv';
import { Agent } from './agent-v2/agent/agent';
import { ToolRegistry } from './agent-v2/tool/registry';
import BashTool from './agent-v2/tool/bash';
import { ProviderRegistry } from './providers';
import { EventType } from './agent-v2/eventbus';

import fs from 'fs';
import { AgentMessage, AgentMessageType } from './agent-v2/agent/stream-types';

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

    const agent = new Agent({
        provider: ProviderRegistry.createFromEnv('glm-4.7'),
        systemPrompt: '你是一个智能助手,现在系统环境是windows系统',
        toolRegistry,
        stream: true,
        // 只需设置这一个回调，就能获取所有信息
        streamCallback: handleStreamMessage,
    });

    // EventBus 仍然可用，用于其他监听场景（如日志记录）
    agent.on(EventType.TASK_START, (data) => {
        // 可以在这里添加额外的日志记录
    });

    const response = await agent.execute('当前目录有什么');
    console.log('\n\n最终响应:', response);

    fs.writeFileSync('./demo-1.json', JSON.stringify(agent.getMessages(), null, 2));
}

demo1();