/**
 * AgentEmitter 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentEmitter } from './agent-emitter';
import { AgentMessageType } from './stream-types';
import { AgentStatus } from './types';
import type { Usage } from '../../providers';

describe('AgentEmitter', () => {
    let emitter: AgentEmitter;
    let mockCallback: ReturnType<typeof vi.fn>;
    const sessionId = 'test-session-id';
    const timestamp = 1234567890;

    beforeEach(() => {
        mockCallback = vi.fn();
        emitter = new AgentEmitter({
            streamCallback: mockCallback,
            sessionId,
            getTimestamp: () => timestamp,
        });
    });

    describe('构造函数', () => {
        it('应该使用提供的配置初始化', () => {
            expect(() => new AgentEmitter({
                streamCallback: mockCallback,
                sessionId: 'test',
                getTimestamp: () => Date.now(),
            })).not.toThrow();
        });

        it('应该允许无 streamCallback', () => {
            const emitterNoCallback = new AgentEmitter({
                sessionId: 'test',
                getTimestamp: () => Date.now(),
            });
            // 不应该抛出错误
            expect(() => emitterNoCallback.emitStatus(AgentStatus.IDLE, 'test')).not.toThrow();
        });
    });

    describe('updateConfig', () => {
        it('应该更新配置', () => {
            const newCallback = vi.fn();
            emitter.updateConfig({ streamCallback: newCallback });
            
            emitter.emitStatus(AgentStatus.RUNNING, 'running');
            
            expect(newCallback).toHaveBeenCalled();
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it('应该更新 sessionId', () => {
            emitter.updateConfig({ sessionId: 'new-session-id' });
            
            emitter.emitStatus(AgentStatus.IDLE, 'test');
            
            expect(mockCallback).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'new-session-id' })
            );
        });
    });

    describe('状态事件', () => {
        it('emitStatus 应该发送正确的消息', () => {
            emitter.emitStatus(AgentStatus.RUNNING, 'Agent is running', 'msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.STATUS,
                payload: { state: AgentStatus.RUNNING, message: 'Agent is running' },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });

        it('emitStatus 应该支持无 msgId', () => {
            emitter.emitStatus(AgentStatus.IDLE, 'Agent is idle');
            
            expect(mockCallback).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: AgentMessageType.STATUS,
                    payload: { state: AgentStatus.IDLE, message: 'Agent is idle' },
                })
            );
            // 确保没有 msgId 字段
            expect(mockCallback).toHaveBeenCalledWith(
                expect.not.objectContaining({ msgId: expect.anything() })
            );
        });
    });

    describe('文本事件', () => {
        it('emitTextStart 应该发送正确的消息', () => {
            emitter.emitTextStart('msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.TEXT_START,
                payload: { content: '' },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });

        it('emitTextDelta 应该发送正确的消息', () => {
            emitter.emitTextDelta('Hello', 'msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.TEXT_DELTA,
                payload: { content: 'Hello' },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });

        it('emitTextComplete 应该发送正确的消息', () => {
            emitter.emitTextComplete('msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.TEXT_COMPLETE,
                payload: { content: '' },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });
    });

    describe('推理事件', () => {
        it('emitReasoningStart 应该发送正确的消息', () => {
            emitter.emitReasoningStart('msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.REASONING_START,
                payload: { content: '' },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });

        it('emitReasoningDelta 应该发送正确的消息', () => {
            emitter.emitReasoningDelta('Thinking...', 'msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.REASONING_DELTA,
                payload: { content: 'Thinking...' },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });

        it('emitReasoningComplete 应该发送正确的消息', () => {
            emitter.emitReasoningComplete('msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.REASONING_COMPLETE,
                payload: { content: '' },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });
    });

    describe('工具调用事件', () => {
        const mockToolCalls = [
            {
                id: 'call-1',
                function: { name: 'read_file', arguments: '{"path": "/test"}' },
            },
            {
                id: 'call-2',
                function: { name: 'write_file', arguments: '{"path": "/test2"}' },
            },
        ];

        it('emitToolCallCreated 应该发送正确的消息', () => {
            emitter.emitToolCallCreated(mockToolCalls as any, 'msg-1', '思考中...');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.TOOL_CALL_CREATED,
                payload: {
                    tool_calls: [
                        { callId: 'call-1', toolName: 'read_file', args: '{"path": "/test"}' },
                        { callId: 'call-2', toolName: 'write_file', args: '{"path": "/test2"}' },
                    ],
                    content: '思考中...',
                },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });

        it('emitToolCallResult 应该发送正确的消息', () => {
            emitter.emitToolCallResult('call-1', { success: true, data: 'test' }, 'success', 'msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.TOOL_CALL_RESULT,
                payload: {
                    callId: 'call-1',
                    result: '{"success":true,"data":"test"}',
                    status: 'success',
                },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });

        it('emitToolCallResult 应该处理字符串结果', () => {
            emitter.emitToolCallResult('call-1', 'error message', 'error', 'msg-1');
            
            expect(mockCallback).toHaveBeenCalledWith({
                type: AgentMessageType.TOOL_CALL_RESULT,
                payload: {
                    callId: 'call-1',
                    result: 'error message',
                    status: 'error',
                },
                msgId: 'msg-1',
                sessionId,
                timestamp,
            });
        });
    });

    describe('Usage 事件', () => {
        it('emitUsageUpdate 应该累加使用量', () => {
            const usage1: Usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
            const usage2: Usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 };
            
            emitter.emitUsageUpdate(usage1);
            emitter.emitUsageUpdate(usage2);
            
            expect(mockCallback).toHaveBeenCalledTimes(2);
            
            // 第二次调用应该有累积值
            expect(mockCallback).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    type: AgentMessageType.USAGE_UPDATE,
                    payload: {
                        usage: usage2,
                        cumulative: {
                            prompt_tokens: 30,
                            completion_tokens: 15,
                            total_tokens: 45,
                        },
                    },
                })
            );
        });

        it('getCumulativeUsage 应该返回当前累积值', () => {
            const usage: Usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
            emitter.emitUsageUpdate(usage);
            
            const cumulative = emitter.getCumulativeUsage();
            
            expect(cumulative).toEqual({
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
            });
        });

        it('resetCumulativeUsage 应该重置累积值', () => {
            const usage: Usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
            emitter.emitUsageUpdate(usage);
            emitter.resetCumulativeUsage();
            
            const cumulative = emitter.getCumulativeUsage();
            
            expect(cumulative).toEqual({
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
            });
        });
    });
});
