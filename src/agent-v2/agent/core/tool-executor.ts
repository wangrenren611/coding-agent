/**
 * 工具执行器
 * 
 * 封装工具调用执行逻辑。
 * 
 * 职责：
 * 1. 执行工具调用
 * 2. 记录工具结果
 * 3. 敏感信息脱敏
 */

import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import type { ToolRegistry } from '../../tool/registry';
import type { ToolContext } from '../../tool/base';
import type { ToolCall, ToolExecutionResult } from '../core-types';
import type { Message } from '../../session/types';
import { createToolResultMessage } from '../message-builder';
import { sanitizeToolResult as sanitizeToolResultUtil, toolResultToString } from '../../security';
import { safeParse } from '../../util';

const PATCH_PATH_KEYS = new Set(['filePath', 'path', 'targetPath', 'fromPath', 'toPath']);
const MAX_SNAPSHOT_BYTES = 300 * 1024;
const MAX_PATCH_CHARS = 200 * 1024;

interface FileSnapshot {
    absolutePath: string;
    displayPath: string;
    existedBefore: boolean;
    beforeContent: string;
}

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

    // 回调
    /** 工具调用创建回调 */
    onToolCallCreated?: (toolCalls: ToolCall[], messageId: string, content?: string) => void;
    /** 工具调用结果回调 */
    onToolCallResult?: (
        toolCallId: string,
        result: unknown,
        status: 'success' | 'error',
        messageId: string
    ) => void;
    /** 工具执行流式输出回调 */
    onToolCallStream?: (toolCallId: string, output: string, messageId: string) => void;
    /** 代码补丁回调 */
    onCodePatch?: (filePath: string, diff: string, messageId: string, language?: string) => void;
    /** 消息添加回调 */
    onMessageAdd?: (message: Message) => void;
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
}

/**
 * 工具执行器
 */
export class ToolExecutor {
    private readonly config: ToolExecutorConfig;

    constructor(config: ToolExecutorConfig) {
        this.config = config;
    }

    /**
     * 执行工具调用
     */
    async execute(
        toolCalls: ToolCall[],
        messageId: string,
        messageContent?: string
    ): Promise<ToolExecutionOutput> {
        // 触发工具调用创建回调
        this.config.onToolCallCreated?.(toolCalls, messageId, messageContent);

        const fileSnapshots = this.captureFileSnapshots(toolCalls);
        const streamedToolCallIds = new Set<string>();

        // 构建工具上下文
        const toolContext = this.buildToolContext();

        // 执行工具
        const results = await this.config.toolRegistry.execute(toolCalls, {
            ...toolContext,
            onToolStream: (toolCallId, _toolName, output) => {
                if (!output) return;
                streamedToolCallIds.add(toolCallId);
                this.config.onToolCallStream?.(toolCallId, output, messageId);
            },
        });

        // 记录结果
        const resultMessages = this.recordResults(results, messageId, streamedToolCallIds);
        this.emitCodePatches(fileSnapshots, messageId);

        return {
            success: results.every(r => r.result?.success !== false),
            toolCount: results.length,
            resultMessages,
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
        };

        if (this.config.memoryManager) {
            context.memoryManager = this.config.memoryManager;
        }

        if (this.config.streamCallback) {
            context.streamCallback = this.config.streamCallback;
        }

        return context;
    }

    /**
     * 记录工具执行结果
     */
    private recordResults(
        results: ToolExecutionResult[],
        messageId: string,
        streamedToolCallIds: Set<string>
    ): Message[] {
        const messages: Message[] = [];

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

            // 创建工具结果消息
            const message = createToolResultMessage(
                result.tool_call_id,
                outputText,
                resultMessageId
            );

            // 添加到会话
            this.config.onMessageAdd?.(message);
            messages.push(message);
        }

        return messages;
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
        const resolved = path.isAbsolute(rawPath)
            ? path.normalize(rawPath)
            : path.resolve(process.cwd(), rawPath);
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
