/**
 * 空闲超时控制器
 *
 * 与 AbortSignal.timeout() 不同，这个控制器：
 * - 每次调用 reset() 都会重新开始计时
 * - 只有超过 idleMs 没有调用 reset() 才会触发超时
 * - 适用于流式请求场景，只要持续有数据就不会超时
 *
 * 使用场景：
 * - LLM 流式请求：每次收到 chunk 就调用 reset()
 * - 长连接心跳：每次收到心跳就调用 reset()
 *
 * @example
 * ```typescript
 * const controller = new IdleTimeoutController(30000); // 30秒空闲超时
 *
 * // 传递给 fetch
 * fetch(url, { signal: controller.signal });
 *
 * // 每次收到数据时重置
 * stream.on('data', () => controller.reset());
 *
 * // 检查是否超时
 * if (controller.signal.aborted) {
 *   console.log('空闲超时:', controller.signal.reason);
 * }
 * ```
 */

/**
 * 空闲超时控制器配置
 */
export interface IdleTimeoutControllerOptions {
    /** 空闲超时时间（毫秒） */
    idleMs: number;
    /** 超时时的错误消息（可选） */
    timeoutMessage?: string;
    /** 超时时的错误代码（可选） */
    timeoutCode?: string;
    /** 超时时的错误名称（可选，默认 'TimeoutError'） */
    errorName?: string;
}

/**
 * 空闲超时控制器
 *
 * 设计原则：
 * 1. 活动感知：只有长时间无活动才触发超时
 * 2. 可重置：每次 reset() 重新开始计时
 * 3. 可组合：提供 AbortSignal 可与其他信号合并
 * 4. 可查询：提供 elapsed time 等状态信息
 */
export class IdleTimeoutController {
    /** 内部定时器 */
    private timer: ReturnType<typeof setTimeout> | null = null;

    /** 中止控制器 */
    private readonly abortController: AbortController;

    /** 空闲超时时间（毫秒） */
    private readonly idleMs: number;

    /** 开始时间戳 */
    private readonly startTime: number;

    /** 最后一次活动时间戳 */
    private lastActivityTime: number;

    /** 重置次数 */
    private resetCount: number = 0;

    /** 错误消息 */
    private readonly timeoutMessage: string;

    /** 错误代码 */
    private readonly timeoutCode: string;

    /** 错误名称 */
    private readonly errorName: string;

    /** 是否已完成（超时或手动中止） */
    private finished: boolean = false;

    constructor(options: IdleTimeoutControllerOptions | number) {
        // 支持简化调用：new IdleTimeoutController(30000)
        const config: IdleTimeoutControllerOptions = typeof options === 'number' ? { idleMs: options } : options;

        this.idleMs = config.idleMs;
        this.timeoutMessage = config.timeoutMessage ?? `Idle timeout after ${this.idleMs}ms of inactivity`;
        this.timeoutCode = config.timeoutCode ?? 'IDLE_TIMEOUT';
        this.errorName = config.errorName ?? 'TimeoutError';

        this.abortController = new AbortController();
        this.startTime = Date.now();
        this.lastActivityTime = this.startTime;

        this.startTimer();
    }

    // ==================== 公共 API ====================

    /**
     * 重置空闲计时器
     *
     * 每次收到数据时调用，表示连接仍然活跃。
     * 如果已经超时或中止，调用此方法无效。
     */
    reset(): void {
        if (this.finished) {
            return;
        }

        this.clearTimer();
        this.lastActivityTime = Date.now();
        this.resetCount++;
        this.startTimer();
    }

    /**
     * 获取 AbortSignal
     *
     * 用于传递给 fetch、AbortSignal.any() 等。
     */
    get signal(): AbortSignal {
        return this.abortController.signal;
    }

    /**
     * 手动中止
     *
     * 立即中止，不等待超时。
     */
    abort(reason?: unknown): void {
        if (this.finished) {
            return;
        }

        this.finish();
        this.abortController.abort(reason);
    }

    /**
     * 检查是否已中止
     */
    get aborted(): boolean {
        return this.abortController.signal.aborted;
    }

    // ==================== 状态查询 ====================

    /**
     * 获取从创建到现在经过的总时间（毫秒）
     */
    getElapsedTime(): number {
        return Date.now() - this.startTime;
    }

    /**
     * 获取从最后一次活动到现在经过的时间（毫秒）
     */
    getIdleTime(): number {
        return Date.now() - this.lastActivityTime;
    }

    /**
     * 获取重置次数
     */
    getResetCount(): number {
        return this.resetCount;
    }

    /**
     * 获取剩余时间（毫秒）
     *
     * 返回直到超时还有多少时间。
     * 如果已超时或中止，返回 0。
     */
    getRemainingTime(): number {
        if (this.finished) {
            return 0;
        }

        const idleTime = this.getIdleTime();
        const remaining = this.idleMs - idleTime;
        return Math.max(0, remaining);
    }

    /**
     * 检查是否因为空闲超时而中止
     */
    isIdleTimeout(): boolean {
        if (!this.aborted) {
            return false;
        }

        const reason = this.abortController.signal.reason;
        if (reason instanceof Error) {
            return reason.name === this.errorName || reason.message.includes('Idle timeout');
        }
        return false;
    }

    // ==================== 私有方法 ====================

    /**
     * 启动计时器
     */
    private startTimer(): void {
        this.timer = setTimeout(() => {
            this.triggerTimeout();
        }, this.idleMs);
    }

    /**
     * 清除计时器
     */
    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * 触发超时
     */
    private triggerTimeout(): void {
        if (this.finished) {
            return;
        }

        this.finish();

        // 创建超时错误
        const error = this.createTimeoutError();
        this.abortController.abort(error);
    }

    /**
     * 完成处理（超时或手动中止）
     */
    private finish(): void {
        this.finished = true;
        this.clearTimer();
    }

    /**
     * 创建超时错误
     *
     * 尝试使用 DOMException（Node.js 17+ 支持），
     * 如果不支持则回退到普通 Error。
     */
    private createTimeoutError(): Error {
        // 尝试创建 DOMException（与 AbortSignal.timeout() 行为一致）
        try {
            const error = new DOMException(this.timeoutMessage, this.errorName);
            return error;
        } catch {
            // 回退到普通 Error
            const error = new Error(this.timeoutMessage);
            error.name = this.errorName;

            // 添加 code 属性以便识别
            (error as Error & { code?: string }).code = this.timeoutCode;

            return error;
        }
    }
}

/**
 * 创建空闲超时控制器的便捷函数
 */
export function createIdleTimeout(
    idleMs: number,
    options?: Omit<IdleTimeoutControllerOptions, 'idleMs'>
): IdleTimeoutController {
    return new IdleTimeoutController({ idleMs, ...options });
}
