/**
 * 工具执行器
 *
 * 封装工具调用执行逻辑。
 *
 * 职责：
 * 1. 执行工具调用
 * 2. 记录工具结果
 * 3. 敏感信息脱敏
 * 4. 可选权限策略校验（PermissionEngine）
 */

import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { ToolCallValidationError, ToolRegistry } from '../../tool/registry';
import type { ToolContext } from '../../tool/base';
import type { ToolCall, ToolExecutionResult } from '../core-types';
import type { Message } from '../../session/types';
import { sanitizeToolResult as sanitizeToolResultUtil, toolResultToString } from '../../security';
import type { PermissionEngine } from '../../security/permission-engine';
import { createDefaultPermissionEngine } from '../../security/permission-engine';
import { safeParse } from '../../util';
import { AgentAbortedError, LLMResponseInvalidError, PermissionDecisionError } from '../errors';

const PATCH_PATH_KEYS = new Set(['filePath', 'path', 'targetPath', 'fromPath', 'toPath']);
const MAX_SNAPSHOT_BYTES = 300 * 1024;
const MAX_PATCH_CHARS = 200 * 1024;

interface FileSnapshot {
    absolutePath: string;
    displayPath: string;
    existedBefore: boolean;
    beforeContent: string;
}

interface AuthorizationOutcome {
    allowlistBypassedCallIds: Set<string>;
}

export interface InvalidToolInputDiagnostic {
    toolCallId: string;
    toolName: string;
    errorCode: string;
    reason: string;
    argumentsBytes: number;
}

interface PreparedToolResultMessage {
    message: Message;
}

interface PreparedToolResults {
    messages: PreparedToolResultMessage[];
    invalidDiagnostics: InvalidToolInputDiagnostic[];
}

const INVALID_INPUT_ERROR_CODES = new Set([
    'INVALID_INPUT_ARGUMENT_JSON',
    'INVALID_INPUT_SCHEMA',
    'INVALID_OLD_TEXT_PLACEHOLDER',
    'PRECONDITION_READ_REQUIRED',
    'OPTIMISTIC_LOCK_HASH_MISMATCH',
    'OPTIMISTIC_LOCK_VERSION_MISMATCH',
    'EXPECTED_VERSION_REQUIRES_SNAPSHOT',
    'TEXT_NOT_FOUND',
    'TEXT_NOT_FOUND_RETRY_LIMIT',
]);

/**
 * 工具执行器配置
 */
export interface ToolExecutorConfig {
    /** 工具注册表 */
    toolRegistry: ToolRegistry;
    /** 会话 ID */
    sessionId: string;
    /** 记忆管理器（可选） */
    memoryManager?: ToolContext['memoryManager'];
    /** 流式输出回调（用于子 Agent 事件冒泡） */
    streamCallback?: ToolContext['streamCallback'];
    /** Plan 模式（只读模式） */
    planMode?: boolean;
    /** 是否启用 PermissionEngine（默认 true） */
    enablePermissionEngine?: boolean;
    /** 权限引擎（可选，不提供则使用默认引擎） */
    permissionEngine?: PermissionEngine;
    /** ASK 权限确认回调（true=继续，false=中止） */
    onPermissionAsk?: (context: {
        ticketId: string;
        toolName: string;
        reason: string;
        source?: string;
        args: string;
        messageId: string;
    }) => boolean | Promise<boolean>;

    // 回调
    /** 工具调用创建回调 */
    onToolCallCreated?: (toolCalls: ToolCall[], messageId: string, content?: string) => void;
    /** 工具调用结果回调 */
    onToolCallResult?: (toolCallId: string, result: unknown, status: 'success' | 'error', messageId: string) => void;
    /** 工具执行流式输出回调 */
    onToolCallStream?: (toolCallId: string, output: string, messageId: string) => void;
    /** 代码补丁回调 */
    onCodePatch?: (filePath: string, diff: string, messageId: string, language?: string) => void;
    /** 消息添加回调 */
    onMessageAdd?: (message: Message) => void;
    /** 无效输入诊断回调（仅诊断，不入会话） */
    onInvalidInputDiagnostic?: (diagnostic: InvalidToolInputDiagnostic) => void;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionOutput {
    /** 是否成功 */
    success: boolean;
    /** 执行的工具数量 */
    toolCount: number;
    /** 工具结果消息 */
    resultMessages: Message[];
    /** 是否检测到 invalid_input（检测到时 resultMessages 不会提交） */
    invalidInputDetected: boolean;
    /** invalid_input 诊断信息 */
    invalidDiagnostics: InvalidToolInputDiagnostic[];
    /** 当前 turn 是否已提交 */
    committed: boolean;
}

/**
 * 工具执行器
 */
export class ToolExecutor {
    private readonly config: ToolExecutorConfig;
    private readonly enablePermissionEngine: boolean;
    private readonly permissionEngine?: PermissionEngine;
    private readonly approvedAskFingerprints = new Set<string>();

