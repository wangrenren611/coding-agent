import path from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';

type RunnerOptions = {
  tsBenchDir: string;
  adapterPath: string;
  agent: string;
  model?: string;
  args: string[];
};

function parseArgs(argv: string[]): RunnerOptions {
  const thisFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(thisFile), '..');

  const options: RunnerOptions = {
    tsBenchDir: process.env.TS_BENCH_DIR || path.resolve(projectRoot, '../ts-bench'),
    adapterPath: path.resolve(projectRoot, 'test-agent/agent-adapter.ts'),
    agent: process.env.TS_BENCH_AGENT || 'custom',
    model: process.env.TS_BENCH_MODEL,
    args: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--ts-bench-dir' && next) {
      options.tsBenchDir = path.resolve(next);
      i++;
      continue;
    }
    if (arg === '--adapter' && next) {
      options.adapterPath = path.resolve(next);
      i++;
      continue;
    }
    if (arg === '--agent' && next) {
      options.agent = next;
      i++;
      continue;
    }
    if (arg === '--model' && next) {
      options.model = next;
      i++;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    options.args.push(arg);
  }

  return options;
}

function printHelp(): void {
  console.log(`Usage:
  tsx test-agent/run-ts-bench.ts [options] -- [ts-bench args...]

Options:
  --ts-bench-dir <path>     Local ts-bench repo path (default: ../ts-bench)
  --adapter <path>          Custom adapter entry (default: test-agent/agent-adapter.ts)
  --agent <name>            ts-bench agent name (default: custom)
  --model <modelId>         Model id passed to adapter via env
  -h, --help                Show help

This runner injects adapter command via environment variables, so you can map
ts-bench "custom" agent to this repository's Agent implementation.
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const adapterCommand = `tsx "${options.adapterPath}"`;
  const benchArgs = [
    'src/index.ts',
    '--agent',
    options.agent,
    ...options.args,
  ];

  const env: Record<string, string> = {
    ...process.env,
    TS_BENCH_CUSTOM_AGENT_CMD: adapterCommand,
    TSBENCH_CUSTOM_AGENT_CMD: adapterCommand,
    CUSTOM_AGENT_CMD: adapterCommand,
    BENCH_AGENT_CMD: adapterCommand,
  } as Record<string, string>;

  if (options.model) {
    env.BENCH_MODEL = options.model;
    env.TS_BENCH_MODEL = options.model;
  }

  console.log('[run-ts-bench] ts-bench dir:', options.tsBenchDir);
  console.log('[run-ts-bench] adapter:', options.adapterPath);
  console.log('[run-ts-bench] command: bun', benchArgs.join(' '));

  await execa('bun', benchArgs, {
    cwd: options.tsBenchDir,
    env,
    stdio: 'inherit',
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
