#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import dotenv from "dotenv";
import { AgentChatProvider } from "../../../src/agent-chat-react";
import { App } from "./app";
import type { CliOptions } from "./types";

dotenv.config({ path: "./.env.development" });

function parseOptions(argv: string[]): CliOptions {
  const defaults: CliOptions = {
    model: "minimax-2.1",
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

  const options = parseOptions(process.argv.slice(2));
  render(
    <AgentChatProvider>
      <App options={options} />
    </AgentChatProvider>
  );
}

main();