    constructor(config: ToolExecutorConfig) {
        this.config = config;
        this.enablePermissionEngine = config.enablePermissionEngine !== false;
        if (this.enablePermissionEngine) {
            this.permissionEngine = config.permissionEngine ?? createDefaultPermissionEngine();
        }
    }

    /**
     * 执行工具调用
     */
    async execute(toolCalls: ToolCall[], messageId: string, messageContent?: string): Promise<ToolExecutionOutput> {
        // tool_calls 校验下沉到 ToolRegistry，Agent 仅负责协调调用。
        try {
            this.config.toolRegistry.validateToolCalls(toolCalls);
        } catch (error) {
            if (error instanceof ToolCallValidationError) {
                throw new LLMResponseInvalidError(error.message);
            }
            throw error;
        }

        const authorizationOutcome = this.enablePermissionEngine
            ? await this.authorizeToolCalls(toolCalls, messageId)
            : { allowlistBypassedCallIds: new Set<string>() };

        // 触发工具调用创建回调
        this.config.onToolCallCreated?.(toolCalls, messageId, messageContent);

        const fileSnapshots = this.captureFileSnapshots(toolCalls);
        const streamedToolCallIds = new Set<string>();

        // 构建工具上下文
        const toolContext = this.buildToolContext();

        // 执行工具
        const results = await this.config.toolRegistry.execute(toolCalls, {
            ...toolContext,
            isAllowlistBypassed: (toolCallId, toolName) =>
                toolName === 'bash' && authorizationOutcome.allowlistBypassedCallIds.has(toolCallId),
            onToolStream: (toolCallId, _toolName, output) => {
                if (!output) return;
                streamedToolCallIds.add(toolCallId);
                this.config.onToolCallStream?.(toolCallId, output, messageId);
            },
        });

        // 预处理结果（先诊断，再决定是否提交）
        const preparedResults = this.prepareResultMessages(results, messageId, streamedToolCallIds);
        if (preparedResults.invalidDiagnostics.length > 0) {
            for (const diagnostic of preparedResults.invalidDiagnostics) {
                this.config.onInvalidInputDiagnostic?.(diagnostic);
            }
            return {
                success: false,
                toolCount: results.length,
                resultMessages: [],
                invalidInputDetected: true,
                invalidDiagnostics: preparedResults.invalidDiagnostics,
                committed: false,
            };
        }

        // 提交工具结果消息
        const resultMessages = this.commitResultMessages(preparedResults.messages);
        this.emitCodePatches(fileSnapshots, messageId);

        return {
            success: results.every((r) => r.result?.success !== false),
            toolCount: results.length,
            resultMessages,
            invalidInputDetected: false,
            invalidDiagnostics: [],
            committed: true,
        };
    }

    /**
     * 构建工具上下文
     */
    private buildToolContext(): ToolContext {
        const context: ToolContext = {
            sessionId: this.config.sessionId,
            environment: process.env.NODE_ENV || 'development',
            platform: process.platform,
            time: new Date().toISOString(),
            workingDirectory: process.cwd(),
            planMode: this.config.planMode === true,
        };

        if (this.config.memoryManager) {
            context.memoryManager = this.config.memoryManager;
        }

        if (this.config.streamCallback) {
            context.streamCallback = this.config.streamCallback;
        }

        return context;
    }

