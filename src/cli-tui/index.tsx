/**
 * cli-tui Entry Point
 * OpenTUI-based AI Coding Agent CLI
 */

import dotenv from 'dotenv';
import { main } from './app';

const DEFAULT_ROWS = 40;
const DEFAULT_COLS = 120;

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const applyTerminalPreset = (hasTTY: boolean): void => {
  if (!hasTTY) return;
  if (process.env.CLI_TUI_LOCK_WINDOW === '0') return;

  const rows = toPositiveInt(process.env.CLI_TUI_ROWS, DEFAULT_ROWS);
  const cols = toPositiveInt(process.env.CLI_TUI_COLS, DEFAULT_COLS);

  // Resize terminal window (supported by iTerm2/Terminal.app and many xterm-compatible terminals)
  process.stdout.write(`\x1b[8;${rows};${cols}t`);

  // Clear screen + scrollback to reduce native scrollbar history before entering TUI alternate screen.
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
};

// Load environment variables
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}`, override: true, quiet: true });

// Check for TTY (Windows-specific handling)
// On Windows, isTTY may be undefined - check for truthy value
const hasTTY = (process.stdin.isTTY ?? false) || (process.stdout.isTTY ?? false);

if (!hasTTY) {
  console.warn('\nWarning: No TTY detected. Running in non-interactive mode.');
  console.warn('For interactive input, run in a proper terminal.\n');
}

// applyTerminalPreset(hasTTY);

// Error handling
let hasFatalError = false;

const handleFatalError = (error: Error, source: string) => {
  if (hasFatalError) return;
  hasFatalError = true;

  console.error(`\n[${source}] ${error.message}`);
  if (error.stack) {
    const stackLines = error.stack.split('\n').slice(1, 6);
    console.error(stackLines.join('\n'));
  }

  setTimeout(() => {
    process.exit(1);
  }, 200);
};

process.on('uncaughtException', (error) => handleFatalError(error as Error, 'uncaughtException'));
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  handleFatalError(error, 'unhandledRejection');
});

// Note: SIGINT/SIGTERM handlers are disabled to avoid interfering with keyboard input
// The app uses Ctrl+C via renderer or keyHandler for exit

process.title = 'AI Coding Agent (OpenTUI)';

// Start the application
main().catch(error => {
  handleFatalError(error, 'main');
});
