/**
 * EventBus 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus, EventType, TaskStartData, ToolStartData } from '../index';

describe('EventBus', () => {
    let eventBus: EventBus;

    beforeEach(() => {
        eventBus = new EventBus();
    });

    afterEach(() => {
        eventBus.clear();
    });

    // ==================== 基础功能测试 ====================

    describe('基础功能', () => {
        it('应该正确创建 EventBus 实例', () => {
            expect(eventBus).toBeDefined();
            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(0);
        });

        it('应该正确注册事件监听器', () => {
            const listener = vi.fn();
            eventBus.on(EventType.TASK_START, listener);

            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(1);
        });

        it('应该正确注册多个监听器到同一事件', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();
            const listener3 = vi.fn();

            eventBus.on(EventType.TASK_START, listener1);
            eventBus.on(EventType.TASK_START, listener2);
            eventBus.on(EventType.TASK_START, listener3);

            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(3);
        });

        it('应该正确发送事件并触发监听器', () => {
            const listener = vi.fn();
            eventBus.on(EventType.TASK_START, listener);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(data);
        });

        it('发送事件时所有监听器都应被触发', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();
            const listener3 = vi.fn();

            eventBus.on(EventType.TASK_START, listener1);
            eventBus.on(EventType.TASK_START, listener2);
            eventBus.on(EventType.TASK_START, listener3);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            expect(listener1).toHaveBeenCalledWith(data);
            expect(listener2).toHaveBeenCalledWith(data);
            expect(listener3).toHaveBeenCalledWith(data);
        });

        it('发送无监听器的事件不应报错', () => {
            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            expect(() => {
                eventBus.emit(EventType.TASK_START, data);
            }).not.toThrow();
        });
    });

    // ==================== 取消订阅测试 ====================

    describe('取消订阅', () => {
        it('应该正确取消单个监听器', () => {
            const listener = vi.fn();
            eventBus.on(EventType.TASK_START, listener);

            eventBus.off(EventType.TASK_START, listener);

            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(0);
        });

        it('取消订阅后监听器不应被触发', () => {
            const listener = vi.fn();
            eventBus.on(EventType.TASK_START, listener);
            eventBus.off(EventType.TASK_START, listener);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            expect(listener).not.toHaveBeenCalled();
        });

        it('取消不存在的监听器不应报错', () => {
            const listener = vi.fn();

            expect(() => {
                eventBus.off(EventType.TASK_START, listener);
            }).not.toThrow();
        });

        it('取消其他监听器不应影响剩余监听器', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();
            const listener3 = vi.fn();

            eventBus.on(EventType.TASK_START, listener1);
            eventBus.on(EventType.TASK_START, listener2);
            eventBus.on(EventType.TASK_START, listener3);

            eventBus.off(EventType.TASK_START, listener2);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            expect(listener1).toHaveBeenCalled();
            expect(listener2).not.toHaveBeenCalled();
            expect(listener3).toHaveBeenCalled();
        });

        it('removeAllListeners 应该移除指定类型的所有监听器', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            eventBus.on(EventType.TASK_START, listener1);
            eventBus.on(EventType.TASK_START, listener2);
            eventBus.on(EventType.TASK_SUCCESS, vi.fn());

            eventBus.removeAllListeners(EventType.TASK_START);

            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(0);
            expect(eventBus.listenerCount(EventType.TASK_SUCCESS)).toBe(1);
        });

        it('removeAllListeners 无参数时应该移除所有监听器', () => {
            eventBus.on(EventType.TASK_START, vi.fn());
            eventBus.on(EventType.TASK_SUCCESS, vi.fn());
            eventBus.on(EventType.TOOL_START, vi.fn());

            eventBus.removeAllListeners();

            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(0);
            expect(eventBus.listenerCount(EventType.TASK_SUCCESS)).toBe(0);
            expect(eventBus.listenerCount(EventType.TOOL_START)).toBe(0);
        });

        it('clear 应该清空所有监听器', () => {
            eventBus.on(EventType.TASK_START, vi.fn());
            eventBus.on(EventType.TASK_SUCCESS, vi.fn());

            eventBus.clear();

            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(0);
            expect(eventBus.listenerCount(EventType.TASK_SUCCESS)).toBe(0);
        });
    });

    // ==================== 事件顺序测试 ====================

    describe('事件顺序', () => {
        it('监听器应该按注册顺序执行', () => {
            const order: number[] = [];

            eventBus.on(EventType.TASK_START, () => {
                order.push(1);
            });
            eventBus.on(EventType.TASK_START, () => {
                order.push(2);
            });
            eventBus.on(EventType.TASK_START, () => {
                order.push(3);
            });

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            expect(order).toEqual([1, 2, 3]);
        });

        it('不同类型事件应该独立触发', () => {
            const taskListener = vi.fn();
            const toolListener = vi.fn();

            eventBus.on(EventType.TASK_START, taskListener);
            eventBus.on(EventType.TOOL_START, toolListener);

            const taskData: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            const toolData: ToolStartData = {
                toolName: 'test-tool',
                arguments: '{}',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, taskData);

            expect(taskListener).toHaveBeenCalledWith(taskData);
            expect(toolListener).not.toHaveBeenCalled();

            eventBus.emit(EventType.TOOL_START, toolData);

            expect(toolListener).toHaveBeenCalledWith(toolData);
            expect(taskListener).toHaveBeenCalledTimes(1);
        });
    });

    // ==================== 错误处理测试 ====================

    describe('错误处理', () => {
        it('单个监听器错误不应影响其他监听器', () => {
            const errorListener = vi.fn(() => {
                throw new Error('Listener error');
            });
            const normalListener = vi.fn();

            eventBus.on(EventType.TASK_START, errorListener);
            eventBus.on(EventType.TASK_START, normalListener);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            // 不应该抛出错误
            expect(() => {
                eventBus.emit(EventType.TASK_START, data);
            }).not.toThrow();

            // 两个监听器都应该被调用
            expect(errorListener).toHaveBeenCalled();
            expect(normalListener).toHaveBeenCalled();
        });

        it('监听器错误应该被记录到控制台', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const errorListener = vi.fn(() => {
                throw new Error('Listener error');
            });

            eventBus.on(EventType.TASK_START, errorListener);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(consoleErrorSpy.mock.calls[0][0]).toContain('Event listener error');

            consoleErrorSpy.mockRestore();
        });

        it('多个监听器都有错误时应该都记录', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            eventBus.on(EventType.TASK_START, () => {
                throw new Error('Error 1');
            });
            eventBus.on(EventType.TASK_START, () => {
                throw new Error('Error 2');
            });

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

            consoleErrorSpy.mockRestore();
        });
    });

    // ==================== 异步监听器测试 ====================

    describe('异步监听器', () => {
        it('异步监听器应该被正确调用', async () => {
            const asyncListener = vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
            });

            eventBus.on(EventType.TASK_START, asyncListener);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            // emit 是异步执行，需要等待一下
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(asyncListener).toHaveBeenCalled();
        });

        it('异步监听器错误不应影响其他监听器', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const asyncErrorListener = vi.fn(async () => {
                throw new Error('Async error');
            });
            const normalListener = vi.fn();

            eventBus.on(EventType.TASK_START, asyncErrorListener);
            eventBus.on(EventType.TASK_START, normalListener);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(asyncErrorListener).toHaveBeenCalled();
            expect(normalListener).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });
    });

    // ==================== 边界条件测试 ====================

    describe('边界条件', () => {
        it('同一监听器多次注册应该去重', () => {
            const listener = vi.fn();

            eventBus.on(EventType.TASK_START, listener);
            eventBus.on(EventType.TASK_START, listener);
            eventBus.on(EventType.TASK_START, listener);

            // Set 会自动去重
            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(1);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('取消最后一个监听器应该清理事件类型', () => {
            const listener = vi.fn();

            eventBus.on(EventType.TASK_START, listener);
            eventBus.off(EventType.TASK_START, listener);

            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(0);
        });

        it('listenerCount 对于不存在的事件类型应该返回 0', () => {
            expect(eventBus.listenerCount(EventType.TASK_START)).toBe(0);
            expect(eventBus.listenerCount(EventType.TASK_SUCCESS)).toBe(0);
        });

        it('应该支持所有事件类型', () => {
            const allTypes = [
                EventType.TASK_START,
                EventType.TASK_PROGRESS,
                EventType.TASK_SUCCESS,
                EventType.TASK_FAILED,
                EventType.TASK_RETRY,
                EventType.TOOL_START,
                EventType.TOOL_SUCCESS,
                EventType.TOOL_FAILED,
                EventType.STREAM_CHUNK,
            ];

            allTypes.forEach((type) => {
                const listener = vi.fn();
                eventBus.on(type, listener);
                expect(eventBus.listenerCount(type)).toBe(1);
            });
        });
    });

    // ==================== 事件类型和数据完整性测试 ====================

    describe('事件数据完整性', () => {
        it('TaskStart 事件数据应该包含必要字段', () => {
            const listener = vi.fn();
            eventBus.on(EventType.TASK_START, listener);

            const data: TaskStartData = {
                query: 'test query',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_START, data);

            const callData = listener.mock.calls[0][0] as TaskStartData;
            expect(callData.query).toBe('test query');
            expect(callData.timestamp).toBeDefined();
        });

        it('TaskSuccess 事件数据应该包含必要字段', () => {
            const listener = vi.fn();
            eventBus.on(EventType.TASK_SUCCESS, listener);

            const data = {
                totalLoops: 5,
                totalRetries: 2,
                duration: 1000,
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_SUCCESS, data);

            const callData = listener.mock.calls[0][0];
            expect(callData.totalLoops).toBe(5);
            expect(callData.totalRetries).toBe(2);
            expect(callData.duration).toBe(1000);
        });

        it('ToolStart 事件数据应该包含必要字段', () => {
            const listener = vi.fn();
            eventBus.on(EventType.TOOL_START, listener);

            const data: ToolStartData = {
                toolName: 'bash',
                arguments: '{"command": "ls"}',
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TOOL_START, data);

            const callData = listener.mock.calls[0][0] as ToolStartData;
            expect(callData.toolName).toBe('bash');
            expect(callData.arguments).toBe('{"command": "ls"}');
        });

        it('TaskFailed 事件数据应该包含错误信息', () => {
            const listener = vi.fn();
            eventBus.on(EventType.TASK_FAILED, listener);

            const data = {
                error: 'Something went wrong',
                totalLoops: 3,
                totalRetries: 1,
                timestamp: Date.now(),
            };

            eventBus.emit(EventType.TASK_FAILED, data);

            const callData = listener.mock.calls[0][0];
            expect(callData.error).toBe('Something went wrong');
        });
    });

    // ==================== 集成场景测试 ====================

    describe('集成场景', () => {
        it('模拟完整的任务生命周期事件流', () => {
            const events: string[] = [];

            eventBus.on(EventType.TASK_START, () => {
                events.push('start');
            });
            eventBus.on(EventType.TASK_PROGRESS, () => {
                events.push('progress');
            });
            eventBus.on(EventType.TOOL_START, () => {
                events.push('tool-start');
            });
            eventBus.on(EventType.TOOL_SUCCESS, () => {
                events.push('tool-success');
            });
            eventBus.on(EventType.TASK_SUCCESS, () => {
                events.push('success');
            });

            // 模拟任务流程
            eventBus.emit(EventType.TASK_START, { query: 'test', timestamp: Date.now() });
            eventBus.emit(EventType.TASK_PROGRESS, { loopCount: 1, retryCount: 0, timestamp: Date.now() });
            eventBus.emit(EventType.TOOL_START, { toolName: 'bash', arguments: '{}', timestamp: Date.now() });
            eventBus.emit(EventType.TOOL_SUCCESS, {
                toolName: 'bash',
                duration: 100,
                resultLength: 50,
                timestamp: Date.now(),
            });
            eventBus.emit(EventType.TASK_SUCCESS, {
                totalLoops: 1,
                totalRetries: 0,
                duration: 500,
                timestamp: Date.now(),
            });

            expect(events).toEqual(['start', 'progress', 'tool-start', 'tool-success', 'success']);
        });

        it('模拟任务重试场景', () => {
            const retryCounts: number[] = [];

            eventBus.on(EventType.TASK_RETRY, (data) => {
                retryCounts.push(data.retryCount);
            });

            // 模拟多次重试
            eventBus.emit(EventType.TASK_RETRY, {
                retryCount: 1,
                maxRetries: 3,
                reason: 'timeout',
                timestamp: Date.now(),
            });
            eventBus.emit(EventType.TASK_RETRY, {
                retryCount: 2,
                maxRetries: 3,
                reason: 'timeout',
                timestamp: Date.now(),
            });
            eventBus.emit(EventType.TASK_RETRY, {
                retryCount: 3,
                maxRetries: 3,
                reason: 'timeout',
                timestamp: Date.now(),
            });

            expect(retryCounts).toEqual([1, 2, 3]);
        });

        it('模拟流式输出场景', () => {
            const chunks: string[] = [];

            eventBus.on(EventType.STREAM_CHUNK, (data) => {
                chunks.push(data.content);
            });

            // 模拟流式输出
            eventBus.emit(EventType.STREAM_CHUNK, { content: 'Hello', timestamp: Date.now() });
            eventBus.emit(EventType.STREAM_CHUNK, { content: ' ', timestamp: Date.now() });
            eventBus.emit(EventType.STREAM_CHUNK, { content: 'World', timestamp: Date.now() });

            expect(chunks).toEqual(['Hello', ' ', 'World']);
        });
    });
});
