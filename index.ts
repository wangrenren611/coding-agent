/**
 * 主入口文件
 * 初始化并启动 AI Agent 应用
 * 支持从系统环境变量读取配置（类似 Claude Code）
 */
import { Agent } from './agent';
import {operatorPrompt} from './prompts/operator';
import { registerDefaultToolsAsync, ToolRegistry } from './tool';
import { ProviderRegistry, type ModelId } from './providers/registry';
import dotenv from 'dotenv';
dotenv.config({
    path: './.env.development',
});
/**
 * 创建并启动 Agent
 *
 * 配置优先级（类似 Claude Code）:
 * 1. 系统环境变量（ANTHROPIC_API_KEY, GLM_API_KEY 等）
 * 2. .env.development 或 .env.production 文件（通过 dotenv）
 * 3. 代码中的默认值
 */
async function main() {
   // 注意：不再强制加载 .env 文件
   // 直接使用系统环境变量（类似 Claude Code）
   // 如果需要 .env 文件支持，可以在 shell 中执行 source .env.development

   // console.log('[Agent] Initializing Agent...');
   // console.log('[Agent] Configuration source: System environment variables');



   // console.log('[Agent] Provider created successfully');

   await registerDefaultToolsAsync();
   // console.log('[Agent] Tools registered');


   const agent = new Agent({
       llmProvider: ProviderRegistry.createFromEnv('glm-4.7'),
       systemPrompt: operatorPrompt({
           directory: process.env.PROJECT_DIRECTORY || process.cwd(),
           vcs: process.env.VCS || 'git',
           language: process.env.PROJECT_LANGUAGE || '',
       }),
       temperature: 0.1,
       tools:ToolRegistry.getSchemas(),

   });

   await agent.start();
   // console.log('[Agent] Agent started');

   // 先注册所有事件监听器
   agent.on('stream-chunk', (message) => {
       if ('content' in message && typeof message.content === 'string') {
         process.stdout.write(message.content || '');
       }
   });

   agent.on('token-usage', (data) => {
       // console.log('\n[Token Usage] Used:', data.usedTokens, 'Total:', data.totalTokens);
   });

   // 再执行 agent.run
   agent.run('当前目录有什么',{
       stream:true,
   });
}

main().catch((error) => {
   // console.error('[Agent] Failed to start:', error);
   process.exit(1);
});
