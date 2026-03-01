/**
 * 响应恢复模块
 *
 * 当 LLM 流式响应验证失败时，尝试从已接收的内容中恢复。
 *
 * 恢复策略：
 * 1. 工具调用优先 - 如果有完整的工具调用，优先使用
 * 2. 部分内容恢复 - 保留已接收的有效文本内容
 * 3. 重试决策 - 判断是否需要压缩上下文后重试
 *
 * 设计原则：
 * - 最小化用户感知的错误
 * - 尽可能保留有效内容
 * - 智能决策是否需要重试
 */

import type { StreamToolCall } from '../core-types';
import type { ValidationResult } from '../response-validator';

// ==================== 类型定义 ====================

/**
 * 恢复模块配置
 */
export interface RecoveryOptions {
    /** 是否启用部分恢复（默认 true） */
    enablePartialRecovery: boolean;
    /** 最小有效内容长度（字符），低于此值不尝试恢复（默认 50） */
    minValidContentLength: number;
    /** 是否启用重试（默认 true） */
    enableRetry: boolean;
    /** 工具调用参数最小有效长度（默认 10） */
    minToolCallArgsLength: number;
    /** 内容质量阈值（0-1），低于此值认为内容质量太差不恢复（默认 0.3） */
    contentQualityThreshold: number;
}

/**
 * 恢复上下文 - 包含验证失败时的所有可用信息
 */
export interface RecoveryContext {
    /** 验证失败结果 */
    validationViolation: ValidationResult;
    /** 已接收的文本内容 */
    content: string;
    /** 已接收的推理内容 */
    reasoningContent?: string;
    /** 已接收的工具调用 */
    toolCalls: StreamToolCall[];
    /** 消息 ID */
    messageId: string;
    /** 总接收字符数（用于日志） */
    totalReceivedChars: number;
}

/**
 * 恢复策略
 */
export type RecoveryStrategy = 'partial' | 'retry' | 'abort';

/**
 * 恢复结果
 */
export interface RecoveryResult {
    /** 采用的恢复策略 */
    strategy: RecoveryStrategy;
    /** 恢复后的部分响应（partial 策略） */
    partialResponse?: PartialResponse;
    /** 是否需要压缩上下文后重试 */
    needsCompaction?: boolean;
    /** 最终错误（abort 策略） */
    error?: {
        message: string;
        code: string;
    };
    /** 恢复决策原因（用于日志和调试） */
    reason: string;
}

/**
 * 部分响应
 */
export interface PartialResponse {
    /** 文本内容 */
    content: string;
    /** 推理内容 */
    reasoningContent?: string;
    /** 工具调用 */
    toolCalls: StreamToolCall[];
    /** 是否有完整的工具调用 */
    hasCompleteToolCalls: boolean;
    /** 内容质量评分（0-1） */
    qualityScore: number;
}

// ==================== 默认配置 ====================

const DEFAULT_OPTIONS: RecoveryOptions = {
    enablePartialRecovery: true,
    minValidContentLength: 50,
    enableRetry: true,
    minToolCallArgsLength: 10,
    contentQualityThreshold: 0.3,
};

// ==================== 主类 ====================

/**
 * 响应恢复器
 */
export class ResponseRecovery {
    private readonly options: RecoveryOptions;

    constructor(options?: Partial<RecoveryOptions>) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * 尝试从验证失败中恢复
     *
     * 决策流程：
     * 1. 检查是否有完整的工具调用 → 优先使用
     * 2. 检查部分内容是否有效 → 尝试恢复
     * 3. 检查是否适合重试 → 建议重试
     * 4. 以上都不满足 → 放弃
     */
    attemptRecovery(context: RecoveryContext): RecoveryResult {
        const { content, toolCalls, validationViolation } = context;

        // 0. 如果禁用恢复，直接放弃
        if (!this.options.enablePartialRecovery) {
            return this.createAbortResult('Partial recovery is disabled', context);
        }

        // 1. 检查是否有完整的工具调用
        const completeToolCalls = this.filterCompleteToolCalls(toolCalls);
        if (completeToolCalls.length > 0) {
            return this.createPartialResult(
                {
                    content: this.sanitizeContent(content),
                    toolCalls: completeToolCalls,
                    hasCompleteToolCalls: true,
                    qualityScore: 1.0, // 有完整工具调用时质量评分最高
                },
                `Recovered ${completeToolCalls.length} complete tool call(s)`
            );
        }

        // 2. 评估部分内容质量
        const qualityScore = this.evaluateContentQuality(content, validationViolation);

        // 3. 如果内容质量足够高，尝试恢复
        if (
            qualityScore >= this.options.contentQualityThreshold &&
            content.length >= this.options.minValidContentLength
        ) {
            return this.createPartialResult(
                {
                    content: this.sanitizeContent(content),
                    reasoningContent: context.reasoningContent
                        ? this.sanitizeContent(context.reasoningContent)
                        : undefined,
                    toolCalls: [],
                    hasCompleteToolCalls: false,
                    qualityScore,
                },
                `Recovered partial content (quality: ${(qualityScore * 100).toFixed(0)}%, length: ${content.length})`
            );
        }

        // 4. 内容质量太差，考虑重试
        if (this.options.enableRetry && this.shouldRetryWithCompaction(context)) {
            return {
                strategy: 'retry',
                needsCompaction: true,
                reason: 'Content quality too low, retry with context compaction recommended',
            };
        }

        // 5. 无法恢复，放弃
        return this.createAbortResult(
            `Content quality too low (${(qualityScore * 100).toFixed(0)}%) and length insufficient (${content.length} < ${this.options.minValidContentLength})`,
            context
        );
    }

