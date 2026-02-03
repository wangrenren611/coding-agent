import readline from 'node:readline';
import process from 'node:process';
import { Agent } from '../agent-v2/agent/agent';
import { AgentStatus } from '../agent-v2/agent/types';
import { operatorPrompt } from '../agent-v2/prompts/operator';
import { ProviderRegistry, type ModelId } from '../providers';
import { StreamAdapter } from './agent/stream-adapter';
import type { UIEvent } from './state/types';

const DEFAULT_MODEL: ModelId = 'minimax-2.1';

const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  } catch {
    return String(value);
  }
};

const formatToolArgs = (args: Record<string, unknown>): string => {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return '';
  return safeStringify(args);
};

const formatToolResult = (result: unknown): string => {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result.trim();
  return safeStringify(result);
};

export const runPlain = (): void => {
  const provider = ProviderRegistry.createFromEnv(DEFAULT_MODEL);
  const adapter = new StreamAdapter(handleEvent);

  const agent = new Agent({
    provider,
    systemPrompt: operatorPrompt({
      directory: process.cwd(),
      vcs: 'git',
      language: 'Chinese',
    }),
    stream: true,
    streamCallback: message => adapter.handleAgentMessage(message),
  });

  let isBusy = false;
  let assistantOpen = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: 200,
  });

  const prompt = () => {
    if (isBusy) return;
    rl.prompt();
  };

  const ensureNewline = () => {
    if (assistantOpen) {
      process.stdout.write('\n');
      assistantOpen = false;
    }
  };

  function handleEvent(event: UIEvent): void {
    switch (event.type) {
      case 'assistant-start':
        ensureNewline();
        process.stdout.write('Assistant: ');
        assistantOpen = true;
        break;
      case 'assistant-delta':
        process.stdout.write(event.contentDelta);
        break;
      case 'assistant-complete':
        ensureNewline();
        break;
      case 'tool-start': {
        ensureNewline();
        const args = formatToolArgs(event.args);
        const suffix = args ? `(${args})` : '';
        process.stdout.write(`[tool] ${event.toolName}${suffix}\n`);
        break;
      }
      case 'tool-complete': {
        ensureNewline();
        const result = formatToolResult(event.result);
        process.stdout.write(result ? `[tool result] ${result}\n` : '[tool result]\n');
        break;
      }
      case 'tool-error':
        ensureNewline();
        process.stdout.write(`[tool error] ${event.error}\n`);
        break;
      case 'status': {
        if (!event.state) break;
        ensureNewline();
        const extra = event.message ? ` - ${event.message}` : '';
        process.stdout.write(`[status] ${event.state}${extra}\n`);
        break;
      }
      case 'error':
        ensureNewline();
        process.stdout.write(`[error] ${event.message}${event.phase ? ` (${event.phase})` : ''}\n`);
        resumeInput();
        break;
      case 'session-complete':
        ensureNewline();
        resumeInput();
        break;
      default:
        break;
    }
  }

  const resumeInput = () => {
    if (!isBusy) return;
    isBusy = false;
    rl.resume();
    prompt();
  };

  rl.setPrompt('> ');
  prompt();

  rl.on('line', (line) => {
    const message = line.trim();
    if (!message) {
      prompt();
      return;
    }

    if (message === '/exit') {
      rl.close();
      process.exit(0);
    }

    if (agent.getStatus() !== AgentStatus.IDLE) {
      agent.abort();
    }

    process.stdout.write(`You: ${message}\n`);
    isBusy = true;
    rl.pause();

    agent.execute(message)
      .catch((error) => {
        ensureNewline();
        const messageText = error instanceof Error ? error.message : String(error);
        process.stdout.write(`[error] ${messageText}\n`);
      })
      .finally(() => {
        resumeInput();
      });
  });

  rl.on('close', () => {
    process.stdout.write('\n');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    rl.close();
  });
};
