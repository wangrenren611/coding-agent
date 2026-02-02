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

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ============================================================================
// Signal Handling for Graceful Shutdown
// ============================================================================

const shutdown = (signal: string) => {
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
const { waitUntilExit } = render(
  <AppContextProvider>
    <KeyboardManager>
      <App />
    </KeyboardManager>
  </AppContextProvider>
);
waitUntilExit();
