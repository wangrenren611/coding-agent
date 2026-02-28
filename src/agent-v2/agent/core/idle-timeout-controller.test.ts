/**
 * IdleTimeoutController 单元测试
 *
 * 测试目标：
 * 1. 空闲超时后正确触发中止
 * 2. reset() 正确重置计时器
 * 3. 持续 reset() 永远不会超时
 * 4. 手动 abort() 立即中止
 * 5. 状态查询方法正确
 */

import { describe, expect, it } from 'vitest';
import { IdleTimeoutController, createIdleTimeout } from './idle-timeout-controller';

describe('IdleTimeoutController', () => {
    describe('基本功能', () => {
        it('应该在空闲超时后触发中止', async () => {
            const controller = new IdleTimeoutController(50);

            // 初始状态
            expect(controller.aborted).toBe(false);
            expect(controller.signal.aborted).toBe(false);

            // 等待超时
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(controller.aborted).toBe(true);
            expect(controller.signal.aborted).toBe(true);
        });

        it('超时时应该提供正确的错误信息', async () => {
            const controller = new IdleTimeoutController(50);

            await new Promise((resolve) => setTimeout(resolve, 100));

            const reason = controller.signal.reason;
            expect(reason).toBeInstanceOf(Error);
            expect(reason.name).toBe('TimeoutError');
            expect(reason.message).toContain('Idle timeout');
        });

        it('支持自定义错误配置', async () => {
            const controller = new IdleTimeoutController({
                idleMs: 50,
                timeoutMessage: '连接空闲',
                timeoutCode: 'CONN_IDLE',
                errorName: 'IdleError',
            });

            await new Promise((resolve) => setTimeout(resolve, 100));

            const reason = controller.signal.reason;
            expect(reason.message).toBe('连接空闲');
            expect(reason.name).toBe('IdleError');
        });

        it('支持简化调用方式', () => {
            const controller = new IdleTimeoutController(1000);
            expect(controller).toBeInstanceOf(IdleTimeoutController);
        });
    });

    describe('reset() 功能', () => {
        it('reset() 应该重置计时器', async () => {
            const controller = new IdleTimeoutController(80);

            // 在 40ms 时重置
            await new Promise((resolve) => setTimeout(resolve, 40));
            controller.reset();

            // 此时（约 80ms 后）不应该超时（因为刚重置过）
            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(controller.aborted).toBe(false);

            // 再等 60ms（总共约 140ms，但重置后只过了 90ms）应该超时
            await new Promise((resolve) => setTimeout(resolve, 60));
            expect(controller.aborted).toBe(true);
        });

        it('持续调用 reset() 应该永远不会超时', async () => {
            const controller = new IdleTimeoutController(50);

            // 持续重置 10 次，每次间隔 30ms
            for (let i = 0; i < 10; i++) {
                await new Promise((resolve) => setTimeout(resolve, 30));
                controller.reset();
            }

            // 总共约 300ms，但因为持续重置，不应该超时
            expect(controller.aborted).toBe(false);

            // 清理
            controller.abort();
        });

        it('reset() 应该更新 lastActivityTime', async () => {
            const controller = new IdleTimeoutController(1000);

            const initialIdleTime = controller.getIdleTime();
            expect(initialIdleTime).toBeLessThan(10);

            await new Promise((resolve) => setTimeout(resolve, 50));

            const beforeResetIdleTime = controller.getIdleTime();
            // setTimeout 不能保证精确延迟，使用更宽松的阈值
            expect(beforeResetIdleTime).toBeGreaterThanOrEqual(40);

            controller.reset();

            const afterResetIdleTime = controller.getIdleTime();
            expect(afterResetIdleTime).toBeLessThan(10);
        });

        it('reset() 应该增加 resetCount', () => {
            const controller = new IdleTimeoutController(1000);

            expect(controller.getResetCount()).toBe(0);

            controller.reset();
            expect(controller.getResetCount()).toBe(1);

            controller.reset();
            expect(controller.getResetCount()).toBe(2);
        });

        it('超时后 reset() 无效', async () => {
            const controller = new IdleTimeoutController(30);

            await new Promise((resolve) => setTimeout(resolve, 60));
            expect(controller.aborted).toBe(true);

            // 重置无效
            controller.reset();
            expect(controller.getResetCount()).toBe(0);
        });
    });

    describe('abort() 功能', () => {
        it('abort() 应该立即中止', () => {
            const controller = new IdleTimeoutController(1000);

            controller.abort('手动中止');

            expect(controller.aborted).toBe(true);
            expect(controller.signal.reason).toBe('手动中止');
        });

        it('多次 abort() 应该是幂等的', () => {
            const controller = new IdleTimeoutController(1000);

            controller.abort('第一次');
            controller.abort('第二次');

            expect(controller.aborted).toBe(true);
            // 原因应该是第一次的值（AbortController 行为）
        });
    });

    describe('状态查询', () => {
        it('getElapsedTime() 应该返回正确的总时间', async () => {
            const controller = new IdleTimeoutController(1000);

            await new Promise((resolve) => setTimeout(resolve, 100));

            const elapsed = controller.getElapsedTime();
            expect(elapsed).toBeGreaterThanOrEqual(90);
            expect(elapsed).toBeLessThan(200);
        });

        it('getRemainingTime() 应该返回正确的剩余时间', async () => {
            const controller = new IdleTimeoutController(100);

            const initial = controller.getRemainingTime();
            expect(initial).toBeGreaterThan(90);
            expect(initial).toBeLessThanOrEqual(100);

            await new Promise((resolve) => setTimeout(resolve, 50));

            const after50ms = controller.getRemainingTime();
            expect(after50ms).toBeGreaterThan(40);
            expect(after50ms).toBeLessThan(55);
        });

        it('超时后 getRemainingTime() 应该返回 0', async () => {
            const controller = new IdleTimeoutController(30);

            await new Promise((resolve) => setTimeout(resolve, 60));

            expect(controller.getRemainingTime()).toBe(0);
        });

        it('isIdleTimeout() 应该正确识别空闲超时', async () => {
            const controller = new IdleTimeoutController(30);

            expect(controller.isIdleTimeout()).toBe(false);

            await new Promise((resolve) => setTimeout(resolve, 60));

            expect(controller.isIdleTimeout()).toBe(true);
        });

        it('isIdleTimeout() 对手动中止应该返回 false', () => {
            const controller = new IdleTimeoutController(1000);

            controller.abort('手动中止');

            expect(controller.isIdleTimeout()).toBe(false);
        });
    });

    describe('与其他信号合并', () => {
        it('应该能与 AbortSignal.timeout() 一起使用', async () => {
            // 空闲超时 50ms
            const idleController = new IdleTimeoutController(50);
            // 固定超时 200ms
            const fixedTimeout = AbortSignal.timeout(200);

            // 合并信号
            const merged = AbortSignal.any([idleController.signal, fixedTimeout]);

            // 初始状态
            expect(merged.aborted).toBe(false);

            // 持续重置空闲超时
            for (let i = 0; i < 5; i++) {
                await new Promise((resolve) => setTimeout(resolve, 30));
                idleController.reset();
            }

            // 约 150ms 后，因为持续重置，两个信号都不应该触发
            expect(merged.aborted).toBe(false);

            // 停止重置，等待空闲超时
            await new Promise((resolve) => setTimeout(resolve, 70));

            // 应该因为空闲超时而中止
            expect(merged.aborted).toBe(true);
            expect(idleController.aborted).toBe(true);
        });

        it('应该能与用户中止信号一起使用', async () => {
            const idleController = new IdleTimeoutController(1000);
            const userAbort = new AbortController();

            const merged = AbortSignal.any([idleController.signal, userAbort.signal]);

            expect(merged.aborted).toBe(false);

            // 用户主动中止
            userAbort.abort();

            expect(merged.aborted).toBe(true);
            expect(idleController.aborted).toBe(false); // 空闲超时未触发
        });
    });

    describe('便捷函数', () => {
        it('createIdleTimeout() 应该创建正确的控制器', () => {
            const controller = createIdleTimeout(1000);

            expect(controller).toBeInstanceOf(IdleTimeoutController);
            expect(controller.getRemainingTime()).toBeGreaterThan(900);
        });

        it('createIdleTimeout() 支持额外选项', () => {
            const controller = createIdleTimeout(1000, {
                timeoutMessage: '自定义消息',
            });

            expect(controller).toBeInstanceOf(IdleTimeoutController);
        });
    });

    describe('边界条件', () => {
        it('零延迟应该立即超时', async () => {
            const controller = new IdleTimeoutController(0);

            // 等待一个微任务周期
            await Promise.resolve();

            // 注意：setTimeout(0) 仍然有最小延迟
            // 所以可能需要稍等一下
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(controller.aborted).toBe(true);
        });

        it('非常短的延迟应该正确超时', async () => {
            const controller = new IdleTimeoutController(1);

            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(controller.aborted).toBe(true);
        });
    });
});