    private async authorizeToolCalls(toolCalls: ToolCall[], messageId: string): Promise<AuthorizationOutcome> {
        if (!this.permissionEngine) {
            return { allowlistBypassedCallIds: new Set<string>() };
        }

        const deniedDecisions: Array<{ toolName: string; reason: string; source?: string }> = [];
        const allowlistBypassedCallIds = new Set<string>();
        const batchApprovalDecisions = new Map<string, boolean>();

        for (const toolCall of toolCalls) {
            const toolName = toolCall.function?.name || 'unknown';
            const decision = this.permissionEngine.evaluate({
                toolCall,
                sessionId: this.config.sessionId,
                messageId,
                planMode: this.config.planMode === true,
            });

            if (decision.effect === 'allow') {
                continue;
            }

            if (decision.effect === 'ask') {
                const ticketId = decision.ticket?.id || 'unknown-ticket';
                const reason = decision.reason || `Tool "${toolName}" requires explicit approval`;
                const askFingerprint = this.buildAskFingerprint(
                    toolCall,
                    decision.source,
                    decision.ticket?.fingerprint
                );
                const batchKey = this.buildAskBatchKey(toolCall, decision.source, reason);

                if (this.approvedAskFingerprints.has(askFingerprint)) {
                    if (toolName === 'bash' && decision.source === 'legacy_bash') {
                        allowlistBypassedCallIds.add(toolCall.id);
                    }
                    continue;
                }

                const batchApproval = batchApprovalDecisions.get(batchKey);
                if (batchApproval === true) {
                    this.approvedAskFingerprints.add(askFingerprint);
                    if (toolName === 'bash' && decision.source === 'legacy_bash') {
                        allowlistBypassedCallIds.add(toolCall.id);
                    }
                    continue;
                }
                if (batchApproval === false) {
                    throw new AgentAbortedError(
                        `Permission rejected by user for tool "${toolName}" (ticket=${ticketId})`
                    );
                }

                if (this.config.onPermissionAsk) {
                    const approved = await this.config.onPermissionAsk({
                        ticketId,
                        toolName,
                        reason,
                        source: decision.source,
                        args: toolCall.function?.arguments || '',
                        messageId,
                    });
                    batchApprovalDecisions.set(batchKey, approved);
                    if (approved) {
                        this.approvedAskFingerprints.add(askFingerprint);
                        if (toolName === 'bash' && decision.source === 'legacy_bash') {
                            allowlistBypassedCallIds.add(toolCall.id);
                        }
                        continue;
                    }
                    throw new AgentAbortedError(
                        `Permission rejected by user for tool "${toolName}" (ticket=${ticketId})`
                    );
                }
                throw new PermissionDecisionError({
                    effect: 'ask',
                    toolName,
                    reason,
                    ticketId,
                    source: decision.source,
                });
            }

            const reason = decision.reason || `Tool "${toolName}" is denied by permission policy`;
            deniedDecisions.push({ toolName, reason, source: decision.source });
        }

        if (deniedDecisions.length === 1) {
            const denied = deniedDecisions[0];
            throw new PermissionDecisionError({
                effect: 'deny',
                toolName: denied.toolName,
                reason: denied.reason,
                source: denied.source,
            });
        }

        if (deniedDecisions.length > 1) {
            const details = deniedDecisions
                .map(
                    (item) => `Tool "${item.toolName}": ${item.reason}${item.source ? ` [source=${item.source}]` : ''}`
                )
                .join(' | ');
            throw new LLMResponseInvalidError(`PERMISSION_DENIED: ${details}`);
        }

        return { allowlistBypassedCallIds };
    }

    private buildAskFingerprint(toolCall: ToolCall, source?: string, ticketFingerprint?: string): string {
        if (ticketFingerprint && ticketFingerprint.trim().length > 0) {
            return `${toolCall.function?.name || 'unknown'}:${source || 'rule'}:${ticketFingerprint}`;
        }

        const raw = `${toolCall.function?.name || 'unknown'}:${source || 'rule'}:${toolCall.function?.arguments || ''}`;
        return createHash('sha256').update(raw).digest('hex').slice(0, 32);
    }

    private buildAskBatchKey(toolCall: ToolCall, source: string | undefined, reason: string): string {
        return `${toolCall.function?.name || 'unknown'}:${source || 'rule'}:${reason}`;
    }

