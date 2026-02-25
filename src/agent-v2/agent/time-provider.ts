/**
 * 时间提供者实现
 */

import type { ITimeProvider } from './core-types';

/**
 * 默认时间提供者
 * 使用系统时间和 setTimeout
 */
export class DefaultTimeProvider implements ITimeProvider {
    /**
     * 获取当前时间戳（毫秒）
     */
    getCurrentTime(): number {
        return Date.now();
    }

    /**
     * 异步睡眠
     * @param ms 睡眠时间（毫秒）
     */
    async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * 模拟时间提供者
 * 用于测试，允许控制时间流逝
 */
export class MockTimeProvider implements ITimeProvider {
    private currentTime: number;
    private sleepCallbacks: Array<{ wakeTime: number; resolve: () => void }> = [];

    constructor(initialTime: number = Date.now()) {
        this.currentTime = initialTime;
    }

    /**
     * 获取当前模拟时间
     */
    getCurrentTime(): number {
        return this.currentTime;
    }

    /**
     * 设置当前模拟时间
     */
    setCurrentTime(time: number): void {
        this.currentTime = time;
        this.checkSleepCallbacks();
    }

    /**
     * 推进时间
     * @param ms 推进的毫秒数
     */
    advanceTime(ms: number): void {
        this.currentTime += ms;
        this.checkSleepCallbacks();
    }

    /**
     * 异步睡眠（模拟）
     */
    async sleep(ms: number): Promise<void> {
        const wakeTime = this.currentTime + ms;

        // 如果唤醒时间已过，立即返回
        if (wakeTime <= this.currentTime) {
            return;
        }

        return new Promise((resolve) => {
            this.sleepCallbacks.push({ wakeTime, resolve });
            this.checkSleepCallbacks();
        });
    }

    /**
     * 检查并触发已到期的睡眠回调
     */
    private checkSleepCallbacks(): void {
        const readyCallbacks = this.sleepCallbacks.filter((cb) => cb.wakeTime <= this.currentTime);
        this.sleepCallbacks = this.sleepCallbacks.filter((cb) => cb.wakeTime > this.currentTime);

        for (const cb of readyCallbacks) {
            cb.resolve();
        }
    }

    /**
     * 重置模拟时间提供者
     */
    reset(initialTime: number = Date.now()): void {
        this.currentTime = initialTime;
        this.sleepCallbacks = [];
    }
}