    // ==================== 私有方法：工具调用处理 ====================

    /**
     * 过滤出完整的工具调用
     */
    private filterCompleteToolCalls(toolCalls: StreamToolCall[]): StreamToolCall[] {
        return toolCalls.filter((tc) => this.isToolCallComplete(tc));
    }

    /**
     * 检查工具调用是否完整
     */
    private isToolCallComplete(tc: StreamToolCall): boolean {
        // 必须有 ID
        if (!tc.id || tc.id.trim() === '') {
            return false;
        }

        // 必须有函数名
        if (!tc.function?.name || tc.function.name.trim() === '') {
            return false;
        }

        // 参数必须有足够长度（至少是空对象 "{}"）
        const args = tc.function?.arguments || '';
        if (args.length < this.options.minToolCallArgsLength) {
            return false;
        }

        // 尝试解析参数，确保是有效 JSON
        try {
            const parsed = JSON.parse(args);
            // 如果解析成功且是对象，认为是完整的
            return typeof parsed === 'object' && parsed !== null;
        } catch {
            return false;
        }
    }

    // ==================== 私有方法：内容质量评估 ====================

    /**
     * 评估内容质量
     *
     * 评分维度：
     * 1. 长度 - 内容越长越可能有效
     * 2. 结构 - 是否有完整句子/段落
     * 3. 异常模式 - 验证失败检测到的问题严重程度
     */
    private evaluateContentQuality(content: string, violation: ValidationResult): number {
        if (!content || content.trim().length === 0) {
            return 0;
        }

        let score = 1.0;

        // 1. 长度加分（最多 +0.2）
        const lengthBonus = Math.min(content.length / 1000, 0.2);
        score += lengthBonus;

        // 2. 结构完整性（有完整句子 +0.2）
        if (this.hasCompleteSentences(content)) {
            score += 0.2;
        }

        // 3. 根据验证失败类型扣分
        if (!violation.valid) {
            switch (violation.violationType) {
                case 'repetition':
                    score -= 0.4;
                    break;
                case 'nonsense':
                    score -= 0.5;
                    break;
                case 'encoding':
                    score -= 0.3;
                    break;
                case 'length':
                    score -= 0.1;
                    break;
                default:
                    score -= 0.3;
            }

            // 根据检测到的问题数量额外扣分
            const patternCount = violation.detectedPatterns?.length || 0;
            score -= Math.min(patternCount * 0.1, 0.3);
        }

        // 确保分数在 0-1 范围内
        return Math.max(0, Math.min(1, score));
    }

    /**
     * 检查是否有完整的句子
     */
    private hasCompleteSentences(content: string): boolean {
        // 检查是否有句子结束标点
        const sentenceEndings = /[。！？.!?]/g;
        const matches = content.match(sentenceEndings);
        return matches !== null && matches.length >= 1;
    }

    // ==================== 私有方法：内容清理 ====================

    /**
     * 清理内容，移除明显的异常片段
     */
    private sanitizeContent(content: string): string {
        if (!content) return '';

        let sanitized = content;

        // 1. 移除重复的空行（保留最多一个空行）
        sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

        // 2. 移除行尾空格
        sanitized = sanitized.replace(/[ \t]+$/gm, '');

        // 3. 移除连续重复的单词（简单处理）
        sanitized = sanitized.replace(/\b(\w+)\s+\1\s+\1\s+\1\b/gi, '$1');

        // 4. 移除可疑的控制字符（保留换行、制表符、回车）
        // eslint-disable-next-line no-control-regex
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

        return sanitized.trim();
    }

    // ==================== 私有方法：重试决策 ====================

    /**
     * 判断是否应该压缩上下文后重试
     */
    private shouldRetryWithCompaction(context: RecoveryContext): boolean {
        const { validationViolation, totalReceivedChars } = context;

        // 如果是长度问题，可能需要压缩
        if (validationViolation.violationType === 'length') {
            return false; // 长度问题压缩也没用
        }

        // 如果是编码问题，重试可能有效
        if (validationViolation.violationType === 'encoding') {
            return true;
        }

        // 如果内容非常少（可能是上下文问题导致的早期崩溃）
        if (totalReceivedChars < 100) {
            return true;
        }

        // 重复或无意义模式，可能是上下文过长导致的幻觉
        if (validationViolation.violationType === 'repetition' || validationViolation.violationType === 'nonsense') {
            return true;
        }

        return false;
    }

    // ==================== 私有方法：结果构建 ====================

    private createPartialResult(partialResponse: PartialResponse, reason: string): RecoveryResult {
        return {
            strategy: 'partial',
            partialResponse,
            reason,
        };
    }

    private createAbortResult(reason: string, context: RecoveryContext): RecoveryResult {
        return {
            strategy: 'abort',
            error: {
                message: `Unable to recover from validation failure: ${reason}`,
                code: 'RECOVERY_FAILED',
            },
            reason: `${reason} (content length: ${context.content.length}, tool calls: ${context.toolCalls.length})`,
        };
    }

    // ==================== 公共方法：配置 ====================

    /**
     * 获取当前配置
     */
    getOptions(): Readonly<RecoveryOptions> {
        return { ...this.options };
    }
}

// ==================== 工厂函数 ====================

/**
 * 创建默认的响应恢复器
 */
export function createResponseRecovery(options?: Partial<RecoveryOptions>): ResponseRecovery {
    return new ResponseRecovery(options);
}
