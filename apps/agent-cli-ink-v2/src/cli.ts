/**
 * Agent CLI v2 - 一个现代化的 AI 编码助手 CLI
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import dotenv from 'dotenv';
import chalk from 'chalk';
import cliWidth from 'cli-width';
import wrapAnsi from 'wrap-ansi';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { Agent } from '../../../src/agent-v2/agent/agent.js';
import { operatorPrompt } from '../../../src/agent-v2/prompts/operator.js';
import { ProviderRegistry } from '../../../src/providers/registry.js';
import { createMemoryManager } from '../../../src/agent-v2/memory/index.js';
import type { AgentMessage } from '../../../src/agent-v2/agent/stream-types.js';

dotenv.config({ path: './.env.development' });

const VERSION = '0.2.0';

interface Config {
  model: string;
  language: string;
  maxHistory: number;
  showTokens: boolean;
  streamOutput: boolean;
}

const defaultConfig: Config = {
  model: 'glm-5',
  language: 'Chinese',
  maxHistory: 100,
  showTokens: true,
  streamOutput: true,
};

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: number;
}

interface AppState {
  config: Config;
  messages: Message[];
  isExecuting: boolean;
  streamingContent: string;
  streamingLines: number;
  tokenUsage: { total: number } | null;
  startTime: number | null;
  sessionId: string;
}

const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const getWidth = () => cliWidth() || 80;
const stripAnsi = (str: string): string => str.replace(/\x1b\[[0-9;]*m/g, '');
const wrapText = (text: string, width: number = getWidth() - 4) => 
  wrapAnsi(text, width, { hard: true, trim: false });

marked.setOptions({
  renderer: new TerminalRenderer({ width: getWidth() - 4, reflowText: true, tab: 2 }),
});

const renderMarkdown = (text: string): string => {
  try { return marked(text) as string; } catch { return text; }
};

const formatTime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const formatTimestamp = (ts: number): string => 
  new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

const clearLines = (n: number) => { if (n > 0) process.stdout.write(`\x1b[${n}F\x1b[0J`); };

// Spinner
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIndex = 0;
let spinnerInterval: ReturnType<typeof setInterval> | null = null;

const startSpinner = (text: string = '处理中') => {
  if (spinnerInterval) clearInterval(spinnerInterval);
  spinnerIndex = 0;
  spinnerInterval = setInterval(() => {
    process.stdout.write(`\r\x1b[2K${chalk.cyan(spinnerFrames[spinnerIndex])} ${chalk.gray(text)}...`);
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
  }, 80);
};

const stopSpinner = () => {
  if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
  process.stdout.write('\r\x1b[2K');
};

const divider = () => chalk.gray('─'.repeat(getWidth()));

const renderStatusBar = (state: AppState) => {
  const parts = [
    chalk.blue(`🤖 ${state.config.model}`),
    state.tokenUsage ? chalk.gray(`📊 ${state.tokenUsage.total} tokens`) : '',
    state.startTime && state.isExecuting ? chalk.gray(`⏱ ${formatTime(Date.now() - state.startTime)}`) : '',
    chalk.gray(`💬 ${state.messages.length}`),
    state.isExecuting ? chalk.green('● 运行中') : chalk.gray('○ 就绪'),
  ].filter(Boolean);
  
  console.log();
  console.log(divider());
  console.log(` ${parts.join(chalk.gray(' │ '))}`);
  console.log(divider());
};

const showWelcome = (state: AppState) => {
  console.log();
  console.log(chalk.bold.cyan('╔═══════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║       🤖 Agent CLI v2 - AI 编码助手                ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════╝'));
  console.log();
  console.log(`  ${chalk.gray('模型:')} ${chalk.cyan(state.config.model)}`);
  console.log(`  ${chalk.gray('语言:')} ${state.config.language}`);
  console.log(`  ${chalk.gray('目录:')} ${chalk.gray(process.cwd())}`);
  console.log();
  console.log(chalk.gray('  输入消息开始对话，或输入 /help 查看命令'));
  console.log(chalk.gray('  按 Ctrl+C 退出'));
  console.log();
  console.log(divider());
};

const renderUserMessage = (content: string, timestamp: number) => {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold.cyan('你')} ${chalk.gray(formatTimestamp(timestamp))}`);
  wrapText(content).split('\n').forEach(line => console.log(`${chalk.cyan('│')} ${line}`));
  console.log(chalk.cyan('└'));
  console.log();
};

const renderError = (message: string) => {
  console.log();
  console.log(chalk.red('┌─ ✗ 错误'));
  console.log(chalk.red('│'), chalk.red(message));
  console.log(chalk.red('└'));
  console.log();
};

// Commands
const commands: Record<string, { description: string; usage?: string; action: (args: string[], state: AppState) => void }> = {
  '/help': {
    description: '显示帮助信息',
    action: () => {
      console.log();
      console.log(chalk.bold('📋 可用命令：'));
      console.log();
      Object.entries(commands).forEach(([cmd, info]) => {
        console.log(`  ${chalk.cyan(cmd.padEnd(12))} ${chalk.gray(info.description)}`);
      });
      console.log();
    },
  },
  '/clear': {
    description: '清空对话',
    action: (_args, state) => {
      state.messages = [];
      state.tokenUsage = null;
      console.log(chalk.gray('✓ 已清空'));
    },
  },
  '/model': {
    description: '切换模型',
    usage: '/model [名称]',
    action: (args, state) => {
      if (args.length === 0) {
        console.log(`当前模型: ${chalk.cyan(state.config.model)}`);
      } else {
        state.config.model = args[0];
        console.log(chalk.gray(`✓ 已切换: ${chalk.cyan(args[0])}`));
      }
    },
  },
  '/history': {
    description: '显示历史',
    action: (_args, state) => {
      if (state.messages.length === 0) {
        console.log(chalk.gray('暂无历史'));
        return;
      }
      console.log();
      state.messages.slice(-10).forEach(msg => {
        const label = msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : '错误';
        console.log(`${chalk.gray(formatTimestamp(msg.timestamp))} ${label}: ${msg.content.slice(0, 50)}...`);
      });
      console.log();
    },
  },
  '/config': {
    description: '显示配置',
    action: (_args, state) => {
      console.log();
      Object.entries(state.config).forEach(([k, v]) => console.log(`  ${chalk.cyan(k)}: ${v}`));
      console.log();
    },
  },
  '/save': {
    description: '保存对话',
    usage: '/save [文件名]',
    action: (args, state) => {
      const filename = args[0] || `chat-${Date.now()}.txt`;
      let content = `对话记录 - ${new Date().toLocaleString()}\n${'='.repeat(40)}\n\n`;
      state.messages.forEach(msg => {
        content += `[${formatTimestamp(msg.timestamp)}] ${msg.role}:\n${msg.content}\n\n`;
      });
      fs.writeFileSync(path.resolve(filename), content);
      console.log(chalk.gray(`✓ 已保存: ${filename}`));
    },
  },
  '/exit': {
    description: '退出',
    action: () => { console.log(chalk.gray('\n再见！👋')); process.exit(0); },
  },
  '/reset': {
    description: '重置会话',
    action: (_args, state) => {
      state.messages = [];
      state.tokenUsage = null;
      state.sessionId = generateId();
      console.log(chalk.gray('✓ 已重置'));
    },
  },
};

const parseCommand = (input: string): { command: string; args: string[] } | null => {
  if (!input.trim().startsWith('/')) return null;
  const parts = input.trim().split(/\s+/);
  return { command: parts[0].toLowerCase(), args: parts.slice(1) };
};

async function main() {
  const state: AppState = {
    config: { ...defaultConfig },
    messages: [],
    isExecuting: false,
    streamingContent: '',
    streamingLines: 0,
    tokenUsage: null,
    startTime: null,
    sessionId: generateId(),
  };

  const args = process.argv.slice(2);
  const modelArg = args.find(a => !a.startsWith('-'));
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\nAgent CLI v2 - AI 编码助手\n');
    console.log('用法: agent-v2 [模型] [选项]\n');
    console.log('选项: -h, --help 帮助; -v, --version 版本\n');
    process.exit(0);
  }
  
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`agent-v2 v${VERSION}`);
    process.exit(0);
  }
  
  if (modelArg) state.config.model = modelArg;

  const memoryManager = createMemoryManager({ type: 'file', connectionString: './data/agent-memory-v2' });
  await memoryManager.initialize();

  const agent = new Agent({
    provider: ProviderRegistry.createFromEnv(state.config.model as never),
    systemPrompt: operatorPrompt({ directory: process.cwd(), language: state.config.language }),
    stream: true,
    enableCompaction: true,  // 启用上下文压缩
    compactionConfig: {
      keepMessagesNum: 40,
      triggerRatio: 0.90,
    },
    memoryManager,
    streamCallback: (message: AgentMessage) => {
      switch (message.type) {
        case 'status':
          if (message.payload.state === 'thinking') startSpinner('思考中');
          else if (['completed', 'failed'].includes(message.payload.state)) stopSpinner();
          break;
        case 'text-start':
          stopSpinner();
          state.streamingContent = '';
          state.streamingLines = 0;
          console.log(`${chalk.green('┌─')} ${chalk.bold.green('AI')} ${chalk.gray(formatTimestamp(Date.now()))}`);
          break;
        case 'text-delta':
          state.streamingContent += message.payload.content;
          if (state.config.streamOutput) {
            clearLines(state.streamingLines);
            const lines = wrapText(state.streamingContent).split('\n');
            lines.forEach(l => console.log(`${chalk.green('│')} ${l}`));
            state.streamingLines = lines.length;
          }
          break;
        case 'text-complete':
          clearLines(state.streamingLines);
          renderMarkdown(state.streamingContent).split('\n').forEach(l => console.log(`${chalk.green('│')} ${l}`));
          console.log(chalk.green('└'));
          console.log();
          state.messages.push({ id: generateId(), role: 'assistant', content: state.streamingContent, timestamp: Date.now() });
          state.streamingContent = '';
          state.streamingLines = 0;
          break;
        case 'error':
          stopSpinner();
          renderError(message.payload.error);
          state.messages.push({ id: generateId(), role: 'error', content: message.payload.error, timestamp: Date.now() });
          break;
      }
    },
  });
  
  state.sessionId = agent.getSessionId();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, historySize: state.config.maxHistory });

  showWelcome(state);

  const prompt = () => {
    renderStatusBar(state);
    rl.question(chalk.cyan('❯ '), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { prompt(); return; }

      const parsed = parseCommand(trimmed);
      if (parsed) {
        const cmd = commands[parsed.command];
        if (cmd) cmd.action(parsed.args, state);
        else console.log(chalk.red(`未知命令: ${parsed.command}`), chalk.gray('输入 /help'));
        prompt();
        return;
      }

      state.isExecuting = true;
      state.startTime = Date.now();
      renderUserMessage(trimmed, Date.now());
      state.messages.push({ id: generateId(), role: 'user', content: trimmed, timestamp: Date.now() });

      try {
        await agent.execute(trimmed);
      } catch (err) {
        stopSpinner();
        renderError(err instanceof Error ? err.message : String(err));
      } finally {
        state.isExecuting = false;
        state.startTime = null;
      }
      prompt();
    });
  };

  prompt();
  rl.on('close', () => { stopSpinner(); console.log(chalk.gray('\n再见！👋')); process.exit(0); });
}

process.on('uncaughtException', (err) => { console.error(chalk.red('\n异常:'), err); process.exit(1); });
main().catch((err) => { console.error(chalk.red('启动失败:'), err); process.exit(1); });
