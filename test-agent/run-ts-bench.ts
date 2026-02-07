import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execa } from 'execa';

type RunnerOptions = {
  tsBenchDir?: string;
  adapterPath: string;
  agent: string;
  model?: string;
  bunBin?: string;
  args: string[];
};

function parseArgs(argv: string[]): RunnerOptions {
  const thisFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(thisFile), '..');

  const options: RunnerOptions = {
    tsBenchDir: process.env.TS_BENCH_DIR,
    adapterPath: path.resolve(projectRoot, 'test-agent/agent-adapter.ts'),
    agent: process.env.TS_BENCH_AGENT || 'custom',
    model: process.env.TS_BENCH_MODEL,
    bunBin: process.env.BUN_BIN,
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
    if (arg === '--bun-bin' && next) {
      options.bunBin = path.resolve(next);
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

function isTsBenchDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'src', 'index.ts'));
}

function discoverTsBenchDir(projectRoot: string, explicitDir?: string): {
  dir?: string;
  tried: string[];
} {
  const tried = new Set<string>();

  const addTry = (candidate?: string) => {
    if (!candidate) return;
    tried.add(path.resolve(candidate));
  };

  addTry(explicitDir);
  addTry(process.env.TS_BENCH_DIR);
  addTry(path.resolve(projectRoot, '../ts-bench'));
  addTry(path.resolve(projectRoot, '../../ts-bench'));

  const workspaceParent = path.resolve(projectRoot, '..');
  if (fs.existsSync(workspaceParent)) {
    for (const entry of fs.readdirSync(workspaceParent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!/ts[-_]?bench/i.test(entry.name)) continue;
      addTry(path.join(workspaceParent, entry.name));
    }
  }

  for (const candidate of tried) {
    if (isTsBenchDir(candidate)) {
      return { dir: candidate, tried: Array.from(tried) };
    }
  }

  return { tried: Array.from(tried) };
}

function resolveBunBinary(explicitBin?: string): string {
  if (explicitBin && fs.existsSync(explicitBin)) {
    return explicitBin;
  }

  if (process.env.BUN_BIN && fs.existsSync(process.env.BUN_BIN)) {
    return process.env.BUN_BIN;
  }

  const nodeDir = path.dirname(process.execPath);
  const siblingBun = path.join(nodeDir, 'bun');
  if (fs.existsSync(siblingBun)) {
    return siblingBun;
  }

  return 'bun';
}

function printHelp(): void {
  console.log(`Usage:
  tsx test-agent/run-ts-bench.ts [options] -- [ts-bench args...]

Options:
  --ts-bench-dir <path>     Local ts-bench repo path (default: ../ts-bench)
  --adapter <path>          Custom adapter entry (default: test-agent/agent-adapter.ts)
  --agent <name>            ts-bench agent name (default: custom)
  --model <modelId>         Model id passed to adapter via env
  --bun-bin <path>          Bun binary path (or use env BUN_BIN)
  -h, --help                Show help

This runner injects adapter command via environment variables, so you can map
ts-bench "custom" agent to this repository's Agent implementation.
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const thisFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(thisFile), '..');
  const { dir: tsBenchDir, tried } = discoverTsBenchDir(projectRoot, options.tsBenchDir);

  if (!tsBenchDir) {
    throw new Error(
      [
        'Cannot find ts-bench directory.',
        'Tried:',
        ...tried.map((item) => `  - ${item}`),
        '',
        'Fix:',
        '  1) Clone ts-bench to any local path',
        '  2) Run with --ts-bench-dir <your-path>',
        '',
        'Example:',
        '  pnpm bench:agent:ts-bench -- --ts-bench-dir "/absolute/path/to/ts-bench"',
      ].join('\n')
    );
  }

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

  const bunBinary = resolveBunBinary(options.bunBin);

  console.log('[run-ts-bench] ts-bench dir:', tsBenchDir);
  console.log('[run-ts-bench] adapter:', options.adapterPath);
  console.log('[run-ts-bench] bun:', bunBinary);
  console.log('[run-ts-bench] command:', bunBinary, benchArgs.join(' '));

  await execa(bunBinary, benchArgs, {
    cwd: tsBenchDir,
    env,
    stdio: 'inherit',
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
