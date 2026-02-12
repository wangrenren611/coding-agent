#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import dotenv from 'dotenv';
import { App } from './app.js';

dotenv.config({ path: './.env.development' });

process.on('uncaughtException', (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`\n[agent-cli-v2] Uncaught exception:\n${message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error(`\n[agent-cli-v2] Unhandled rejection:\n${message}`);
  process.exit(1);
});

function main(): void {
  if (!process.stdout.isTTY) {
    console.error('agent-cli-v2 requires a TTY terminal.');
    process.exit(1);
  }

  // Clear screen
  process.stdout.write('\x1b[2J\x1b[H');

  render(React.createElement(App));
}

main();
