/**
 * MemoryManager 使用示例
 */

import { createMemoryManager, FileMemoryManager } from './index';
import { Agent } from '../agent/agent';
import { LLMProvider } from '../../providers';

/**
 * 示例 1: 创建 FileMemoryManager 并初始化
 */
async function example1() {
  // 创建基于文件的存储
  const memoryManager = createMemoryManager({
    type: 'file',
    connectionString: './data/memory',
    config: {
      autoSave: true,
      saveInterval: 5000, // 每5秒自动保存
    },
  });

  // 初始化
  await memoryManager.initialize();

  // 查询现有会话，确认存储可读
  const sessions = await memoryManager.querySessions({}, { limit: 1 });
  console.log('Storage ready, existing sessions:', sessions.length);

  // 关闭
  await memoryManager.close();
}

/**
 * 示例 2: 使用 MemoryManager 创建支持持久化的 Agent
 */
async function example2(provider: LLMProvider) {
  // 创建 MemoryManager
  const memoryManager = createMemoryManager({
    type: 'file',
    connectionString: './data/agent-memory',
  });

  await memoryManager.initialize();

  // 创建 Agent，传入 memoryManager
  const agent = new Agent({
    provider,
    systemPrompt: 'You are a helpful assistant.',
    memoryManager, // 启用持久化存储
    stream: true,
    streamCallback: (message) => {
      console.log('Stream:', message);
    },
  });

  // 执行对话 - 消息会自动持久化
  await agent.execute('Hello, how are you?');

  // 关闭时保存数据
  await memoryManager.close();
}

/**
 * 示例 3: 恢复已有会话
 */
async function example3(provider: LLMProvider, sessionId: string) {
  const memoryManager = createMemoryManager({
    type: 'file',
    connectionString: './data/agent-memory',
  });

  await memoryManager.initialize();

  // 创建 Agent 时传入已有 sessionId
  const agent = new Agent({
    provider,
    systemPrompt: 'You are a helpful assistant.',
    memoryManager,
    sessionId, // 恢复已有会话
  });

  // 继续之前的对话
  await agent.execute('Continue from where we left off.');

  await memoryManager.close();
}

/**
 * 示例 4: 任务数据存储
 */
async function example4() {
  const memoryManager = createMemoryManager({
    type: 'file',
    connectionString: './data/tasks',
  });

  await memoryManager.initialize();

  // 保存任务
  await memoryManager.saveTask({
    id: 'task-001',
    taskId: 'task-001',
    sessionId: 'session-001',
    title: 'Implement feature X',
    description: 'Need to implement feature X in module Y',
    status: 'in_progress',
    metadata: {
      priority: 'high',
      assignee: 'developer-1',
    },
  });

  // 查询任务
  const tasks = await memoryManager.queryTasks(
    { sessionId: 'session-001', status: 'in_progress' },
    { limit: 10, orderBy: 'updatedAt', orderDirection: 'desc' }
  );

  console.log('Tasks:', tasks);

  // 更新任务状态
  const task = await memoryManager.getTask('task-001');
  if (task) {
    await memoryManager.saveTask({
      ...task,
      status: 'completed',
      result: { success: true },
    });
  }

  await memoryManager.close();
}

/**
 * 示例 5: 扩展 MemoryManager 实现数据库存储
 */
class SQLiteMemoryManager {
  // 实现 IMemoryManager 接口
  // 使用 SQLite 作为后端存储
}

/**
 * 示例 6: 查询历史会话
 */
async function example6() {
  const memoryManager = createMemoryManager({
    type: 'file',
    connectionString: './data/agent-memory',
  });

  await memoryManager.initialize();

  // 查询最近10个会话
  const sessions = await memoryManager.querySessions(
    {},
    { limit: 10, orderBy: 'updatedAt', orderDirection: 'desc' }
  );

  for (const session of sessions) {
    console.log(`Session ${session.sessionId}:`);
    console.log(`  Total messages: ${session.totalMessages}`);
    console.log(`  Last updated: ${new Date(session.updatedAt).toISOString()}`);
  }

  await memoryManager.close();
}

export {
  example1,
  example2,
  example3,
  example4,
  example6,
};
