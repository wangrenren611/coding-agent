/**
 * 截断核心服务
 *
 * @module truncation/service
 */

import type {
    TruncationConfig,
    TruncationContext,
    TruncationResult,
    TruncationStrategy,
    TruncationEventCallback,
    TruncationEvent,
    ITruncationStorage,
} from './types';
import { DEFAULT_TRUNCATION_CONFIG, TOOL_TRUNCATION_CONFIGS } from './constants';
import { TruncationStorage } from './storage';
import { DefaultTruncationStrategy } from './strategies';

/**
 * 截断服务配置
 */
export interface TruncationServiceConfig {
    /** 全局配置（部分覆盖） */
    global?: Partial<TruncationConfig>;
    /** 工具级别配置覆盖 */
    tools?: Record<string, Partial<TruncationConfig>>;
    /** 事件回调 */
    onEvent?: TruncationEventCallback;
    /** 自定义存储实例 */
    storage?: ITruncationStorage;
    /** 自定义策略实例 */
    strategy?: TruncationStrategy;
}

/**
 * 截断核心服务
 *
 * 职责：
 * - 管理配置（全局 + 工具级别）
 * - 协调截断策略
 * - 管理存储
 * - 发送事件
 *
 * @example
 * ```typescript
 * const service = new TruncationService({
 *   global: { maxLines: 1500 },
 *   tools: { bash: { direction: 'tail' } },
 *   onEvent: (e) => console.log(e),
 * });
 *
 * const result = await service.output(longContent, { toolName: 'grep' });
 * if (result.truncated) {
 *   console.log(`Saved to: ${result.outputPath}`);
 * }
 * ```
 */
export class TruncationService {
    private config: TruncationConfig;
    private toolConfigs: Map<string, Partial<TruncationConfig>>;
    private storage: ITruncationStorage;
    private strategy: TruncationStrategy;
    private onEvent?: TruncationEventCallback;

    constructor(config: TruncationServiceConfig = {}) {
        // 合并默认配置
        this.config = { ...DEFAULT_TRUNCATION_CONFIG, ...config.global };

        // 合并内置工具配置和用户配置
        const mergedToolConfigs = { ...TOOL_TRUNCATION_CONFIGS, ...config.tools };
        this.toolConfigs = new Map(Object.entries(mergedToolConfigs));

        // 存储实例
        this.storage = config.storage || new TruncationStorage(this.config.storageDir);

        // 策略实例
        this.strategy = config.strategy || new DefaultTruncationStrategy();

        // 事件回调
        this.onEvent = config.onEvent;
    }

    /**
     * 截断输出（核心方法）
     *
     * @param content 原始内容
     * @param context 截断上下文
     * @returns 截断结果
     */
    async output(content: string, context: TruncationContext): Promise<TruncationResult> {
        const effectiveConfig = this.getEffectiveConfig(context);

        // 检查是否禁用
        if (!effectiveConfig.enabled) {
            this.emitEvent({
                type: 'skipped',
                toolName: context.toolName,
                originalSize: Buffer.byteLength(content, 'utf-8'),
                truncatedSize: Buffer.byteLength(content, 'utf-8'),
                timestamp: Date.now(),
            });
            return { content, truncated: false };
        }

        // 检查是否需要截断
        if (!this.strategy.needsTruncation(content, effectiveConfig)) {
            this.emitEvent({
                type: 'skipped',
                toolName: context.toolName,
                originalSize: Buffer.byteLength(content, 'utf-8'),
                truncatedSize: Buffer.byteLength(content, 'utf-8'),
                timestamp: Date.now(),
            });
            return { content, truncated: false };
        }

        try {
            // 执行截断
            const truncated = this.strategy.truncate(content, effectiveConfig);
            const originalSize = Buffer.byteLength(content, 'utf-8');

            // 保存完整内容
            const outputPath = await this.storage.save(content, context);

            // 生成提示信息
            const hint = this.generateHint(outputPath, truncated.removedLines, truncated.removedBytes);

            // 格式化最终输出
            const finalContent = this.formatOutput(
                truncated.content,
                hint,
                effectiveConfig.direction,
                truncated.removedLines,
                truncated.removedBytes
            );

            this.emitEvent({
                type: 'truncated',
                toolName: context.toolName,
                originalSize,
                truncatedSize: Buffer.byteLength(finalContent, 'utf-8'),
                outputPath,
                timestamp: Date.now(),
            });

            return {
                content: finalContent,
                truncated: true,
                outputPath,
                removedLines: truncated.removedLines,
                removedBytes: truncated.removedBytes,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.emitEvent({
                type: 'error',
                toolName: context.toolName,
                originalSize: Buffer.byteLength(content, 'utf-8'),
                truncatedSize: Buffer.byteLength(content, 'utf-8'),
                error: errorMessage,
                timestamp: Date.now(),
            });

            // 错误时返回原内容，不截断
            return { content, truncated: false };
        }
    }

    /**
     * 清理过期文件
     *
     * @returns 清理的文件数量
     */
    async cleanup(): Promise<number> {
        return this.storage.cleanup(this.config.retentionDays);
    }

    /**
     * 更新全局配置
     */
    updateConfig(config: Partial<TruncationConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 设置工具特定配置
     */
    setToolConfig(toolName: string, config: Partial<TruncationConfig>): void {
        this.toolConfigs.set(toolName, config);
    }

    /**
     * 获取当前全局配置
     */
    getConfig(): TruncationConfig {
        return { ...this.config };
    }

    /**
     * 获取有效配置（全局 + 工具覆盖 + 单次选项）
     */
    private getEffectiveConfig(context: TruncationContext): TruncationConfig {
        const toolConfig = this.toolConfigs.get(context.toolName) || {};
        const options = context.options || {};

        // 计算最终的 enabled 值
        let enabled = this.config.enabled;
        if (toolConfig.enabled !== undefined) {
            enabled = toolConfig.enabled;
        }
        if (options.skip !== undefined) {
            enabled = !options.skip;
        }

        return {
            ...this.config,
            ...toolConfig,
            maxLines: options.maxLines ?? toolConfig.maxLines ?? this.config.maxLines,
            maxBytes: options.maxBytes ?? toolConfig.maxBytes ?? this.config.maxBytes,
            direction: options.direction ?? toolConfig.direction ?? this.config.direction,
            enabled,
        };
    }

    /**
     * 生成提示信息
     */
    private generateHint(outputPath: string, removedLines?: number, removedBytes?: number): string {
        const unit = removedBytes !== undefined ? 'bytes' : 'lines';
        const removed = removedBytes !== undefined ? removedBytes : removedLines || 0;

        // TODO: 后续可以根据权限系统判断是否有 Task 工具权限
        // 目前使用默认提示
        return (
            `The tool call succeeded but the output was truncated (${removed} ${unit} removed). ` +
            `Full output saved to: ${outputPath}\n` +
            `Use Grep to search the full content or Read with offset/limit to view specific sections.`
        );
    }

    /**
     * 格式化输出
     */
    private formatOutput(
        content: string,
        hint: string,
        direction: string,
        removedLines?: number,
        removedBytes?: number
    ): string {
        const unit = removedBytes !== undefined ? 'bytes' : 'lines';
        const removed = removedBytes !== undefined ? removedBytes : removedLines || 0;

        if (direction === 'tail') {
            return `...${removed} ${unit} truncated...\n\n${hint}\n\n${content}`;
        } else {
            return `${content}\n\n...${removed} ${unit} truncated...\n\n${hint}`;
        }
    }

    /**
     * 发送事件
     */
    private emitEvent(event: TruncationEvent): void {
        this.onEvent?.(event);
    }
}
