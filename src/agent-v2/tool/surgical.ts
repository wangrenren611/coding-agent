import fs from 'fs';
import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from './base';
import { resolveAndValidatePath, PathTraversalError } from './file';

const schema = z
    .object({
        filePath: z.string().describe('The absolute or relative path to the file'),
        line: z.number().describe('Starting line number (1-based) where oldText begins'),
        oldText: z.string().describe('The exact text to replace - can span multiple lines'),
        newText: z.string().describe('The replacement text - can span multiple lines'),
    })
    .strict();

/**
 * Normalize line endings: convert CRLF to LF
 */
function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/**
 * Split by newlines and remove trailing empty line
 * (Consistent with read_file processing logic)
 *
 * IMPORTANT: Only remove trailing empty string if the text ENDS with newline.
 * - "a\nb\n" → ["a", "b"] (trailing newline produces empty string, remove it)
 * - "" → [""] (empty string means one empty line, keep it)
 * - "a\nb" → ["a", "b"] (no trailing newline, nothing to remove)
 */
function splitAndFilterEmptyTail(text: string): string[] {
    const lines = text.split('\n');
    // Only remove trailing empty string if text ends with newline
    // This distinguishes between:
    // - "" (user wants to match an empty line) → keep [""]
    // - "a\n" (file content with trailing newline) → remove trailing ""
    if (text.endsWith('\n') && lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

/**
 * Escape string for display
 */
function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

/**
 * Generate context around target lines for debugging
 */
function generateContextSnippet(
    lines: string[],
    targetLineIdx: number,
    lineCount: number,
    contextLines: number = 5
): string {
    const startIdx = Math.max(0, targetLineIdx - contextLines);
    const endIdx = Math.min(lines.length, targetLineIdx + lineCount + contextLines);

    const maxLineNum = endIdx.toString().length;

    const result: string[] = [];
    for (let i = startIdx; i < endIdx; i++) {
        const lineNum = (i + 1).toString().padStart(maxLineNum, ' ');
        const prefix = i >= targetLineIdx && i < targetLineIdx + lineCount ? '>>>' : '   ';
        result.push(`${prefix} ${lineNum} | ${lines[i]}`);
    }

    return result.join('\n');
}

/**
 * Generate detailed diff report
 */
function generateDiffReport(actual: string, expected: string): string {
    const lines: string[] = [];

    lines.push(`    Actual length: ${actual.length}`);
    lines.push(`    Expected length: ${expected.length}`);

    // Find first difference position
    const minLen = Math.min(actual.length, expected.length);
    let firstDiff = -1;
    for (let i = 0; i < minLen; i++) {
        if (actual[i] !== expected[i]) {
            firstDiff = i;
            break;
        }
    }

    if (firstDiff >= 0) {
        lines.push(`    First difference at char ${firstDiff}:`);

        const contextStart = Math.max(0, firstDiff - 10);
        const contextEnd = firstDiff + 20;

        lines.push(`    Context:`);
        lines.push(
            `      Actual [...${contextStart}..${firstDiff}..]: "${escapeString(actual.slice(contextStart, contextEnd))}"`
        );
        lines.push(
            `      Expected [...${contextStart}..${firstDiff}..]: "${escapeString(expected.slice(contextStart, contextEnd))}"`
        );

        lines.push(`    Diff chars:`);
        lines.push(
            `      Actual[${firstDiff}]: ${JSON.stringify(actual[firstDiff])} (code: ${actual.charCodeAt(firstDiff)})`
        );
        lines.push(
            `      Expected[${firstDiff}]: ${JSON.stringify(expected[firstDiff])} (code: ${expected.charCodeAt(firstDiff)})`
        );
    } else if (actual.length !== expected.length) {
        const diff = expected.length - actual.length;
        lines.push(`    Length diff: ${diff > 0 ? '+' : ''}${diff}`);

        if (diff > 0) {
            lines.push(`    Extra content in expected: "${escapeString(expected.slice(actual.length))}"`);
        } else {
            lines.push(`    Extra content in actual: "${escapeString(actual.slice(expected.length))}"`);
        }
    }

    return lines.join('\n');
}

/**
 * Find all start indices where expected lines match exactly.
 */
function findExactMatchStartIndices(lines: string[], expectedLines: string[]): number[] {
    if (expectedLines.length === 0) {
        return [];
    }

    const matches: number[] = [];
    const maxStart = lines.length - expectedLines.length;

    for (let start = 0; start <= maxStart; start++) {
        let matched = true;
        for (let i = 0; i < expectedLines.length; i++) {
            if (lines[start + i] !== expectedLines[i]) {
                matched = false;
                break;
            }
        }

        if (matched) {
            matches.push(start);
        }
    }

    return matches;
}

export class SurgicalEditTool extends BaseTool<typeof schema> {
    name = 'precise_replace';

    description = `Performs exact string replacements in files.

=============================================================================
CRITICAL WORKFLOW (MUST FOLLOW TO AVOID FAILURES):

STEP 1: ALWAYS read file BEFORE using precise_replace
  - Call read_file to get the CURRENT file content
  - File content may have changed from previous modifications
  - NEVER guess or assume the content - always read first

STEP 2: Copy oldText EXACTLY from read_file output
  - Include ALL leading spaces/tabs (indentation)
  - Include ALL trailing spaces  
  - Copy character-for-character from read_file output
  - Verify line number matches read_file range output

STEP 3: For MULTIPLE modifications to SAME file:
  - PREFERRED: Use batch_replace (single call, all changes based on same snapshot)
  - AVOID: Multiple precise_replace calls (each re-reads file, may fail due to content changes)

=============================================================================
COMMON FAILURE CAUSES:
- Missing indentation: "key": "value" vs '    "key": "value"'
- Wrong line number: verify against read_file range output
- Stale content: file was modified by previous tool call - re-read first
- Extra/missing characters: copy-paste carefully from read_file

WHEN precise_replace FAILS:
1. The error shows actual content at the specified line
2. Call read_file again to get updated content
3. Copy the EXACT actual content for your retry
4. Better: Use batch_replace for multiple changes

TOOL SELECTION GUIDE:
- Single small change + read file first → precise_replace
- Multiple changes to same file → batch_replace (PREFERRED, lower stale-content risk)
- Large refactoring → write_file
`;

    schema = schema;

    async execute(
        { filePath, line, oldText, newText }: z.infer<typeof this.schema>,
        _context?: ToolContext
    ): Promise<ToolResult> {
        let fullPath: string;
        try {
            fullPath = resolveAndValidatePath(filePath);
        } catch (error) {
            if (error instanceof PathTraversalError) {
                return this.result({
                    success: false,
                    metadata: { error: 'PATH_TRAVERSAL_DETECTED', filePath },
                    output: `PATH_TRAVERSAL_DETECTED: ${error.message}`,
                });
            }
            throw error;
        }

        // === 1. Check if file exists ===
        if (!fs.existsSync(fullPath)) {
            return this.result({
                success: false,
                metadata: { error: 'FILE_NOT_FOUND', filePath },
                output: `FILE_NOT_FOUND: ${filePath}`,
            });
        }

        // === 2. Read file ===
        let content: string;
        try {
            content = fs.readFileSync(fullPath, 'utf-8');
        } catch (error) {
            throw new Error(`Failed to read file: ${error}`);
        }

        // === 3. Preserve trailing newline state ===
        // Check if original file ends with newline (LF or CRLF)
        const hadTrailingNewline = content.endsWith('\n');
        const hadCRLF = content.includes('\r\n');

        // === 4. Normalize line endings ===
        const normalizedContent = normalizeLineEndings(content);
        const normalizedOldText = normalizeLineEndings(oldText);
        const normalizedNewText = normalizeLineEndings(newText);

        // === 5. Split into lines (consistent with read_file trailing empty line handling) ===
        const lines = splitAndFilterEmptyTail(normalizedContent);
        const oldTextLines = splitAndFilterEmptyTail(normalizedOldText);

        const expectedText = oldTextLines.join('\n');
        const expectedMatches = findExactMatchStartIndices(lines, oldTextLines);
        let targetLineIdx = line - 1;
        let autoCorrected = false;

        // === 6. Check line range and attempt global auto-correction ===
        if (line < 1 || line > lines.length) {
            if (expectedMatches.length === 1) {
                targetLineIdx = expectedMatches[0];
                autoCorrected = true;
            } else {
                const ambiguousTip =
                    expectedMatches.length > 1
                        ? `\nFound ${expectedMatches.length} exact matches at lines: ${expectedMatches
                              .map((idx) => idx + 1)
                              .slice(0, 10)
                              .join(', ')}`
                        : '';

                return this.result({
                    success: false,
                    metadata: { error: 'LINE_OUT_OF_RANGE', line, fileLength: lines.length },
                    output: `LINE_OUT_OF_RANGE: line ${line} is out of range (file has ${lines.length} lines, valid range: 1-${lines.length})${ambiguousTip}`,
                });
            }
        }

        // === 7. Check if enough lines available, then attempt global auto-correction ===
        if (targetLineIdx + oldTextLines.length > lines.length) {
            if (expectedMatches.length === 1) {
                targetLineIdx = expectedMatches[0];
                autoCorrected = true;
            } else {
                const contextSnippet = generateContextSnippet(
                    lines,
                    Math.min(targetLineIdx, lines.length - 1),
                    oldTextLines.length
                );
                const ambiguousTip =
                    expectedMatches.length > 1
                        ? `\nFound ${expectedMatches.length} exact matches at lines: ${expectedMatches
                              .map((idx) => idx + 1)
                              .slice(0, 10)
                              .join(', ')}`
                        : '';

                return this.result({
                    success: false,
                    metadata: {
                        error: 'TEXT_NOT_FOUND',
                        reason: 'Not enough lines from specified position',
                        expectedLines: oldTextLines.length,
                        availableLines: Math.max(0, lines.length - targetLineIdx),
                    },
                    output: `TEXT_NOT_FOUND: Need ${oldTextLines.length} lines starting from line ${line}, but only ${Math.max(0, lines.length - targetLineIdx)} lines available${ambiguousTip}

=== Content near line ${line} ===
${contextSnippet}
=== End ===`,
                });
            }
        }

        // === 8. Extract actual text and compare ===
        const actualText = lines.slice(targetLineIdx, targetLineIdx + oldTextLines.length).join('\n');

        if (actualText !== expectedText) {
            if (expectedMatches.length === 1) {
                targetLineIdx = expectedMatches[0];
                autoCorrected = true;
            } else if (expectedMatches.length > 1) {
                return this.result({
                    success: false,
                    metadata: {
                        error: 'TEXT_NOT_FOUND',
                        line,
                        reason: 'Multiple exact matches found, line disambiguation required',
                        candidateLines: expectedMatches.map((idx) => idx + 1),
                    },
                    output: `TEXT_NOT_FOUND at line ${line}: Text does not match oldText

AMBIGUOUS_MATCH: Found ${expectedMatches.length} exact matches at lines: ${expectedMatches
                        .map((idx) => idx + 1)
                        .slice(0, 10)
                        .join(', ')}

TIP: Retry with the exact matching line number.`,
                });
            }
        }

        // Recompute text after optional auto-correction
        const correctedActualText = lines.slice(targetLineIdx, targetLineIdx + oldTextLines.length).join('\n');
        if (correctedActualText !== expectedText) {
            const diffReport = generateDiffReport(correctedActualText, expectedText);
            const contextSnippet = generateContextSnippet(lines, targetLineIdx, oldTextLines.length);

            // Extract the exact actual content for easy copying
            const actualContentForCopy = lines.slice(targetLineIdx, targetLineIdx + oldTextLines.length).join('\n');

            return this.result({
                success: false,
                metadata: {
                    error: 'TEXT_NOT_FOUND',
                    line,
                    expectedLines: oldTextLines.length,
                    reason: 'Text at specified position does not match oldText',
                    expectedPreview: expectedText.slice(0, 100),
                    actualPreview: correctedActualText.slice(0, 100),
                    actualContent: actualContentForCopy,
                },
                output: `TEXT_NOT_FOUND at line ${line}: Text does not match oldText

=== Diff Report ===
${diffReport}

=== Content near line ${line} ===
${contextSnippet}
=== End ===

=== EXACT content at line ${line} (copy this for oldText) ===
${actualContentForCopy}
=== End ===

TIP: Copy the EXACT content above, including ALL indentation spaces, and retry.`,
            });
        }

        // === 9. Execute modification ===
        const newTextLines = splitAndFilterEmptyTail(normalizedNewText);
        lines.splice(targetLineIdx, oldTextLines.length, ...newTextLines);

        // === 10. Write file (preserve trailing newline) ===
        try {
            let newContent = lines.join('\n');

            // Restore trailing newline if original file had one
            if (hadTrailingNewline) {
                newContent += '\n';
            }

            // Restore CRLF if original file used CRLF
            if (hadCRLF) {
                newContent = newContent.replace(/\n/g, '\r\n');
            }

            fs.writeFileSync(fullPath, newContent);
        } catch (error) {
            throw new Error(`Failed to write file: ${error}`);
        }

        return this.result({
            success: true,
            metadata: {
                filePath,
                line,
                actualLine: targetLineIdx + 1,
                autoCorrected,
                message: 'Modification successful',
            },
            output: autoCorrected
                ? `Replaced line ${targetLineIdx + 1} in ${filePath} (requested line ${line}, auto-corrected by unique global match)`
                : `Replaced line ${line} in ${filePath}`,
        });
    }
}
