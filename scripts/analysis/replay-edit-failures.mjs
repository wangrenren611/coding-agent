#!/usr/bin/env node
/* eslint-disable no-undef */

import fs from 'fs';
import path from 'path';

const defaultContextsDir = '/Users/wrr/work/coding-agent-data/agent-memory/contexts';
const contextsDir = process.argv[2] ?? defaultContextsDir;

function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n');
}

function splitAndFilterEmptyTail(text) {
    const lines = text.split('\n');
    if (text.endsWith('\n') && lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

function findExactMatchStartIndices(lines, expectedLines) {
    if (expectedLines.length === 0) return [];
    const matches = [];
    const maxStart = lines.length - expectedLines.length;
    for (let start = 0; start <= maxStart; start++) {
        let matched = true;
        for (let i = 0; i < expectedLines.length; i++) {
            if (lines[start + i] !== expectedLines[i]) {
                matched = false;
                break;
            }
        }
        if (matched) matches.push(start);
    }
    return matches;
}

function escapeReplacementString(text) {
    return text.replace(/\$/g, () => '$$');
}

function parseJsonSafe(text, fallback) {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

function isPreciseSuccess(output) {
    return /^Replaced line\s+\d+/i.test(String(output ?? ''));
}

function isBatchPartialFailure(output) {
    return /Completed with\s+\d+\s+failures?\s+out of/i.test(String(output ?? ''));
}

function readFileCached(cache, filePath) {
    if (cache.has(filePath)) return cache.get(filePath);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        cache.set(filePath, { exists: true, content });
        return cache.get(filePath);
    } catch {
        cache.set(filePath, { exists: false, content: '' });
        return cache.get(filePath);
    }
}

function simulatePreciseOnCurrentFile(args, fileContent) {
    if (
        typeof args?.filePath !== 'string' ||
        typeof args?.line !== 'number' ||
        typeof args?.oldText !== 'string' ||
        typeof args?.newText !== 'string'
    ) {
        return { evaluable: false, reason: 'INVALID_ARGS' };
    }

    const normalizedContent = normalizeLineEndings(fileContent);
    const normalizedOldText = normalizeLineEndings(args.oldText);
    const lines = splitAndFilterEmptyTail(normalizedContent);
    const oldTextLines = splitAndFilterEmptyTail(normalizedOldText);
    const expectedText = oldTextLines.join('\n');

    let oldWouldSucceed = false;
    const targetLineIdx = args.line - 1;
    if (args.line >= 1 && args.line <= lines.length && targetLineIdx + oldTextLines.length <= lines.length) {
        const actual = lines.slice(targetLineIdx, targetLineIdx + oldTextLines.length).join('\n');
        oldWouldSucceed = actual === expectedText;
    }

    if (oldWouldSucceed) {
        return { evaluable: true, oldWouldSucceed: true, newWouldSucceed: true, reason: 'OLD_LOGIC_SUCCESS' };
    }

    const matches = findExactMatchStartIndices(lines, oldTextLines);
    if (matches.length === 1) {
        return { evaluable: true, oldWouldSucceed: false, newWouldSucceed: true, reason: 'UNIQUE_AUTO_CORRECT' };
    }
    if (matches.length > 1) {
        return { evaluable: true, oldWouldSucceed: false, newWouldSucceed: false, reason: 'AMBIGUOUS_MATCHES' };
    }
    return { evaluable: true, oldWouldSucceed: false, newWouldSucceed: false, reason: 'NO_MATCH' };
}

function simulateBatchOnCurrentFile(args, fileContent) {
    if (typeof args?.filePath !== 'string' || !Array.isArray(args?.replacements)) {
        return { evaluable: false, reason: 'INVALID_ARGS' };
    }

    const normalizedContent = normalizeLineEndings(fileContent);
    const lines = normalizedContent.split('\n');
    const endsWithLineBreak = normalizedContent.endsWith('\n');
    const effectiveLineCount = endsWithLineBreak ? lines.length - 1 : lines.length;

    const originalLines = new Map();
    let modifiedCount = 0;
    let failedCount = 0;

    for (const repl of args.replacements) {
        const line = repl?.line;
        const oldText = repl?.oldText;
        const newText = repl?.newText;
        if (typeof line !== 'number' || typeof oldText !== 'string' || typeof newText !== 'string') {
            failedCount++;
            continue;
        }
        if (line < 1 || line > effectiveLineCount) {
            failedCount++;
            continue;
        }

        const targetLineIdx = line - 1;
        if (!originalLines.has(line)) {
            originalLines.set(line, lines[targetLineIdx]);
        }
        const originalLine = originalLines.get(line);

        if (newText.length > 0 && originalLine.includes(newText)) {
            const newRanges = [];
            let newIdx = originalLine.indexOf(newText);
            while (newIdx !== -1) {
                newRanges.push({ start: newIdx, end: newIdx + newText.length });
                newIdx = originalLine.indexOf(newText, newIdx + 1);
            }

            const oldIndices = [];
            let oldIdx = originalLine.indexOf(oldText);
            while (oldIdx !== -1) {
                oldIndices.push(oldIdx);
                oldIdx = originalLine.indexOf(oldText, oldIdx + 1);
            }

            if (oldIndices.length === 0) {
                continue;
            }

            const hasOldOutsideNewSpans = oldIndices.some((idx) => {
                return !newRanges.some((range) => idx >= range.start && idx < range.end);
            });

            if (!hasOldOutsideNewSpans) {
                continue;
            }
        }

        if (!originalLine.includes(oldText)) {
            failedCount++;
            continue;
        }

        const escapedNewText = escapeReplacementString(newText);
        lines[targetLineIdx] = originalLine.replace(oldText, escapedNewText);
        modifiedCount++;
    }

    return {
        evaluable: true,
        reason: failedCount === 0 ? 'FULL_SUCCESS' : 'STILL_PARTIAL_FAILURE',
        failedCount,
        modifiedCount,
    };
}

const contextFiles = fs
    .readdirSync(contextsDir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.json.bak'))
    .sort();

const fileCache = new Map();

const precise = {
    historicalFailed: 0,
    evaluable: 0,
    notEvaluable: 0,
    recoverableByNewLogic: 0,
    stillFail: 0,
    reasons: {},
};

const batch = {
    historicalFailed: 0,
    evaluable: 0,
    notEvaluable: 0,
    nowFullSuccess: 0,
    stillPartial: 0,
    reasons: {},
};

for (const contextFile of contextFiles) {
    const abs = path.join(contextsDir, contextFile);
    const obj = parseJsonSafe(fs.readFileSync(abs, 'utf8'), null);
    if (!obj || !Array.isArray(obj.messages)) continue;

    const resultById = new Map();
    for (const m of obj.messages) {
        if (m?.role === 'tool' && m.tool_call_id) {
            resultById.set(m.tool_call_id, String(m.content ?? ''));
        }
    }

    for (const m of obj.messages) {
        if (m?.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
        for (const tc of m.tool_calls) {
            const toolName = tc?.function?.name;
            const args = parseJsonSafe(tc?.function?.arguments ?? '{}', {});
            const result = resultById.get(tc?.id) ?? '';

            if (toolName === 'precise_replace') {
                if (isPreciseSuccess(result)) continue;
                precise.historicalFailed++;

                const filePath = args?.filePath;
                const fileInfo = typeof filePath === 'string' ? readFileCached(fileCache, filePath) : { exists: false, content: '' };
                if (!fileInfo.exists) {
                    precise.notEvaluable++;
                    precise.reasons.FILE_MISSING = (precise.reasons.FILE_MISSING ?? 0) + 1;
                    continue;
                }

                const sim = simulatePreciseOnCurrentFile(args, fileInfo.content);
                if (!sim.evaluable) {
                    precise.notEvaluable++;
                    precise.reasons[sim.reason] = (precise.reasons[sim.reason] ?? 0) + 1;
                    continue;
                }

                precise.evaluable++;
                precise.reasons[sim.reason] = (precise.reasons[sim.reason] ?? 0) + 1;
                if (sim.newWouldSucceed) precise.recoverableByNewLogic++;
                else precise.stillFail++;
            }

            if (toolName === 'batch_replace') {
                if (!isBatchPartialFailure(result)) continue;
                batch.historicalFailed++;

                const filePath = args?.filePath;
                const fileInfo = typeof filePath === 'string' ? readFileCached(fileCache, filePath) : { exists: false, content: '' };
                if (!fileInfo.exists) {
                    batch.notEvaluable++;
                    batch.reasons.FILE_MISSING = (batch.reasons.FILE_MISSING ?? 0) + 1;
                    continue;
                }

                const sim = simulateBatchOnCurrentFile(args, fileInfo.content);
                if (!sim.evaluable) {
                    batch.notEvaluable++;
                    batch.reasons[sim.reason] = (batch.reasons[sim.reason] ?? 0) + 1;
                    continue;
                }

                batch.evaluable++;
                batch.reasons[sim.reason] = (batch.reasons[sim.reason] ?? 0) + 1;
                if (sim.failedCount === 0) batch.nowFullSuccess++;
                else batch.stillPartial++;
            }
        }
    }
}

const report = {
    contextsDir,
    contextFilesAnalyzed: contextFiles.length,
    precise_replace: {
        historicalFailed: precise.historicalFailed,
        evaluableOnCurrentSnapshot: precise.evaluable,
        notEvaluable: precise.notEvaluable,
        recoverableByNewLogic: precise.recoverableByNewLogic,
        stillFailOnCurrentSnapshot: precise.stillFail,
        recoverableRateAmongEvaluable:
            precise.evaluable > 0 ? Number(((precise.recoverableByNewLogic / precise.evaluable) * 100).toFixed(2)) : 0,
        reasons: precise.reasons,
    },
    batch_replace: {
        historicalFailedCalls: batch.historicalFailed,
        evaluableOnCurrentSnapshot: batch.evaluable,
        notEvaluable: batch.notEvaluable,
        nowFullSuccessWithIdempotentLogic: batch.nowFullSuccess,
        stillPartialFailure: batch.stillPartial,
        fullSuccessRateAmongEvaluable:
            batch.evaluable > 0 ? Number(((batch.nowFullSuccess / batch.evaluable) * 100).toFixed(2)) : 0,
        reasons: batch.reasons,
    },
    notes: [
        'This replay uses the current workspace snapshot, not historical file snapshots.',
        'Results are directional estimates for policy/tool improvements, not exact historical re-execution.',
    ],
};

console.log(JSON.stringify(report, null, 2));
