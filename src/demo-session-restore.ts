import dotenv from 'dotenv';
import { Agent, createMemoryManager } from './agent-v2';
import { ProviderRegistry } from './providers';
import { ToolRegistry } from './agent-v2/tool/registry';
import BashTool from './agent-v2/tool/bash';

dotenv.config({ path: './.env.development' });

/**
 * 演示：使用 sessionId 恢复已有会话
 *
 * 使用方式：
 * 1. 第一次运行：不传入 sessionId，创建新会话
 * 2. 查看控制台输出的 sessionId
 * 3. 第二次运行：将 sessionId 填入代码，恢复会话继续对话
 */

const SESSION_ID = process.env.SESSION_ID || undefined; // 填入已有 sessionId 来恢复会话

async function demo() {
  const memoryManager = createMemoryManager({
    type: 'file',
    connectionString: './data/agent-memory',
  });

  await memoryManager.initialize();

  // 查看所有已有会话
  const sessions = await memoryManager.querySessions({ status: 'active' });
  console.log('\n=== 已有会话列表 ===');
  for (const session of sessions) {
    console.log(`Session ID: ${session.sessionId}`);
    console.log(`  消息数: ${session.totalMessages}`);
    console.log(`  压缩次数: ${session.compactionCount}`);
    console.log(`  最后更新: ${new Date(session.updatedAt).toLocaleString()}`);
  }
  console.log('===================\n');

  // 创建工具注册表
  const toolRegistry = new ToolRegistry({
    workingDirectory: process.cwd(),
  });
  toolRegistry.register([new BashTool()]);

  // 创建 Agent
  const agent = new Agent({
    provider: ProviderRegistry.createFromEnv('glm-4.7'),
    systemPrompt: '你是一个智能助手，记得之前的对话内容',
    toolRegistry,
    stream: true,
    memoryManager,
    sessionId: SESSION_ID, // 传入 sessionId 恢复会话
    streamCallback: (message) => {
      if (message.type === 'text-delta') {
        process.stdout.write(message.payload.content);
      }
    },
  });

  console.log(`当前会话 ID: ${agent.getSessionId()}`);
  console.log('\n--- 当前上下文消息 ---');
  const messages = agent.getMessages();
  messages.forEach((msg, i) => {
    console.log(`${i}. [${msg.role}] ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
  });
  console.log('---------------------\n');

  // 继续对话
  const query = process.argv[2] || '你还记得我们刚才聊了什么吗？';
  console.log(`用户: ${query}\n`);
  console.log('助手: ');

  await agent.execute(query);

  console.log('\n\n--- 对话后的消息 ---');
  const newMessages = agent.getMessages();
  console.log(`总消息数: ${newMessages.length}`);

  // 关闭
  await memoryManager.close();
}

demo().catch(console.error);
