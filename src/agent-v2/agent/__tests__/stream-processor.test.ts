import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamProcessor } from '../stream-processor';
import { Chunk, Usage } from '../../../providers';

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('StreamProcessor', () => {
    let processor: StreamProcessor;
    let onMessageUpdate: MockFn;
    let onReasoningDelta: MockFn;
    let onReasoningStart: MockFn;
    let onReasoningComplete: MockFn;
    let onTextDelta: MockFn;
    let onTextStart: MockFn;
    let onTextComplete: MockFn;
    let onMessageCreate: MockFn;
    let onUsageUpdate: MockFn;
    let onValidationViolation: MockFn;

    beforeEach(() => {
        onMessageUpdate = vi.fn();
        onReasoningDelta = vi.fn();
        onReasoningStart = vi.fn();
        onReasoningComplete = vi.fn();
        onTextDelta = vi.fn();
        onTextStart = vi.fn();
        onTextComplete = vi.fn();
        onMessageCreate = vi.fn();
        onUsageUpdate = vi.fn();
        onValidationViolation = vi.fn();

        processor = new StreamProcessor({
            maxBufferSize: 100000,
            onMessageUpdate,
            onReasoningDelta,
            onReasoningStart,
            onReasoningComplete,
            onTextDelta,
            onTextStart,
            onTextComplete,
            onMessageCreate,
            onUsageUpdate,
            onValidationViolation,
        });

        processor.setMessageId('test-msg-id');
    });

    // ==================== 推理内容测试 ====================

    describe('handleReasoningContent', () => {
        it('should store reasoning_content via onMessageUpdate', () => {
            const chunk: Chunk = {
                id: 'chunk-1',
                index: 0,
                choices: [
                    {
                        index: 0,
                        delta: {
                            role: 'assistant',
                            content: '',
                            reasoning_content: '思考中...',
                        },
                    },
                ],
            };

            processor.processChunk(chunk);

            expect(onMessageUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    messageId: 'test-msg-id',
                    reasoning_content: '思考中...',
                    type: 'text',
                })
            );
        });

        it('should accumulate reasoning content across multiple chunks', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: '第一步...' } }],
                },
                {
                    index: 0,
                    id: 'c2',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: '第二步...' } }],
                },
                {
                    index: 0,
                    id: 'c3',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: '第三步。' } }],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onMessageUpdate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    reasoning_content: '第一步...第二步...第三步。',
                })
            );
        });

        it('should trigger onReasoningStart only on first chunk', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'a' } }],
                },
                {
                    index: 0,
                    id: 'c2',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'b' } }],
                },
                {
                    index: 0,
                    id: 'c3',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'c' } }],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onReasoningStart).toHaveBeenCalledTimes(1);
            expect(onReasoningStart).toHaveBeenCalledWith('test-msg-id');
        });

        it('should trigger onReasoningDelta for each chunk', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'a' } }],
                },
                {
                    index: 0,
                    id: 'c2',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'b' } }],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onReasoningDelta).toHaveBeenCalledTimes(2);
        });

        it('should trigger onReasoningComplete when finish_reason present', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [
                    {
                        index: 0,
                        delta: { role: 'assistant', content: '', reasoning_content: 'done' },
                        finish_reason: 'stop',
                    },
                ],
            };

            processor.processChunk(chunk);

            expect(onReasoningComplete).toHaveBeenCalledWith('test-msg-id');
        });

        it('should only trigger onReasoningComplete once', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [
                        {
                            index: 0,
                            delta: { role: 'assistant', content: '', reasoning_content: 'a' },
                            finish_reason: 'stop',
                        },
                    ],
                },
                {
                    index: 0,
                    id: 'c2',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onReasoningComplete).toHaveBeenCalledTimes(1);
        });
    });

    // ==================== 文本内容测试 ====================

    describe('handleTextContent', () => {
        it('should store content via onMessageUpdate', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' } }],
            };

            processor.processChunk(chunk);

            expect(onMessageUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    messageId: 'test-msg-id',
                    content: 'Hello',
                    role: 'assistant',
                })
            );
        });

        it('should accumulate content across chunks', () => {
            const chunks: Chunk[] = [
                { index: 0, id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello ' } }] },
                { index: 0, id: 'c2', choices: [{ index: 0, delta: { role: 'assistant', content: 'World' } }] },
                { index: 0, id: 'c3', choices: [{ index: 0, delta: { role: 'assistant', content: '!' } }] },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onMessageUpdate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    content: 'Hello World!',
                })
            );
        });

        it('should trigger onTextStart only once', () => {
            const chunks: Chunk[] = [
                { index: 0, id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'a' } }] },
                { index: 0, id: 'c2', choices: [{ index: 0, delta: { role: 'assistant', content: 'b' } }] },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onTextStart).toHaveBeenCalledTimes(1);
        });

        it('should trigger onTextComplete when finish_reason present', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
            };

            processor.processChunk(chunk);

            expect(onTextComplete).toHaveBeenCalledWith('test-msg-id');
        });
    });

    // ==================== 工具调用测试 ====================

    describe('handleToolCalls', () => {
        it('should accumulate tool_calls', () => {
            const chunks: Chunk[] = [
                {
                    id: 'c1',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_1',
                                        type: 'function',
                                        function: { name: 'read_file', arguments: '' },
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    id: 'c2',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: '',
                                        type: 'function',
                                        function: { name: '', arguments: '{"path"' },
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    id: 'c3',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: '',
                                        type: 'function',
                                        function: { name: '', arguments: ': "test.txt"}' },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            const toolCalls = processor.getToolCalls();
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].function.name).toBe('read_file');
            expect(toolCalls[0].function.arguments).toBe('{"path": "test.txt"}');
        });

        it('should handle multiple tool calls', () => {
            const chunks: Chunk[] = [
                {
                    id: 'c1',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_1',
                                        type: 'function',
                                        function: { name: 'read', arguments: '' },
                                    },
                                    {
                                        index: 1,
                                        id: 'call_2',
                                        type: 'function',
                                        function: { name: 'write', arguments: '' },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(processor.hasToolCalls()).toBe(true);
            expect(processor.getToolCalls()).toHaveLength(2);
        });

        it('should trigger onTextComplete before tool_calls if text started', () => {
            const chunks: Chunk[] = [
                { index: 0, id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'Let me help' } }] },
                {
                    id: 'c2',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_1',
                                        type: 'function',
                                        function: { name: 'test', arguments: '' },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onTextComplete).toHaveBeenCalled();
        });

        it('should call onMessageCreate for tool calls', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [
                    {
                        index: 0,
                        delta: {
                            role: 'assistant',
                            content: '',
                            tool_calls: [
                                {
                                    index: 0,
                                    id: 'call_1',
                                    type: 'function',
                                    function: { name: 'test', arguments: '{}' },
                                },
                            ],
                        },
                    },
                ],
            };

            processor.processChunk(chunk);

            expect(onMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'tool-call',
                    tool_calls: expect.any(Array),
                })
            );
        });
    });

    // ==================== 混合内容测试 ====================

    describe('mixed content scenarios', () => {
        it('should handle reasoning -> content -> finish', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [
                        { index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'Thinking...' } },
                    ],
                },
                { index: 0, id: 'c2', choices: [{ index: 0, delta: { role: 'assistant', content: 'Answer' } }] },
                {
                    index: 0,
                    id: 'c3',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            // 验证最终消息包含两种内容
            expect(onMessageUpdate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    reasoning_content: 'Thinking...',
                    content: 'Answer',
                })
            );
        });

        it('should handle reasoning -> content -> tool_calls', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [
                        { index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'Need to read file' } },
                    ],
                },
                {
                    index: 0,
                    id: 'c2',
                    choices: [{ index: 0, delta: { role: 'assistant', content: 'I will read it' } }],
                },
                {
                    id: 'c3',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_1',
                                        type: 'function',
                                        function: { name: 'read', arguments: '' },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    reasoning_content: 'Need to read file',
                    content: 'I will read it',
                    tool_calls: expect.any(Array),
                })
            );
        });

        it('should handle content -> tool_calls (no reasoning)', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [{ index: 0, delta: { role: 'assistant', content: 'Here is the result' } }],
                },
                {
                    id: 'c2',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_1',
                                        type: 'function',
                                        function: { name: 'write', arguments: '' },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(onMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: 'Here is the result',
                    tool_calls: expect.any(Array),
                })
            );
        });

        it('should handle only reasoning (no content, no tools)', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [
                        { index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'Just thinking' } },
                    ],
                },
                {
                    index: 0,
                    id: 'c2',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: ' deeply' } }],
                },
                {
                    index: 0,
                    id: 'c3',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            // 只有 reasoning 也应该被持久化
            expect(onMessageUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    reasoning_content: 'Just thinking deeply',
                })
            );
        });
    });

    // ==================== 元数据测试 ====================

    describe('metadata handling', () => {
        it('should capture chunk id', () => {
            const chunk: Chunk = {
                id: 'chatcmpl-123',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'test' } }],
            };

            processor.processChunk(chunk);
            const metadata = processor.getMetadata();

            expect(metadata.id).toBe('chatcmpl-123');
        });

        it('should capture model name', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                model: 'glm-4',
                choices: [{ index: 0, delta: { role: 'assistant', content: 'test' } }],
            };

            processor.processChunk(chunk);
            const metadata = processor.getMetadata();

            expect(metadata.model).toBe('glm-4');
        });

        it('should capture finish_reason', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
            };

            processor.processChunk(chunk);
            const metadata = processor.getMetadata();

            expect(metadata.finish_reason).toBe('stop');
        });

        it('should capture usage and trigger callback', () => {
            const usage: Usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                usage,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'test' } }],
            };

            processor.setMessageId('test-msg-id');
            processor.processChunk(chunk);

            expect(onUsageUpdate).toHaveBeenCalledWith(usage, 'test-msg-id');
            expect(processor.getMetadata().usage).toEqual(usage);
        });
    });

    // ==================== buildResponse 测试 ====================

    describe('buildResponse', () => {
        it('should build response with content only', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'chatcmpl-1',
                    model: 'glm-4',
                    choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' } }],
                },
                {
                    index: 0,
                    id: 'chatcmpl-1',
                    choices: [{ index: 0, delta: { role: 'assistant', content: ' World' }, finish_reason: 'stop' }],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));
            const response = processor.buildResponse();

            expect(response.id).toBe('chatcmpl-1');
            expect(response.model).toBe('glm-4');
            expect(response.choices[0].message.content).toBe('Hello World');
            expect(response.choices[0].message.tool_calls).toBeUndefined();
            expect(response.choices[0].finish_reason).toBe('stop');
        });

        it('should build response with reasoning and content', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'Think' } }],
                },
                { index: 0, id: 'c2', choices: [{ index: 0, delta: { role: 'assistant', content: 'Answer' } }] },
            ];

            chunks.forEach((c) => processor.processChunk(c));
            const response = processor.buildResponse();

            expect(response.choices[0].message.content).toBe('Answer');
            expect(response.choices[0].message).toHaveProperty('reasoning_content', 'Think');
        });

        it('should build response with tool_calls', () => {
            const chunks: Chunk[] = [
                {
                    id: 'c1',
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_1',
                                        type: 'function',
                                        function: { name: 'read', arguments: '{}' },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ];

            chunks.forEach((c) => processor.processChunk(c));
            const response = processor.buildResponse();

            expect(response.choices[0].message.tool_calls).toHaveLength(1);
            expect(response.choices[0].message.tool_calls![0].function.name).toBe('read');
        });

        it('should include usage in response', () => {
            const usage: Usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                usage,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'test' } }],
            };

            processor.processChunk(chunk);
            const response = processor.buildResponse();

            expect(response.usage).toEqual(usage);
        });
    });

    // ==================== 状态管理测试 ====================

    describe('state management', () => {
        it('should reset all state', () => {
            const chunks: Chunk[] = [
                {
                    index: 0,
                    id: 'c1',
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'think' } }],
                },
                { index: 0, id: 'c2', choices: [{ index: 0, delta: { role: 'assistant', content: 'answer' } }] },
            ];

            chunks.forEach((c) => processor.processChunk(c));

            expect(processor.getBuffer()).toBe('answer');
            expect(processor.getReasoningBuffer()).toBe('think');

            processor.reset();

            expect(processor.getBuffer()).toBe('');
            expect(processor.getReasoningBuffer()).toBe('');
            expect(processor.hasToolCalls()).toBe(false);
            expect(processor.isAborted()).toBe(false);
        });

        it('should allow setMessageId', () => {
            processor.setMessageId('new-id');

            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'test' } }],
            };

            processor.processChunk(chunk);

            expect(onMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'new-id' }));
        });
    });

    // ==================== 缓冲区限制测试 ====================

    describe('buffer limits', () => {
        it('should abort when content buffer exceeds limit', () => {
            const smallProcessor = new StreamProcessor({
                maxBufferSize: 10,
                onMessageUpdate: vi.fn(),
                onTextDelta: vi.fn(),
                onTextStart: vi.fn(),
                onTextComplete: vi.fn(),
                onMessageCreate: vi.fn(),
            });
            smallProcessor.setMessageId('test-id');

            const chunk1: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '12345' } }],
            };
            const chunk2: Chunk = {
                id: 'c2',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '67890' } }],
            };
            const chunk3: Chunk = {
                id: 'c3',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'overflow' } }],
            };

            smallProcessor.processChunk(chunk1);
            smallProcessor.processChunk(chunk2);
            smallProcessor.processChunk(chunk3);

            expect(smallProcessor.isAborted()).toBe(true);
            expect(smallProcessor.getBuffer()).toBe('1234567890');
        });

        it('should abort when reasoning buffer exceeds limit', () => {
            const smallProcessor = new StreamProcessor({
                maxBufferSize: 5,
                onMessageUpdate: vi.fn(),
                onTextDelta: vi.fn(),
                onTextStart: vi.fn(),
                onTextComplete: vi.fn(),
                onMessageCreate: vi.fn(),
                onReasoningDelta: vi.fn(),
                onReasoningStart: vi.fn(),
                onReasoningComplete: vi.fn(),
            });
            smallProcessor.setMessageId('test-id');

            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: '1234567890' } }],
            };

            smallProcessor.processChunk(chunk);

            expect(smallProcessor.isAborted()).toBe(true);
        });

        it('should abort when total content+reasoning exceeds limit', () => {
            const smallProcessor = new StreamProcessor({
                maxBufferSize: 10,
                onMessageUpdate: vi.fn(),
                onTextDelta: vi.fn(),
                onTextStart: vi.fn(),
                onTextComplete: vi.fn(),
                onMessageCreate: vi.fn(),
                onReasoningDelta: vi.fn(),
                onReasoningStart: vi.fn(),
                onReasoningComplete: vi.fn(),
            });
            smallProcessor.setMessageId('test-id');

            smallProcessor.processChunk({
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: '12345' } }],
            });
            smallProcessor.processChunk({
                id: 'c2',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '12345' } }],
            });
            smallProcessor.processChunk({
                id: 'c3',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '1' } }],
            });

            expect(smallProcessor.isAborted()).toBe(true);
            expect(smallProcessor.getAbortReason()).toBe('buffer_overflow');
        });
    });

    describe('validation', () => {
        it('should trigger validation callback and handle violation', () => {
            const localOnValidationViolation = vi.fn();
            const validatingProcessor = new StreamProcessor({
                maxBufferSize: 100000,
                onMessageUpdate: vi.fn(),
                onTextDelta: vi.fn(),
                onTextStart: vi.fn(),
                onTextComplete: vi.fn(),
                onMessageCreate: vi.fn(),
                onValidationViolation: localOnValidationViolation,
                validatorOptions: {
                    repetitionThreshold: 2,
                    nonsenseThreshold: 1,
                    checkFrequency: 1,
                    abortOnViolation: true,
                },
            });
            validatingProcessor.setMessageId('validation-id');

            // 验证失败时可能抛出 LLMContextCompressionError 或中止
            let threwError = false;
            try {
                validatingProcessor.processChunk({
                    id: 'v1',
                    index: 0,
                    choices: [
                        { index: 0, delta: { role: 'assistant', content: 'alpha alpha alpha alpha alpha alpha' } },
                    ],
                });
            } catch {
                // 可能抛出 LLMContextCompressionError
                threwError = true;
            }

            // 验证回调应该被调用
            expect(localOnValidationViolation).toHaveBeenCalledTimes(1);
            // 要么抛出错误，要么中止
            expect(threwError || validatingProcessor.isAborted()).toBe(true);
        });
    });

    // ==================== 边界情况测试 ====================

    describe('edge cases', () => {
        it('should handle empty content gracefully', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '' } }],
            };

            processor.processChunk(chunk);

            // 空内容不应该触发事件
            expect(onTextStart).not.toHaveBeenCalled();
        });

        it('should handle empty reasoning_content gracefully', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: '' } }],
            };

            processor.processChunk(chunk);

            expect(onReasoningStart).not.toHaveBeenCalled();
        });

        it('should handle chunk with only finish_reason', () => {
            // 先处理一些内容
            processor.processChunk({
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' } }],
            });

            // 然后只有 finish_reason
            processor.processChunk({
                id: 'c2',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
            });

            expect(onTextComplete).toHaveBeenCalled();
        });

        it('should not process chunks after abort', () => {
            processor.abort();

            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: 'test' } }],
            };

            processor.processChunk(chunk);

            expect(onMessageUpdate).not.toHaveBeenCalled();
        });

        it('should handle tool_calls with finish_reason in same chunk', () => {
            const chunk: Chunk = {
                id: 'c1',
                index: 0,
                choices: [
                    {
                        index: 0,
                        delta: {
                            role: 'assistant',
                            content: '',
                            tool_calls: [
                                { index: 0, id: 'call_1', type: 'function', function: { name: 'test', arguments: '' } },
                            ],
                        },
                        finish_reason: 'tool_calls',
                    },
                ],
            };

            processor.processChunk(chunk);

            expect(onMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    finish_reason: 'tool_calls',
                })
            );
        });
    });

    // ==================== 压力测试：大量消息 ====================

    describe('stress test with many chunks', () => {
        it('should handle 100 reasoning chunks correctly', () => {
            const chunks: Chunk[] = [];
            for (let i = 0; i < 100; i++) {
                chunks.push({
                    id: `chunk-${i}`,
                    index: 0,
                    choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: `思考${i}` } }],
                });
            }

            chunks.forEach((c) => processor.processChunk(c));

            expect(onReasoningDelta).toHaveBeenCalledTimes(100);
            expect(onReasoningStart).toHaveBeenCalledTimes(1);
            expect(processor.getReasoningBuffer().length).toBeGreaterThan(0);
        });

        it('should handle 100 content chunks correctly', () => {
            const chunks: Chunk[] = [];
            for (let i = 0; i < 100; i++) {
                chunks.push({
                    id: `chunk-${i}`,
                    index: 0,
                    choices: [{ index: 0, delta: { role: 'assistant', content: `内容${i}` } }],
                });
            }

            chunks.forEach((c) => processor.processChunk(c));

            expect(onTextDelta).toHaveBeenCalledTimes(100);
            expect(onTextStart).toHaveBeenCalledTimes(1);
        });

        it('should handle 50 tool_call chunks with accumulating arguments', () => {
            const chunks: Chunk[] = [];
            for (let i = 0; i < 50; i++) {
                chunks.push({
                    id: `chunk-${i}`,
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: '',
                                        type: 'function',
                                        function: { name: '', arguments: `{"part":${i}}` },
                                    },
                                ],
                            },
                        },
                    ],
                });
            }

            chunks.forEach((c) => processor.processChunk(c));

            const toolCalls = processor.getToolCalls();
            expect(toolCalls[0].function.arguments.length).toBeGreaterThan(0);
        });

        it('should handle mixed chunks simulating real LLM conversation', () => {
            // 模拟真实的 LLM 响应序列
            const chunks: Chunk[] = [];

            // 1. 推理阶段 (20 chunks)
            for (let i = 0; i < 20; i++) {
                chunks.push({
                    id: `r-${i}`,
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: { role: 'assistant', content: '', reasoning_content: `推理步骤${i + 1}。` },
                        },
                    ],
                });
            }

            // 2. 内容阶段 (30 chunks)
            for (let i = 0; i < 30; i++) {
                chunks.push({
                    id: `c-${i}`,
                    index: 0,
                    choices: [{ index: 0, delta: { role: 'assistant', content: `这是回答的第${i + 1}部分。` } }],
                });
            }

            // 3. 工具调用阶段 (10 chunks accumulating arguments)
            for (let i = 0; i < 10; i++) {
                chunks.push({
                    id: `t-${i}`,
                    index: 0,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: i === 0 ? 'call_1' : '',
                                        type: 'function',
                                        function: {
                                            name: i === 0 ? 'read_file' : '',
                                            arguments: `{"part":${i}}`,
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                });
            }

            // 4. 结束
            chunks.push({
                id: 'final',
                index: 0,
                choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'tool_calls' }],
            });

            chunks.forEach((c) => processor.processChunk(c));

            // 验证所有内容都被正确处理
            expect(processor.getReasoningBuffer()).toContain('推理步骤');
            expect(processor.getBuffer()).toContain('回答');
            expect(processor.hasToolCalls()).toBe(true);

            const response = processor.buildResponse();
            expect(response.choices[0].message).toHaveProperty('reasoning_content');
            expect(response.choices[0].message.content).toBeTruthy();
            expect(response.choices[0].message.tool_calls).toHaveLength(1);
        });
    });
});
