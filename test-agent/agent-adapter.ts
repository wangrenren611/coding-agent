import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Agent } from '../src/agent-v2/agent/agent';
import { createDefaultToolRegistry } from '../src/agent-v2/tool';
import { ProviderRegistry } from '../src/providers/registry';
import { operatorPrompt } from '../src/agent-v2/prompts/operator';
import type { MessageContent } from '../src/providers';

type AdapterOptions = {
  prompt?: string;
  repo?: string;
  model: string;
  language: string;
  json: boolean;
  maxRetries: number;
};

function parseArgs(argv: string[]): AdapterOptions {
  const options: AdapterOptions = {
    model: process.env.BENCH_MODEL || 'glm-4.7',
    language: process.env.BENCH_LANGUAGE || 'Chinese',
    json: false,
    maxRetries: Number(process.env.BENCH_MAX_RETRIES || '3'),
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--prompt' && next) {
      options.prompt = next;
      i++;
      continue;
    }
    if (arg === '--repo' && next) {
      options.repo = next;
      i++;
      continue;
    }
    if (arg === '--model' && next) {
      options.model = next;
      i++;
      continue;
    }
    if (arg === '--language' && next) {
      options.language = next;
      i++;
      continue;
    }
    if (arg === '--max-retries' && next) {
      options.maxRetries = Number(next);
      i++;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  // Positional compatibility for benchmark runners:
  //   agent-adapter.ts "<prompt>" "<repo>"
  if (!options.prompt && positional[0]) {
    options.prompt = positional[0];
  }
  if (!options.repo && positional[1]) {
    options.repo = positional[1];
  }

  return options;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function resolvePrompt(parsed: AdapterOptions, stdinText: string): string {
  const envPrompt =
    process.env.TS_BENCH_PROMPT ||
    process.env.BENCH_PROMPT ||
    process.env.PROMPT ||
    process.env.TASK_PROMPT ||
    '';

  const prompt = parsed.prompt || envPrompt || stdinText;
  return prompt.trim();
}

function resolveRepo(parsed: AdapterOptions, projectRoot: string): string {
  return path.resolve(
    parsed.repo ||
      process.env.TS_BENCH_REPO ||
      process.env.REPO_PATH ||
      process.env.WORKDIR ||
      projectRoot
  );
}

function toText(content: MessageContent): string {
  if (typeof content === 'string') return content;

  return content
    .map((part) => {
      if (part.type === 'text') return part.text || '';
      if (part.type === 'image_url') return `[image] ${part.image_url?.url || ''}`.trim();
      if (part.type === 'file') return `[file] ${part.file?.filename || part.file?.file_id || ''}`.trim();
      if (part.type === 'input_audio') return '[audio]';
      if (part.type === 'input_video') return `[video] ${part.input_video?.url || part.input_video?.file_id || ''}`.trim();
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function printHelp(): void {
  console.log(`Usage:
  tsx test-agent/agent-adapter.ts --prompt "<task>" --repo "<exerciseDir>" [options]

Options:
  --prompt <text>          Task prompt for agent
  --repo <path>            Exercise repository/work directory
  --model <modelId>        Provider model id (default: glm-4.7)
  --language <lang>        System prompt language (default: Chinese)
  --max-retries <n>        Agent max retries (default: 3)
  --json                   Print structured JSON output
  -h, --help               Show help

Compatibility:
  - Accepts positional args: "<prompt>" "<repo>"
  - Accepts prompt from stdin if --prompt is omitted
  - Supports env vars:
      TS_BENCH_PROMPT / BENCH_PROMPT / PROMPT
      TS_BENCH_REPO / REPO_PATH / WORKDIR
      BENCH_MODEL / BENCH_LANGUAGE / BENCH_MAX_RETRIES
`);
}

async function main(): Promise<void> {
  const thisFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(thisFile), '..');

  dotenv.config({ path: path.resolve(projectRoot, '.env.development') });
  dotenv.config({ path: path.resolve(projectRoot, '.env') });

  const parsed = parseArgs(process.argv.slice(2));
  const stdinText = await readStdin();
  const prompt = resolvePrompt(parsed, stdinText);
  const repo = resolveRepo(parsed, projectRoot);

  if (!prompt) {
    console.error('Missing prompt. Use --prompt, stdin, or TS_BENCH_PROMPT.');
    process.exit(2);
  }

  const provider = ProviderRegistry.createFromEnv(parsed.model as any);
  const toolRegistry = createDefaultToolRegistry({ workingDirectory: repo }, provider);

  const start = Date.now();
  const agent = new Agent({
    provider,
    toolRegistry,
    stream: false,
    maxRetries: parsed.maxRetries,
    systemPrompt: operatorPrompt({
      directory: repo,
      language: parsed.language,
    }),
  });

  const result = await agent.execute(prompt);
  const durationMs = Date.now() - start;
  const content = toText(result.content);

  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          model: parsed.model,
          repo,
          sessionId: agent.getSessionId(),
          durationMs,
          output: content,
        },
        null,
        2
      )
    );
    return;
  }

  process.stdout.write(content.endsWith('\n') ? content : `${content}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
