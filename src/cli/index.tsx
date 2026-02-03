/**
 * CLI Entry Point
 *
 * Ink-based implementation of CLI with the same architecture as planned
 */

import React from 'react';
import { render } from 'ink';
import App from './app';
import dotenv from 'dotenv';
import { AppContextProvider } from './context/app';
import { KeyboardManager } from './context/keyboard';

// Load env early so all routes can read AI_MODEL 等配置
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}`, override: true });

// ============================================================================
// TTY Check
// ============================================================================

// Check if we have an interactive terminal
const hasTTY = process.stdin.isTTY || process.stdout.isTTY;

if (!hasTTY) {
  console.error('\n❌ Error: This CLI requires an interactive terminal (TTY).\n');
  console.error('Please run this command directly in your terminal:');
  console.error('  pnpm dev:cli\n');
  console.error('Do NOT run it through:');
  console.error('  - IDE run buttons (unless configured for integrated terminal)');
  console.error('  - Piped commands (|)');
  console.error('  - Backgrounded processes (&)\n');
  process.exit(1);
}

// ============================================================================
// Error Handling
// ============================================================================

// 改进的错误处理 - 记录错误但不立即退出
let hasFatalError = false;

const handleFatalError = (error: Error, source: string) => {
  // 防止重复输出
  if (hasFatalError) return;
  hasFatalError = true;

  console.error(`\n${'='.repeat(50)}`);
  console.error(`❌ Fatal Error (${source}):`);
  console.error(`${'='.repeat(50)}`);
  console.error(error.message);

  if (error.stack) {
    // 只显示相关的堆栈信息
    const stackLines = error.stack.split('\n').slice(1, 6);
    console.error('\nStack trace:');
    stackLines.forEach(line => console.error(line));
  }

  console.error(`\n${'='.repeat(50)}`);
  console.error('The CLI will now exit due to a fatal error.');
  console.error(`${'='.repeat(50)}\n`);

  // 延迟退出，让用户看到错误信息
  setTimeout(() => {
    // process.exit(1);
  }, 1000000);
};

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  handleFatalError(error as Error, 'Uncaught Exception');
});

// 处理未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, _promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  handleFatalError(error, 'Unhandled Promise Rejection');
});

// ============================================================================
// Signal Handling for Graceful Shutdown
// ============================================================================

const shutdown = (_signal: string) => {
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================================================
// Render Application
// ============================================================================

// Set terminal title
process.title = 'Coding Agent CLI';

// Render the app and wait until exit
// Use patchConsole: false to avoid interfering with input methods
const { waitUntilExit } = render(
  <AppContextProvider>
    <KeyboardManager>
      <App />
    </KeyboardManager>
  </AppContextProvider>,
  {
    patchConsole: false,
    exitOnCtrlC: false,  // Let us handle Ctrl+C ourselves
  }
);
waitUntilExit();
