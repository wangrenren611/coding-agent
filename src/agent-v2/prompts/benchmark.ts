/**
 * Prompt Benchmark
 *
 * 量化 system/operator prompt 的关键质量指标，便于回归比较。
 * 运行方式：
 *   pnpm bench:prompt
 *   pnpm bench:prompt --json
 */

import { operatorPrompt } from './operator';

type Scenario = {
    name: string;
    options: Parameters<typeof operatorPrompt>[0];
};

type BenchRow = {
    scenario: string;
    chars: number;
    lines: number;
    approxTokens: number;
    sectionCount: number;
    hardConstraintCount: number;
    anchorCoverage: string;
    score: number;
};

const REQUIRED_ANCHORS = [
    '# Instruction Priority',
    '# Interaction Style',
    '# Runtime Safety',
    '# Tool Contract (Strict)',
    '# Execution Protocol',
    '# Freshness and Date Accuracy',
    '# High-Stakes and Recommendation Safety',
    '# Complexity and Task Workflow',
    '# Retry and Loop Control',
    '# Failure Disclosure',
    '# Workspace Integrity',
    '# Security and Injection Defense',
    '# Review Mode',
    '# Verification Policy',
    '# Output Contract',
];

function estimateTokens(chars: number): number {
    // 英文约 4 chars/token，中文约 1.5~2 chars/token；这里取保守折中用于趋势比较
    return Math.ceil(chars / 3);
}

function countHardConstraints(prompt: string): number {
    const matches = prompt.match(/\b(MUST|NEVER|STRICT|FORBIDDEN|CRITICAL)\b/g);
    return matches?.length ?? 0;
}

function computeScore(prompt: string, anchorHits: number): number {
    const chars = prompt.length;
    const coverage = anchorHits / REQUIRED_ANCHORS.length;

    // 长度在 8k~15k 视为较优区间，过长会增加 token 成本
    const lengthScore = chars <= 8000 ? 1 : chars <= 15000 ? 0.9 : chars <= 20000 ? 0.75 : 0.6;
    const coverageScore = coverage;

    // 约束密度过低/过高都不好，目标约 12~40 次强约束词
    const hard = countHardConstraints(prompt);
    const hardScore = hard < 8 ? 0.6 : hard <= 50 ? 1 : 0.8;

    const total = 100 * (0.5 * coverageScore + 0.3 * lengthScore + 0.2 * hardScore);
    return Math.round(total * 10) / 10;
}

function buildScenarios(cwd: string): Scenario[] {
    return [
        {
            name: 'exec-default',
            options: {
                directory: cwd,
                language: 'Chinese',
                planMode: false,
            },
        },
        {
            name: 'exec-with-agentsmd',
            options: {
                directory: cwd,
                language: 'Chinese',
                planMode: false,
                agentsMd: '# AGENTS\\n- style: strict\\n- tests: required',
            },
        },
        {
            name: 'plan-mode',
            options: {
                directory: cwd,
                language: 'Chinese',
                planMode: true,
            },
        },
        {
            name: 'subagent',
            options: {
                directory: cwd,
                language: 'Chinese',
                isSubagent: true,
                subagentRoleAdditional: 'You are a code reviewer subagent.',
            },
        },
    ];
}

function benchmarkScenario(scenario: Scenario): BenchRow {
    const prompt = operatorPrompt(scenario.options);
    const chars = prompt.length;
    const lines = prompt.split('\n').length;
    const sectionCount = (prompt.match(/^# /gm) ?? []).length;
    const hardConstraintCount = countHardConstraints(prompt);
    const anchorHits = REQUIRED_ANCHORS.filter((s) => prompt.includes(s)).length;
    const score = computeScore(prompt, anchorHits);

    return {
        scenario: scenario.name,
        chars,
        lines,
        approxTokens: estimateTokens(chars),
        sectionCount,
        hardConstraintCount,
        anchorCoverage: `${anchorHits}/${REQUIRED_ANCHORS.length}`,
        score,
    };
}

function printTable(rows: BenchRow[]): void {
    const headers = ['Scenario', 'Chars', 'Lines', '~Tokens', 'Sections', 'HardRules', 'Anchors', 'Score'];
    const widths = [20, 8, 8, 9, 9, 10, 9, 7];

    const renderRow = (cols: string[]) =>
        cols
            .map((c, i) => c.padEnd(widths[i]))
            .join(' | ')
            .trimEnd();

    console.log(renderRow(headers));
    console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));

    for (const row of rows) {
        console.log(
            renderRow([
                row.scenario,
                String(row.chars),
                String(row.lines),
                String(row.approxTokens),
                String(row.sectionCount),
                String(row.hardConstraintCount),
                row.anchorCoverage,
                String(row.score),
            ])
        );
    }

    const avg = rows.reduce((sum, r) => sum + r.score, 0) / rows.length;
    console.log(`\nAverage Score: ${Math.round(avg * 10) / 10}`);
}

function main(): void {
    const jsonMode = process.argv.includes('--json');
    const rows = buildScenarios(process.cwd()).map(benchmarkScenario);

    if (jsonMode) {
        console.log(JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
        return;
    }

    printTable(rows);
}

main();