    /**
     * 预处理工具执行结果（不直接提交消息）
     */
    private prepareResultMessages(
        results: ToolExecutionResult[],
        messageId: string,
        streamedToolCallIds: Set<string>
    ): PreparedToolResults {
        const messages: PreparedToolResultMessage[] = [];
        const invalidDiagnostics: InvalidToolInputDiagnostic[] = [];

        for (const result of results) {
            const resultMessageId = uuid();
            const sanitized = this.sanitizeToolResult(result);
            const outputText = this.safeToolResultToString(sanitized);

            if (!streamedToolCallIds.has(result.tool_call_id) && outputText) {
                this.config.onToolCallStream?.(result.tool_call_id, outputText, messageId);
            }

            // 触发回调
            this.config.onToolCallResult?.(
                result.tool_call_id,
                sanitized,
                result.result?.success ? 'success' : 'error',
                resultMessageId
            );

            const invalidDiagnostic = this.classifyInvalidInput(result, outputText);
            if (invalidDiagnostic) {
                invalidDiagnostics.push(invalidDiagnostic);
                continue;
            }

            messages.push({
                message: {
                    messageId: resultMessageId,
                    role: 'tool',
                    content: outputText,
                    tool_call_id: result.tool_call_id,
                    type: 'tool-result',
                },
            });
        }

        return { messages, invalidDiagnostics };
    }

    /**
     * 提交工具执行结果到会话
     */
    private commitResultMessages(preparedMessages: PreparedToolResultMessage[]): Message[] {
        const messages: Message[] = [];
        for (const prepared of preparedMessages) {
            this.config.onMessageAdd?.(prepared.message);
            messages.push(prepared.message);
        }
        return messages;
    }

    private classifyInvalidInput(result: ToolExecutionResult, outputText: string): InvalidToolInputDiagnostic | null {
        const rawResult = (result.result || {}) as unknown as Record<string, unknown>;
        const metadata = (rawResult.metadata || {}) as Record<string, unknown>;
        const metadataErrorCode = typeof metadata.error === 'string' ? metadata.error.trim() : '';
        const explicitInvalidMarker = metadata.invalid_input === true;
        const rawError = typeof rawResult.error === 'string' ? rawResult.error.trim() : '';
        const normalizedErrorCode = this.extractErrorCode(metadataErrorCode || rawError || outputText);
        const isInvalidCode =
            INVALID_INPUT_ERROR_CODES.has(normalizedErrorCode) ||
            normalizedErrorCode.startsWith('INVALID_INPUT_') ||
            normalizedErrorCode.startsWith('INVALID_');

        if (!explicitInvalidMarker && !isInvalidCode) {
            return null;
        }

        return {
            toolCallId: result.tool_call_id,
            toolName: result.name,
            errorCode: normalizedErrorCode || 'INVALID_INPUT',
            reason: rawError || outputText || metadataErrorCode || 'invalid tool input',
            argumentsBytes: Buffer.byteLength(result.arguments || '', 'utf8'),
        };
    }

    private extractErrorCode(text: string): string {
        if (!text) return '';
        const direct = text.match(/^([A-Z][A-Z0-9_]{2,})\b/);
        if (direct?.[1]) return direct[1];

        const embedded = text.match(/\b([A-Z][A-Z0-9_]{2,})\b/);
        if (embedded?.[1]) return embedded[1];
        return '';
    }

    /**
     * 脱敏工具结果（使用统一的安全模块）
     */
    private sanitizeToolResult(result: ToolExecutionResult): unknown {
        return sanitizeToolResultUtil(result);
    }

    /**
     * 安全地将工具结果转换为字符串（使用统一的安全模块）
     */
    private safeToolResultToString(result: unknown): string {
        return toolResultToString(result);
    }

    /**
     * 获取工具注册表
     */
    getToolRegistry(): ToolRegistry {
        return this.config.toolRegistry;
    }

    private captureFileSnapshots(toolCalls: ToolCall[]): Map<string, FileSnapshot> {
        const snapshots = new Map<string, FileSnapshot>();

        for (const toolCall of toolCalls) {
            const parsedArgs = safeParse(toolCall.function.arguments || '');
            const candidatePaths = this.extractCandidatePaths(parsedArgs);
            for (const candidatePath of candidatePaths) {
                const absolutePath = this.resolveCandidatePath(candidatePath);
                if (!absolutePath || snapshots.has(absolutePath)) continue;

                const snapshot = this.snapshotFile(absolutePath);
                if (!snapshot) continue;
                snapshots.set(absolutePath, snapshot);
            }
        }

        return snapshots;
    }

    private extractCandidatePaths(value: unknown): string[] {
        const collected = new Set<string>();
        this.walkForPaths(value, collected);
        return Array.from(collected);
    }

