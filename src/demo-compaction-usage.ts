/**
 * 演示：Usage 在压缩中的使用
 *
 * 压缩会根据消息中的 usage 数据来判断是否达到阈值
 */

import dotenv from 'dotenv';
import { Agent, createMemoryManager } from './agent-v2';
import { ProviderRegistry } from './providers';
import type { Message } from './agent-v2/session/types';

dotenv.config({ path: './.env.development' });

async function demo() {
    const memoryManager = createMemoryManager({
        type: 'file',
        connectionString: './data/compaction-demo',
    });

    await memoryManager.initialize();

    // 创建启用了压缩的 Agent
    const provider = ProviderRegistry.createFromEnv('glm-4.7');
    const agent = new Agent({
        provider,
        systemPrompt: '你是一个智能助手',
        memoryManager,
        sessionId: '7fe1f1cd-fc93-4133-aa66-bcc850f7686c',
        enableCompaction: true,
        compactionConfig: {
            maxTokens: 4000,        // 设置较低的阈值以便演示
            maxOutputTokens: 1000,
            keepMessagesNum: 10,
            triggerRatio: 0.8,      // 80% 触发
        },
        stream: true,
        streamCallback: (msg) => {
            if (msg.type === 'text-delta') {
                process.stdout.write(msg.payload.content);
            }
        },
    });

    console.log('=== 开始对话 ===\n');

    // 第一轮对话
    console.log('用户: 你好，请介绍自己\n');
    console.log('助手: ');
    await agent.execute('你好，请介绍自己');
    console.log('\n');

    // 查看当前 Token 使用情况
    const messages1 = agent.getMessages();
    console.log('--- 当前消息统计 ---');
    printUsageStats(messages1);

    // 第二轮对话
    console.log('\n用户: 请详细解释什么是人工智能\n');
    console.log('助手: ');
    await agent.execute('请详细解释什么是人工智能，包括机器学习、深度学习等领域');
    console.log('\n');

    const messages2 = agent.getMessages();
    console.log('--- 当前消息统计 ---');
    printUsageStats(messages2);

    // 第三轮对话 - 可能触发压缩
    console.log('\n用户: 请写一个长故事\n');
    console.log('助手: ');
    await agent.execute('请写一个关于程序员的1000字故事');
    console.log('\n');

    const messages3 = agent.getMessages();
    console.log('--- 当前消息统计 ---');
    printUsageStats(messages3);
    console.log(`消息数量: ${messages3.length}`);

    // 查看压缩记录
    const sessionId = agent.getSessionId();
    const records = await memoryManager.getCompactionRecords(sessionId);
    console.log(`\n=== 压缩记录 (${records.length} 次) ===`);
    for (const record of records) {
        console.log(`\n压缩时间: ${new Date(record.compactedAt).toLocaleString()}`);
        console.log(`消息数变化: ${record.messageCountBefore} -> ${record.messageCountAfter}`);
        console.log(`归档消息数: ${record.archivedMessageIds.length}`);
        console.log(`原因: ${record.reason}`);
        if (record.metadata?.tokenCountBefore) {
            console.log(`Token 变化: ${record.metadata.tokenCountBefore} -> ${record.metadata.tokenCountAfter}`);
        }
    }

    // 查看完整历史
    const history = await memoryManager.getFullHistory({ sessionId });
    console.log(`\n=== 完整历史 (${history.length} 条消息) ===`);
    let totalTokens = 0;
    for (const msg of history) {
        if (msg.usage) {
            totalTokens += msg.usage.total_tokens;
        }
    }
    console.log(`累计 Token: ${totalTokens}`);

    await memoryManager.close();
}

function printUsageStats(messages: Message[]) {
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for (const msg of messages) {
        if (msg.usage) {
            totalTokens += msg.usage.total_tokens;
            promptTokens += msg.usage.prompt_tokens;
            completionTokens += msg.usage.completion_tokens;
        }
    }

    console.log(`消息数: ${messages.length}`);
    console.log(`Prompt Tokens: ${promptTokens}`);
    console.log(`Completion Tokens: ${completionTokens}`);
    console.log(`Total Tokens: ${totalTokens}`);
}

demo().catch(console.error);
