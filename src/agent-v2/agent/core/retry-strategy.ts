/**
 * 重试策略
 * 
 * 封装重试逻辑，提供灵活的重试策略配置。
 * 
 * 职责：
 * 1. 判断错误是否可重试
 * 2. 计算重试延迟
 * 3. 管理重试状态
 */

import { LLMRetryableError, isRetryableError } from '../../../providers';
import { CompensationRetryError } from '../errors';
import type { ITimeProvider } from '../core-types';
import { DefaultTimeProvider } from '../time-provider';

/**
 * 重试策略配置
 */
export interface RetryStrategyConfig {
    /** 最大重试次数 */
    maxRetries: number;
    /** 最大补偿重试次数 */
    maxCompensationRetries: number;
    /** 默认重试延迟（毫秒） */
    defaultRetryDelayMs: number;
    /** 是否使用指数退避 */
    useExponentialBackoff?: boolean;
    /** 指数退避基数 */
    backoffBase?: number;
    /** 最大退避延迟 */
    maxBackoffDelayMs?: number;
    /** 时间提供者 */
    timeProvider?: ITimeProvider;
}

/**
 * 重试决策结果
 */
export interface RetryDecision {
    /** 是否应该重试 */
    shouldRetry: boolean;
    /** 重试类型 */
    retryType: 'normal' | 'compensation' | 'none';
    /** 重试延迟（毫秒） */
    delayMs: number;
    /** 是否超过最大重试次数 */
    exceeded: boolean;
    /** 原因说明 */
    reason: string;
}

/**
 * 重试策略
 */
export class RetryStrategy {
    private readonly config: RetryStrategyConfig;
    private readonly timeProvider: ITimeProvider;

    constructor(config: RetryStrategyConfig) {
        this.config = config;
        this.timeProvider = config.timeProvider ?? new DefaultTimeProvider();
    }

    /**
     * 分析错误并决定重试策略
     */
    analyze(error: unknown, currentRetryCount: number, currentCompensationCount: number): RetryDecision {
        // 补偿重试（空响应）
        if (error instanceof CompensationRetryError) {
            if (currentCompensationCount >= this.config.maxCompensationRetries) {
                return {
                    shouldRetry: false,
                    retryType: 'compensation',
                    delayMs: 0,
                    exceeded: true,
                    reason: `Exceeded maximum compensation retries (${this.config.maxCompensationRetries})`,
                };
            }
            return {
                shouldRetry: true,
                retryType: 'compensation',
                delayMs: 0, // 补偿重试立即执行
                exceeded: false,
                reason: 'Empty response, retrying immediately',
            };
        }

        // 可重试错误
        if (isRetryableError(error)) {
            if (currentRetryCount >= this.config.maxRetries) {
                return {
                    shouldRetry: false,
                    retryType: 'normal',
                    delayMs: 0,
                    exceeded: true,
                    reason: `Exceeded maximum retries (${this.config.maxRetries})`,
                };
            }

            const delayMs = this.calculateDelay(error, currentRetryCount);
            return {
                shouldRetry: true,
                retryType: 'normal',
                delayMs,
                exceeded: false,
                reason: 'Retryable error detected',
            };
        }

        // 不可重试错误
        return {
            shouldRetry: false,
            retryType: 'none',
            delayMs: 0,
            exceeded: false,
            reason: 'Non-retryable error',
        };
    }

    /**
     * 计算重试延迟
     */
    private calculateDelay(error: unknown, retryCount: number): number {
        // 如果错误指定了重试延迟，优先使用
        if (error instanceof LLMRetryableError && typeof error.retryAfter === 'number' && error.retryAfter > 0) {
            return error.retryAfter;
        }

        // 指数退避
        if (this.config.useExponentialBackoff) {
            const base = this.config.backoffBase ?? 1000;
            const maxDelay = this.config.maxBackoffDelayMs ?? this.config.defaultRetryDelayMs;
            const exponentialDelay = base * Math.pow(2, retryCount);
            return Math.min(exponentialDelay, maxDelay);
        }

        // 固定延迟
        return this.config.defaultRetryDelayMs;
    }

    /**
     * 执行重试等待
     */
    async wait(delayMs: number): Promise<void> {
        if (delayMs <= 0) return;
        await this.timeProvider.sleep(delayMs);
    }

    /**
     * 检查错误是否可重试
     */
    static isRetryable(error: unknown): boolean {
        return isRetryableError(error) || error instanceof CompensationRetryError;
    }

    /**
     * 检查是否为补偿重试错误
     */
    static isCompensationRetry(error: unknown): boolean {
        return error instanceof CompensationRetryError;
    }
}

/**
 * 创建默认重试策略
 */
export function createDefaultRetryStrategy(overrides?: Partial<RetryStrategyConfig>): RetryStrategy {
    return new RetryStrategy({
        maxRetries: 10,
        maxCompensationRetries: 1,
        defaultRetryDelayMs: 1000 * 60 * 10, // 10 分钟
        useExponentialBackoff: false,
        ...overrides,
    });
}