    private walkForPaths(value: unknown, collected: Set<string>): void {
        if (Array.isArray(value)) {
            for (const item of value) {
                this.walkForPaths(item, collected);
            }
            return;
        }

        if (!value || typeof value !== 'object') {
            return;
        }

        for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            if (PATCH_PATH_KEYS.has(key) && typeof nestedValue === 'string' && nestedValue.trim()) {
                collected.add(nestedValue.trim());
                continue;
            }
            this.walkForPaths(nestedValue, collected);
        }
    }

    private resolveCandidatePath(rawPath: string): string | null {
        const resolved = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(process.cwd(), rawPath);
        return resolved || null;
    }

    private snapshotFile(absolutePath: string): FileSnapshot | null {
        const stat = this.safeStat(absolutePath);
        const displayPath = this.toDisplayPath(absolutePath);

        if (!stat) {
            return {
                absolutePath,
                displayPath,
                existedBefore: false,
                beforeContent: '',
            };
        }

        if (stat.isDirectory() || stat.size > MAX_SNAPSHOT_BYTES) {
            return null;
        }

        const content = this.safeReadFile(absolutePath);
        if (content === null) return null;

        return {
            absolutePath,
            displayPath,
            existedBefore: true,
            beforeContent: content,
        };
    }

    private emitCodePatches(snapshots: Map<string, FileSnapshot>, messageId: string): void {
        for (const snapshot of snapshots.values()) {
            const afterStat = this.safeStat(snapshot.absolutePath);
            const existsAfter = !!afterStat && !afterStat.isDirectory();

            let afterContent = '';
            if (existsAfter) {
                if (afterStat.size > MAX_SNAPSHOT_BYTES) continue;
                const content = this.safeReadFile(snapshot.absolutePath);
                if (content === null) continue;
                afterContent = content;
            }

            if (snapshot.existedBefore === existsAfter && snapshot.beforeContent === afterContent) {
                continue;
            }

            const diff = this.buildUnifiedDiff(
                snapshot.displayPath,
                snapshot.beforeContent,
                afterContent,
                snapshot.existedBefore,
                existsAfter
            );
            if (!diff) continue;

            const language = this.detectLanguage(snapshot.displayPath);
            this.config.onCodePatch?.(snapshot.displayPath, diff, messageId, language);
        }
    }

    private buildUnifiedDiff(
        displayPath: string,
        before: string,
        after: string,
        existedBefore: boolean,
        existsAfter: boolean
    ): string {
        const beforeLines = this.toLines(before);
        const afterLines = this.toLines(after);

        const oldLabel = existedBefore ? `a/${displayPath}` : '/dev/null';
        const newLabel = existsAfter ? `b/${displayPath}` : '/dev/null';
        const oldStart = beforeLines.length > 0 ? 1 : 0;
        const newStart = afterLines.length > 0 ? 1 : 0;

        const diff = [
            `--- ${oldLabel}`,
            `+++ ${newLabel}`,
            `@@ -${oldStart},${beforeLines.length} +${newStart},${afterLines.length} @@`,
            ...beforeLines.map((line) => `-${line}`),
            ...afterLines.map((line) => `+${line}`),
        ].join('\n');

        if (diff.length <= MAX_PATCH_CHARS) return diff;
        return `${diff.slice(0, MAX_PATCH_CHARS)}\n[... Diff truncated ...]`;
    }

    private toLines(content: string): string[] {
        if (!content) return [];
        const normalized = content.replace(/\r\n/g, '\n');
        const lines = normalized.split('\n');
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        return lines;
    }

    private safeReadFile(filePath: string): string | null {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            if (content.includes('\u0000')) {
                return null;
            }
            return content;
        } catch {
            return null;
        }
    }

    private safeStat(filePath: string): fs.Stats | null {
        try {
            return fs.statSync(filePath);
        } catch {
            return null;
        }
    }

    private toDisplayPath(absolutePath: string): string {
        const relative = path.relative(process.cwd(), absolutePath);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            return absolutePath;
        }
        return relative.split(path.sep).join('/');
    }

    private detectLanguage(filePath: string): string | undefined {
        const ext = path.extname(filePath).toLowerCase();
        const languageByExt: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'tsx',
            '.js': 'javascript',
            '.jsx': 'jsx',
            '.json': 'json',
            '.md': 'markdown',
            '.py': 'python',
            '.go': 'go',
            '.rs': 'rust',
            '.java': 'java',
            '.css': 'css',
            '.scss': 'scss',
            '.html': 'html',
            '.yml': 'yaml',
            '.yaml': 'yaml',
            '.sh': 'shell',
        };
        return languageByExt[ext];
    }
}
