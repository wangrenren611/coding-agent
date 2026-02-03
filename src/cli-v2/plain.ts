import readline from 'node:readline';
import process from 'node:process';
import { Agent } from '../agent-v2/agent/agent';
import { AgentStatus } from '../agent-v2/agent/types';
import { operatorPrompt } from '../agent-v2/prompts/operator';
import { ProviderRegistry, type ModelId } from '../providers';
import { StreamAdapter } from './agent/stream-adapter';
import type { UIEvent } from './state/types';
import { COLORS, ICONS } from './ui/theme';

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

/**
 * Color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
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
      case 'text-start':
        ensureNewline();
        process.stdout.write(`${colors.cyan}${ICONS.assistant} Assistant:${colors.reset} `);
        assistantOpen = true;
        break;
      case 'text-delta':
        process.stdout.write(event.contentDelta);
        break;
      case 'text-complete':
        ensureNewline();
        break;
      case 'tool-start': {
        ensureNewline();
        const args = formatToolArgs(event.args);
        const suffix = args ? `(${args})` : '';
        process.stdout.write(`${colors.yellow}${ICONS.tool} Tool: ${event.toolName}${suffix}${colors.reset}\n`);
        break;
      }
      case 'tool-stream':
        // Show real-time tool output (can be noisy, so maybe dim it)
        process.stdout.write(`${colors.dim}${event.output}${colors.reset}`);
        break;
      case 'tool-complete': {
        ensureNewline();
        const result = formatToolResult(event.result);
        if (result) {
          process.stdout.write(`${colors.dim}${ICONS.result} Result: ${result}${colors.reset}\n`);
        } else {
          process.stdout.write(`${colors.green}${ICONS.success} Done${colors.reset}\n`);
        }
        break;
      }
      case 'tool-error':
        ensureNewline();
        process.stdout.write(`${colors.red}${ICONS.error} Error: ${event.error}${colors.reset}\n`);
        break;
      case 'code-patch': {
        ensureNewline();
        process.stdout.write(`${colors.magenta}${ICONS.diff} Patch: ${event.path}${colors.reset}\n`);
        // Parse and display diff with colors
        const lines = event.diff.split('\n');
        for (const line of lines) {
          if (line.startsWith('@@')) {
            process.stdout.write(`${colors.dim}${line}${colors.reset}\n`);
          } else if (line.startsWith('+')) {
            process.stdout.write(`${colors.green}${line}${colors.reset}\n`);
          } else if (line.startsWith('-')) {
            process.stdout.write(`${colors.red}${line}${colors.reset}\n`);
          } else if (line.startsWith(' ')) {
            process.stdout.write(`${colors.dim}${line}${colors.reset}\n`);
          }
        }
        break;
      }
      case 'status': {
        if (!event.state) break;
        ensureNewline();
        const extra = event.message ? ` - ${event.message}` : '';
        process.stdout.write(`${colors.cyan}[status] ${event.state}${extra}${colors.reset}\n`);
        break;
      }
      case 'error':
        ensureNewline();
        const phase = event.phase ? ` (${event.phase})` : '';
        process.stdout.write(`${colors.red}[error] ${event.message}${phase}${colors.reset}\n`);
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

    process.stdout.write(`${colors.green}${ICONS.user} You:${colors.reset} ${message}\n`);
    isBusy = true;
    rl.pause();

    agent.execute(message)
      .catch((error) => {
        ensureNewline();
        const messageText = error instanceof Error ? error.message : String(error);
        process.stdout.write(`${colors.red}[error] ${messageText}${colors.reset}\n`);
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
