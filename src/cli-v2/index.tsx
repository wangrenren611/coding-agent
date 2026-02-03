import React from 'react';
import { render } from 'ink';
import dotenv from 'dotenv';
import { App } from './app';
import { runPlain } from './plain';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}`, override: true });

const hasTTY = process.stdin.isTTY || process.stdout.isTTY;
const usePlain = process.argv.includes('--plain') || process.argv.includes('--scrollback');

if (!hasTTY) {
  console.error('\nError: This CLI requires an interactive terminal (TTY).\n');
  console.error('Run: pnpm dev:cli');
  process.exit(1);
}

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

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

process.title = 'Coding Agent CLI';

if (usePlain) {
  runPlain();
} else {
  const { waitUntilExit } = render(<App />, {
    patchConsole: false,
    exitOnCtrlC: false,
  });

  waitUntilExit();
}
