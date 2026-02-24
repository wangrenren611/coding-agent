/**
 * Agent 状态管理器
 * 
 * 统一管理 Agent 执行过程中的所有状态，解决状态分散问题。
 * 
 * 职责：
 * 1. 状态存储和查询
 * 2. 完成条件检测
 * 3. 重试判断
 * 4. 状态重置
 */

import { AgentStatus, AgentFailure } from '../types';
import type { ITimeProvider } from '../core-types';
import { DefaultTimeProvider } from '../time-provider';

/**
 * 状态管理器配置
 */
export interface AgentStateConfig {
    /** 最大循环次数 */
    maxLoops: number;
    /** 最大重试次数 */
    maxRetries: number;
    /** 最大补偿重试次数 */
    maxCompensationRetries: number;
    /** 默认重试延迟（毫秒） */
    defaultRetryDelayMs: number;
    /** 时间提供者 */
    timeProvider?: ITimeProvider;
}

/**
 * 状态快照（用于调试和日志）
 */
export interface AgentStateSnapshot {
    status: AgentStatus;
    loopCount: number;
    retryCount: number;
    totalRetryCount: number;
    compensationRetryCount: number;
    taskStartTime: number;
    nextRetryDelayMs: number;
    lastFailure?: AgentFailure;
}

/**
 * Agent 状态管理器
 */
export class AgentState {
    // 配置
    private readonly config: AgentStateConfig;
    private readonly timeProvider: ITimeProvider;

    // 核心状态
    private _status: AgentStatus = AgentStatus.IDLE;
    private _loopCount: number = 0;
    private _retryCount: number = 0;
    private _totalRetryCount: number = 0;
    private _compensationRetryCount: number = 0;
    private _taskStartTime: number = 0;
    private _nextRetryDelayMs: number;
    private _lastFailure?: AgentFailure;

    // 循环控制
    private _abortController: AbortController | null = null;

    constructor(config: AgentStateConfig) {
        this.config = config;
        this.timeProvider = config.timeProvider ?? new DefaultTimeProvider();
        this._nextRetryDelayMs = config.defaultRetryDelayMs;
    }

    // ==================== 状态访问器 ====================

    get status(): AgentStatus {
        return this._status;
    }

    get loopCount(): number {
        return this._loopCount;
    }

    get retryCount(): number {
        return this._retryCount;
    }

    get totalRetryCount(): number {
        return this._totalRetryCount;
    }

    get compensationRetryCount(): number {
        return this._compensationRetryCount;
    }

    get taskStartTime(): number {
        return this._taskStartTime;
    }

    get nextRetryDelayMs(): number {
        return this._nextRetryDelayMs;
    }

    get lastFailure(): AgentFailure | undefined {
        return this._lastFailure;
    }

    get abortController(): AbortController | null {
        return this._abortController;
    }

    // ==================== 状态检查方法 ====================

    /**
     * 检查是否可以继续执行
     */
    canContinue(): boolean {
        return this._loopCount < this.config.maxLoops;
    }

    /**
     * 检查是否超过最大重试次数
     */
    isRetryExceeded(): boolean {
        return this._retryCount > this.config.maxRetries;
    }

    /**
     * 检查是否超过最大补偿重试次数
     */
    isCompensationRetryExceeded(): boolean {
        return this._compensationRetryCount >= this.config.maxCompensationRetries;
    }

    /**
     * 检查是否处于忙碌状态
     */
    isBusy(): boolean {
        return [AgentStatus.RUNNING, AgentStatus.THINKING, AgentStatus.RETRYING].includes(this._status);
    }

    /**
     * 检查是否已被中止
     */
    isAborted(): boolean {
        return this._status === AgentStatus.ABORTED;
    }

    /**
     * 检查是否需要重试
     */
    needsRetry(): boolean {
        return this._retryCount > 0;
    }

    // ==================== 状态变更方法 ====================

    /**
     * 开始新任务
     */
    startTask(): void {
        this._taskStartTime = this.timeProvider.getCurrentTime();
        this._loopCount = 0;
        this._retryCount = 0;
        this._totalRetryCount = 0;
        this._compensationRetryCount = 0;
        this._nextRetryDelayMs = this.config.defaultRetryDelayMs;
        this._lastFailure = undefined;
        this._abortController = new AbortController();
        this._status = AgentStatus.RUNNING;
    }

    /**
     * 进入下一次循环
     */
    incrementLoop(): void {
        this._loopCount++;
    }

    /**
     * 记录成功（重置重试计数）
     */
    recordSuccess(): void {
        this._retryCount = 0;
        // 注意：不重置 compensationRetryCount
        // 补偿重试次数在整个任务期间累计，防止 LLM 持续返回空响应
        this._nextRetryDelayMs = this.config.defaultRetryDelayMs;
    }

    /**
     * 记录可重试错误
     */
    recordRetryableError(retryDelayMs?: number): void {
        this._retryCount++;
        this._totalRetryCount++;
        this._nextRetryDelayMs = retryDelayMs ?? this.config.defaultRetryDelayMs;
    }

    /**
     * 记录补偿重试
     */
    recordCompensationRetry(): void {
        this._compensationRetryCount++;
    }

    /**
     * 设置状态
     */
    setStatus(status: AgentStatus): void {
        this._status = status;
    }

    /**
     * 准备新的 LLM 调用（创建新的 AbortController）
     */
    prepareLLMCall(): void {
        this._abortController = new AbortController();
    }

    /**
     * 标记任务完成
     */
    completeTask(): void {
        this._status = AgentStatus.COMPLETED;
        this._abortController = null;
    }

    /**
     * 标记任务失败
     */
    failTask(failure: AgentFailure): void {
        this._status = AgentStatus.FAILED;
        this._lastFailure = failure;
        this._abortController = null;
    }

    /**
     * 中止任务
     */
    abort(): void {
        this._abortController?.abort();
        this._status = AgentStatus.ABORTED;
        this._lastFailure = {
            code: 'AGENT_ABORTED',
            userMessage: 'Task was aborted.',
            internalMessage: 'Agent aborted by user.',
        };
    }

    // ==================== 工具方法 ====================

    /**
     * 获取状态快照
     */
    getSnapshot(): AgentStateSnapshot {
        return {
            status: this._status,
            loopCount: this._loopCount,
            retryCount: this._retryCount,
            totalRetryCount: this._totalRetryCount,
            compensationRetryCount: this._compensationRetryCount,
            taskStartTime: this._taskStartTime,
            nextRetryDelayMs: this._nextRetryDelayMs,
            lastFailure: this._lastFailure,
        };
    }

    /**
     * 获取执行统计
     */
    getStats(): { loops: number; retries: number; totalRetries: number; maxRetries: number; duration: number } {
        return {
            loops: this._loopCount,
            retries: this._retryCount,
            totalRetries: this._totalRetryCount,
            maxRetries: this.config.maxRetries,
            duration: this.timeProvider.getCurrentTime() - this._taskStartTime,
        };
    }
}
