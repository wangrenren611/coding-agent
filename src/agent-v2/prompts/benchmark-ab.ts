/**
 * Real Task Prompt A/B Benchmark
 *
 * 真实任务对比两套系统提示词效果：成功率、期望命中率、幻觉违规率、平均耗时。
 *
 * Usage:
 *   pnpm bench:prompt:ab
 *   pnpm bench:prompt:ab --model qwen3.5-plus --cases src/agent-v2/prompts/fixtures/ab-cases.json
 *   pnpm bench:prompt:ab --variant-a current --variant-b file:/abs/path/prompt.txt
 *   pnpm bench:prompt:ab --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { Agent } from '../agent/agent';
import { contentToText } from '../agent/core-types';
import type { ValidationResult } from '../agent/response-validator';
import { operatorPrompt } from './operator';
import { ProviderRegistry, type ModelId } from '../../providers';

type VariantSpec = 'current' | `file:${string}`;

type BenchCase = {
    id: string;
    query: string;
    expectAllContains?: string[];
    expectAnyContains?: string[];
    expectRegex?: string;
    rejectRegex?: string;
};

type RunRow = {
    variant: string;
    caseId: string;
    status: 'completed' | 'failed' | 'aborted';
    success: boolean;
    expectationPassed: boolean;
    durationMs: number;
    retryCount: number;
    loopCount: number;
    hallucinationViolations: number;
    failureCode?: string;
};

type AggregateRow = {
    variant: string;
    total: number;
    successRate: number;
    expectationPassRate: number;
    hallucinationViolationRate: number;
    avgHallucinationViolations: number;
    avgDurationMs: number;
    avgRetryCount: number;
    avgLoopCount: number;
};

type CliOptions = {
    model: ModelId;
    casesPath: string;
    variantA: VariantSpec;
    variantB: VariantSpec;
    language: string;
    json: boolean;
    maxCases?: number;
    requestTimeoutMs?: number;
};

function parseCliOptions(): CliOptions {
    const args = process.argv.slice(2);
    const pick = (flag: string): string | undefined => {
        const idx = args.indexOf(flag);
        return idx >= 0 ? args[idx + 1] : undefined;
    };

    const model = (pick('--model') || 'qwen3.5-plus') as ModelId;
    const casesPath = pick('--cases') || 'src/agent-v2/prompts/fixtures/ab-cases.json';
    const variantA = (pick('--variant-a') || 'current') as VariantSpec;
    const variantB = (pick('--variant-b') || 'current') as VariantSpec;
    const language = pick('--language') || 'Chinese';
    const maxCasesRaw = pick('--max-cases');
    const timeoutRaw = pick('--timeout-ms');

    return {
        model,
        casesPath,
        variantA,
        variantB,
        language,
        json: args.includes('--json'),
        maxCases: maxCasesRaw ? Number.parseInt(maxCasesRaw, 10) : undefined,
        requestTimeoutMs: timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined,
    };
}

function readCases(casesPath: string, maxCases?: number): BenchCase[] {
    const abs = path.isAbsolute(casesPath) ? casesPath : path.join(process.cwd(), casesPath);
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8')) as BenchCase[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(`No benchmark cases found in ${abs}`);
    }
    return typeof maxCases === 'number' && maxCases > 0 ? parsed.slice(0, maxCases) : parsed;
}

function replaceVars(input: string): string {
    const now = new Date().toISOString().slice(0, 10);
    return input.replaceAll('{{cwd}}', process.cwd()).replaceAll('{{today}}', now);
}

function buildPrompt(variant: VariantSpec, language: string): string {
    if (variant === 'current') {
        return operatorPrompt({
            directory: process.cwd(),
            language,
            planMode: false,
        });
    }

    if (variant.startsWith('file:')) {
        const filePath = variant.slice('file:'.length);
        const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
        return replaceVars(fs.readFileSync(abs, 'utf8'));
    }

    throw new Error(`Unsupported variant: ${variant}`);
}

function evaluateExpectation(row: { output: string; status: string; benchCase: BenchCase }): boolean {
    if (row.status !== 'completed') return false;
    const output = row.output;
    const c = row.benchCase;

    if (c.expectAllContains && c.expectAllContains.some((token) => !output.includes(token))) {
        return false;
    }

    if (
        c.expectAnyContains &&
        c.expectAnyContains.length > 0 &&
        !c.expectAnyContains.some((token) => output.includes(token))
    ) {
        return false;
    }

    if (c.expectRegex) {
        const re = new RegExp(c.expectRegex, 'i');
        if (!re.test(output)) return false;
    }

    if (c.rejectRegex) {
        const re = new RegExp(c.rejectRegex, 'i');
        if (re.test(output)) return false;
    }

    return true;
}

async function runOne(variantName: string, prompt: string, benchCase: BenchCase, options: CliOptions): Promise<RunRow> {
    const provider = ProviderRegistry.createFromEnv(options.model, { temperature: 0.1 });

    let hallucinationViolations = 0;
    const onValidationViolation = (_result: ValidationResult) => {
        hallucinationViolations += 1;
    };

    const agent = new Agent({
        provider,
        systemPrompt: prompt,
        stream: false,
        thinking: false,
        requestTimeout: options.requestTimeoutMs,
        validationOptions: {
            enabled: true,
            abortOnViolation: false,
        },
        onValidationViolation,
    });
    await agent.initialize();

    const started = Date.now();
    try {
        const result = await agent.executeWithResult(replaceVars(benchCase.query));
        const durationMs = Date.now() - started;
        const output = result.finalMessage ? contentToText(result.finalMessage.content) : '';
        const expectationPassed = evaluateExpectation({ output, status: result.status, benchCase });

        return {
            variant: variantName,
            caseId: benchCase.id,
            status: result.status,
            success: result.status === 'completed' && expectationPassed,
            expectationPassed,
            durationMs,
            retryCount: result.retryCount,
            loopCount: result.loopCount,
            hallucinationViolations,
            failureCode: result.failure?.code,
        };
    } finally {
        await agent.close();
    }
}

function aggregate(rows: RunRow[], variantName: string): AggregateRow {
    const own = rows.filter((r) => r.variant === variantName);
    const total = own.length;
    const successCount = own.filter((r) => r.success).length;
    const expectPassCount = own.filter((r) => r.expectationPassed).length;
    const violationCount = own.filter((r) => r.hallucinationViolations > 0).length;

    const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

    return {
        variant: variantName,
        total,
        successRate: total ? successCount / total : 0,
        expectationPassRate: total ? expectPassCount / total : 0,
        hallucinationViolationRate: total ? violationCount / total : 0,
        avgHallucinationViolations: avg(own.map((r) => r.hallucinationViolations)),
        avgDurationMs: avg(own.map((r) => r.durationMs)),
        avgRetryCount: avg(own.map((r) => r.retryCount)),
        avgLoopCount: avg(own.map((r) => r.loopCount)),
    };
}

function pct(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
}

function printSummary(aggregates: AggregateRow[]): void {
    const headers = ['Variant', 'Success', 'ExpectPass', 'Violation', 'Avg(ms)', 'AvgRetry', 'AvgLoop', 'Total'];
    const widths = [16, 10, 11, 10, 9, 9, 8, 6];
    const row = (cols: string[]) =>
        cols
            .map((c, i) => c.padEnd(widths[i]))
            .join(' | ')
            .trimEnd();

    console.log(row(headers));
    console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));

    for (const a of aggregates) {
        console.log(
            row([
                a.variant,
                pct(a.successRate),
                pct(a.expectationPassRate),
                pct(a.hallucinationViolationRate),
                a.avgDurationMs.toFixed(0),
                a.avgRetryCount.toFixed(2),
                a.avgLoopCount.toFixed(2),
                String(a.total),
            ])
        );
    }
}

async function main(): Promise<void> {
    const options = parseCliOptions();
    const cases = readCases(options.casesPath, options.maxCases);

    const variants: Array<{ name: string; spec: VariantSpec }> = [
        { name: 'A', spec: options.variantA },
        { name: 'B', spec: options.variantB },
    ];

    const prompts = variants.map((v) => ({ ...v, prompt: buildPrompt(v.spec, options.language) }));
    const rows: RunRow[] = [];

    for (const v of prompts) {
        for (const benchCase of cases) {
            const row = await runOne(v.name, v.prompt, benchCase, options);
            rows.push(row);
        }
    }

    const aggregates = prompts.map((v) => aggregate(rows, v.name));

    if (options.json) {
        console.log(
            JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    options,
                    cases: cases.map((c) => c.id),
                    aggregates,
                    rows,
                },
                null,
                2
            )
        );
        return;
    }

    printSummary(aggregates);
}

main().catch((error) => {
    console.error('[bench:prompt:ab] failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
