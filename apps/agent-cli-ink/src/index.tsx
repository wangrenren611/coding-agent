#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import dotenv from "dotenv";
import { AgentChatProvider } from "../../../src/agent-chat-react";
import { App } from "./app";
import type { CliOptions } from "./types";

dotenv.config({ path: "./.env.development" });

function shouldEnableModifyOtherKeys(): boolean {
  const override = process.env.AGENT_CLI_ENABLE_MODIFY_OTHER_KEYS?.trim().toLowerCase();
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;

  const termProgram = process.env.TERM_PROGRAM;
  if (termProgram === "Apple_Terminal") return false;

  return termProgram === "iTerm.app"
    || termProgram === "vscode"
    || typeof process.env.WT_SESSION === "string";
}

function safeWriteAnsi(sequence: string): void {
  try {
    process.stdout.write(sequence);
  } catch {
    // Ignore terminal write failures during startup/teardown.
  }
}

process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`\n[agent-cli-ink] Uncaught exception:\n${message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error(`\n[agent-cli-ink] Unhandled rejection:\n${message}`);
  process.exit(1);
});

function parseOptions(argv: string[]): CliOptions {
  const defaults: CliOptions = {
    model: "glm-4.7",
    cwd: process.cwd(),
    language: "Chinese",
    keepLastMessages: 20,
  };

  const next = { ...defaults };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--model" && argv[index + 1]) next.model = argv[++index];
    if (token === "--cwd" && argv[index + 1]) next.cwd = argv[++index];
    if (token === "--language" && argv[index + 1]) next.language = argv[++index];
    if (token === "--keep" && argv[index + 1]) {
      const keep = Number(argv[++index]);
      if (Number.isFinite(keep) && keep > 0) next.keepLastMessages = Math.floor(keep);
    }
  }

  return next;
}

function main(): void {
  if (!process.stdout.isTTY) {
    console.error("agent-cli-ink requires a TTY terminal.");
    process.exit(1);
  }

  const modifyOtherKeysEnabled = shouldEnableModifyOtherKeys();
  if (modifyOtherKeysEnabled) {
    // Ask supporting terminals to send modified keys (e.g. Shift+Enter) as distinct escape sequences.
    // CSI > 4 ; 2 m - Enable modifyOtherKeys mode 2.
    // CSI > 1 u - Enable uDK (some terminals need this first).
    safeWriteAnsi("\u001b[>4;2m");
    safeWriteAnsi("\u001b[>1u");
  }

  process.on("exit", () => {
    if (modifyOtherKeysEnabled) {
      // Reset modifyOtherKeys mode on exit.
      safeWriteAnsi("\u001b[>4;m");
      safeWriteAnsi("\u001b[<u");
    }
  });

  safeWriteAnsi("\u001b[2J\u001b[3J\u001b[H");

  const options = parseOptions(process.argv.slice(2));
  render(
    <AgentChatProvider>
      <App options={options} />
    </AgentChatProvider>
  );
}

main();
