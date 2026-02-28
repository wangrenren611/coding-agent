/** @jsxImportSource @opentui/react */
/**
 * Agent context - 管理 Agent 实例和状态 (React 版本)
 * 参考 demo-1.ts 的实现
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { createSimpleContext } from './helper';
import {
    Agent,
    AgentStatus,
    AgentMessage,
    AgentMessageType,
    createMemoryManager,
    IMemoryManager,
    SubagentEventMessage,
} from '../../agent-v2';
import { ProviderRegistry } from '../../providers';
import { operatorPrompt } from '../../agent-v2/prompts/operator';
import type { ModelId } from '../../providers';
import { platform } from 'os';

const CLI_REQUEST_TIMEOUT_MS = 90 * 1000;
const CLI_MAX_RETRIES = 2;
const CLI_RETRY_DELAY_MS = 1500;
const CLI_MAX_LOOPS = 80;

export interface SubagentInfo {
    taskId: string;
    subagentType: string;
    childSessionId: string;
}

export interface MessagePart {
    id: string;
    type: 'text' | 'tool-call' | 'tool-result' | 'reasoning' | 'code-patch' | 'subagent';
    content: string;
    toolName?: string;
    toolArgs?: string;
    toolCallId?: string;
    toolResult?: string;
    patchPath?: string;
    patchLanguage?: string;
    status?: 'pending' | 'success' | 'error' | 'running' | 'completed';
    subagentStatus?: 'running' | 'completed' | 'error';
    /** 子 Agent 信息 */
    subagent?: SubagentInfo;
    /** 子 Agent 的消息部分（嵌套） */
    subagentParts?: MessagePart[];
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    parts: MessagePart[];
    timestamp: number;
    status: AgentStatus;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface AgentState {
    status: AgentStatus;
    currentSessionId: string | null;
    messages: ChatMessage[];
    error: string | null;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface AgentConfig {
    modelId?: ModelId;
    thinking?: boolean;
    sessionId?: string;
}

interface AgentContextValue {
    state: AgentState;
    config: AgentConfig;
    setConfig: (config: Partial<AgentConfig>) => void;
    sendMessage: (content: string) => Promise<void>;
    abort: () => void;
    clearSession: () => void;
    initialized: boolean;
}

/**
 * 将单个 AgentMessage 转换为 MessagePart
 */
function agentMessageToPart(msg: AgentMessage): MessagePart | null {
    switch (msg.type) {
        case AgentMessageType.TEXT_START:
        case AgentMessageType.TEXT_DELTA:
        case AgentMessageType.TEXT_COMPLETE:
            return {
                id: `text-${msg.msgId || msg.timestamp}`,
                type: 'text',
                content: msg.type === AgentMessageType.TEXT_DELTA ? msg.payload.content : '',
            };
        case AgentMessageType.REASONING_START:
        case AgentMessageType.REASONING_DELTA:
        case AgentMessageType.REASONING_COMPLETE:
            return {
                id: `reasoning-${msg.msgId || msg.timestamp}`,
                type: 'reasoning',
                content: msg.type === AgentMessageType.REASONING_DELTA ? msg.payload.content : '',
            };
        case AgentMessageType.TOOL_CALL_CREATED:
            return {
                id: `tool-created-${msg.msgId || msg.timestamp}`,
                type: 'tool-call',
                content: '',
                toolName: msg.payload.tool_calls[0]?.toolName,
                toolArgs: msg.payload.tool_calls[0]?.args,
                status: 'pending',
            };
        case AgentMessageType.TOOL_CALL_RESULT:
            return {
                id: `tool-result-${msg.payload.callId}`,
                type: 'tool-result',
                content: '',
                toolResult:
                    typeof msg.payload.result === 'string'
                        ? msg.payload.result
                        : JSON.stringify(msg.payload.result, null, 2),
                status: msg.payload.status,
            };
        case AgentMessageType.TOOL_CALL_STREAM:
            return {
                id: `tool-stream-${msg.payload.callId}`,
                type: 'tool-result',
                content: '',
                toolResult: msg.payload.output,
                status: 'running',
            };
        case AgentMessageType.CODE_PATCH:
            return {
                id: `patch-${msg.msgId || msg.timestamp}`,
                type: 'code-patch',
                content: msg.payload.diff,
                patchPath: msg.payload.path,
                patchLanguage: msg.payload.language,
            };
        case AgentMessageType.STATUS:
            return {
                id: `status-${msg.timestamp}`,
                type: 'text',
                content: `状态: ${msg.payload.state}${msg.payload.message ? ` - ${msg.payload.message}` : ''}`,
            };
        case AgentMessageType.ERROR:
            return {
                id: `error-${msg.timestamp}`,
                type: 'text',
                content: `错误: ${msg.payload.error}`,
            };
        case AgentMessageType.USAGE_UPDATE:
            return null; // Usage 不显示为消息部分
        default:
            return null;
    }
}

/**
 * 处理子 Agent 事件冒泡
 */
function handleSubagentEvent(parts: MessagePart[], subagentMsg: SubagentEventMessage) {
    const { task_id, subagent_type, child_session_id, event } = subagentMsg.payload;

    const ensureSubagentHost = (): number => {
        const linkedTaskToolIndex = parts.findIndex((p) => p.type === 'tool-call' && p.subagent?.taskId === task_id);
        if (linkedTaskToolIndex !== -1) {
            return linkedTaskToolIndex;
        }

        const firstUnlinkedTaskToolIndex = parts.findIndex(
            (p) => p.type === 'tool-call' && p.toolName === 'task' && !p.subagent
        );
        if (firstUnlinkedTaskToolIndex !== -1) {
            parts[firstUnlinkedTaskToolIndex] = {
                ...parts[firstUnlinkedTaskToolIndex],
                subagent: {
                    taskId: task_id,
                    subagentType: subagent_type,
                    childSessionId: child_session_id,
                },
                subagentParts: parts[firstUnlinkedTaskToolIndex].subagentParts || [],
            };
            return firstUnlinkedTaskToolIndex;
        }

        const standaloneIndex = parts.findIndex((p) => p.type === 'subagent' && p.subagent?.taskId === task_id);
        if (standaloneIndex !== -1) {
            return standaloneIndex;
        }

        parts.push({
            id: `subagent-${task_id}`,
            type: 'subagent',
            content: '',
            subagentStatus: 'running',
            subagent: {
                taskId: task_id,
                subagentType: subagent_type,
                childSessionId: child_session_id,
            },
            subagentParts: [],
        });
        return parts.length - 1;
    };

    const hostIndex = ensureSubagentHost();
    const host = parts[hostIndex];

    if (event.type === AgentMessageType.STATUS) {
        const state = event.payload.state as AgentStatus;
        const nextSubagentStatus =
            state === AgentStatus.COMPLETED
                ? 'completed'
                : state === AgentStatus.FAILED || state === AgentStatus.ABORTED
                  ? 'error'
                  : 'running';

        parts[hostIndex] = {
            ...host,
            subagentStatus: nextSubagentStatus,
        };
        return;
    }

    const hostSubagentParts = host.subagentParts ? [...host.subagentParts] : [];

    if (event.type === AgentMessageType.SUBAGENT_EVENT) {
        handleSubagentEvent(hostSubagentParts, event as SubagentEventMessage);
        parts[hostIndex] = {
            ...host,
            subagentParts: hostSubagentParts,
        };
        return;
    }

    const part = agentMessageToPart(event);
    if (!part) {
        return;
    }

    if (event.type === AgentMessageType.TEXT_DELTA || event.type === AgentMessageType.REASONING_DELTA) {
        const existingPartIndex = hostSubagentParts.findIndex((p) => p.id === part.id);
        if (existingPartIndex !== -1) {
            hostSubagentParts[existingPartIndex] = {
                ...hostSubagentParts[existingPartIndex],
                content: hostSubagentParts[existingPartIndex].content + event.payload.content,
            };
        } else {
            hostSubagentParts.push(part);
        }
    } else if (event.type === AgentMessageType.TOOL_CALL_STREAM) {
        const existingPartIndex = hostSubagentParts.findIndex((p) => p.id === part.id);
        if (existingPartIndex !== -1) {
            hostSubagentParts[existingPartIndex] = {
                ...hostSubagentParts[existingPartIndex],
                toolResult: (hostSubagentParts[existingPartIndex].toolResult || '') + event.payload.output,
            };
        } else {
            hostSubagentParts.push(part);
        }
    } else {
        hostSubagentParts.push(part);
    }

    parts[hostIndex] = {
        ...host,
        subagentParts: hostSubagentParts,
    };
}

export const { Provider: AgentProvider, use: useAgent } = createSimpleContext<AgentContextValue>('Agent', () => {
    const [config, setConfigState] = useState<AgentConfig>({
        modelId: 'qwen3.5-plus',
        thinking: true,
    });
    const [initialized, setInitialized] = useState(false);
    const [state, setState] = useState<AgentState>({
        status: AgentStatus.IDLE,
        currentSessionId: null,
        messages: [],
        error: null,
    });

    const agentRef = useRef<Agent | null>(null);
    const memoryManagerRef = useRef<IMemoryManager | null>(null);

    // 初始化
    const init = useCallback(async () => {
        if (initialized) return;

        try {
            // 1. 创建工具注册表
            // toolRegistryRef.current = new ToolRegistry({
            //   workingDirectory: process.cwd(),
            // });
            // toolRegistryRef.current.register([new BashTool()]);

            // 2. 创建内存管理器
            const memoryPath =
                platform() === 'win32'
                    ? 'D:/work/coding-agent-data/agent-memory'
                    : '/Users/wrr/work/coding-agent-data/agent-memory';

            const fs = await import('fs');
            try {
                fs.mkdirSync(memoryPath, { recursive: true });
            } catch {
                // ignore
            }

            memoryManagerRef.current = createMemoryManager({
                type: 'file',
                connectionString: memoryPath,
            });
            await memoryManagerRef.current.initialize();

            setInitialized(true);
        } catch (error) {
            console.error('Failed to initialize agent context:', error);
        }
    }, [initialized]);

    const setConfig = useCallback((newConfig: Partial<AgentConfig>) => {
        setConfigState((prev) => ({ ...prev, ...newConfig }));
    }, []);

    const handleStreamMessage = useCallback((msg: AgentMessage, messageId: string) => {
        setState((s) => {
            const msgIndex = s.messages.findIndex((m) => m.id === messageId);
            if (msgIndex === -1) return s;

            const messages = [...s.messages];
            const parts = [...messages[msgIndex].parts];

            switch (msg.type) {
                case AgentMessageType.TEXT_START:
                    parts.push({
                        id: `text-${msg.msgId}`,
                        type: 'text',
                        content: '',
                    });
                    break;

                case AgentMessageType.TEXT_DELTA: {
                    const textPartIndex = parts.findIndex((p) => p.id === `text-${msg.msgId}`);
                    if (textPartIndex !== -1) {
                        parts[textPartIndex] = {
                            ...parts[textPartIndex],
                            content: parts[textPartIndex].content + msg.payload.content,
                        };
                    }
                    break;
                }

                case AgentMessageType.TEXT_COMPLETE:
                    break;

                case AgentMessageType.REASONING_START:
                    parts.push({
                        id: `reasoning-${msg.msgId}`,
                        type: 'reasoning',
                        content: '',
                    });
                    break;

                case AgentMessageType.REASONING_DELTA: {
                    const reasoningPartIndex = parts.findIndex((p) => p.id === `reasoning-${msg.msgId}`);
                    if (reasoningPartIndex !== -1) {
                        parts[reasoningPartIndex] = {
                            ...parts[reasoningPartIndex],
                            content: parts[reasoningPartIndex].content + msg.payload.content,
                        };
                    }
                    break;
                }

                case AgentMessageType.REASONING_COMPLETE:
                    break;

                case AgentMessageType.TOOL_CALL_CREATED:
                    msg.payload.tool_calls.forEach((tc) => {
                        parts.push({
                            id: `tool-${tc.callId}`,
                            type: 'tool-call',
                            content: '',
                            toolName: tc.toolName,
                            toolArgs: tc.args,
                            toolCallId: tc.callId,
                            status: 'pending',
                        });
                    });
                    break;

                case AgentMessageType.TOOL_CALL_RESULT: {
                    const toolPartIndex = parts.findIndex((p) => p.id === `tool-${msg.payload.callId}`);
                    if (toolPartIndex !== -1) {
                        parts[toolPartIndex] = {
                            ...parts[toolPartIndex],
                            status: msg.payload.status,
                            toolResult:
                                typeof msg.payload.result === 'string'
                                    ? msg.payload.result
                                    : JSON.stringify(msg.payload.result, null, 2),
                        };
                    }
                    const toolResultPartId = `tool-result-${msg.payload.callId}`;
                    const toolResultPartIndex = parts.findIndex((p) => p.id === toolResultPartId);
                    const resultText =
                        typeof msg.payload.result === 'string'
                            ? msg.payload.result
                            : JSON.stringify(msg.payload.result, null, 2);
                    if (toolResultPartIndex !== -1) {
                        parts[toolResultPartIndex] = {
                            ...parts[toolResultPartIndex],
                            status: msg.payload.status,
                            toolResult: resultText,
                        };
                    } else {
                        parts.push({
                            id: toolResultPartId,
                            type: 'tool-result',
                            content: '',
                            toolResult: resultText,
                            status: msg.payload.status,
                        });
                    }
                    break;
                }

                case AgentMessageType.TOOL_CALL_STREAM: {
                    const toolStreamPartId = `tool-result-${msg.payload.callId}`;
                    const toolStreamPartIndex = parts.findIndex((p) => p.id === toolStreamPartId);
                    if (toolStreamPartIndex !== -1) {
                        const previous = parts[toolStreamPartIndex].toolResult || '';
                        parts[toolStreamPartIndex] = {
                            ...parts[toolStreamPartIndex],
                            toolResult: previous + msg.payload.output,
                            status: 'pending',
                        };
                    } else {
                        parts.push({
                            id: toolStreamPartId,
                            type: 'tool-result',
                            content: '',
                            toolResult: msg.payload.output,
                            status: 'pending',
                        });
                    }
                    break;
                }

                case AgentMessageType.STATUS:
                    return { ...s, status: msg.payload.state };

                case AgentMessageType.USAGE_UPDATE:
                    messages[msgIndex] = {
                        ...messages[msgIndex],
                        usage: msg.payload.usage,
                    };
                    return {
                        ...s,
                        messages,
                        usage: msg.payload.cumulative || msg.payload.usage,
                    };

                case AgentMessageType.ERROR:
                    return {
                        ...s,
                        error: msg.payload.error,
                    };

                case AgentMessageType.CODE_PATCH:
                    parts.push({
                        id: `patch-${msg.msgId || msg.timestamp}`,
                        type: 'code-patch',
                        content: msg.payload.diff,
                        patchPath: msg.payload.path,
                        patchLanguage: msg.payload.language,
                    });
                    break;

                case AgentMessageType.SUBAGENT_EVENT:
                    // 子 Agent 事件冒泡 - 处理子 Agent 事件
                    handleSubagentEvent(parts, msg as SubagentEventMessage);
                    break;

                default: {
                    const _exhaustive: never = msg;
                    void _exhaustive;
                    break;
                }
            }

            messages[msgIndex] = { ...messages[msgIndex], parts };
            return { ...s, messages };
        });
    }, []);

    const sendMessage = useCallback(
        async (content: string) => {
            // 确保已初始化
            if (!initialized) {
                await init();
            }

            // if (!memoryManagerRef.current || !toolRegistryRef.current) {
            //   setState((s) => ({ ...s, error: "Agent not initialized" }));
            //   return;
            // }

            // 添加用户消息
            const userMessage: ChatMessage = {
                id: `user-${Date.now()}`,
                role: 'user',
                parts: [{ id: `part-${Date.now()}`, type: 'text', content }],
                timestamp: Date.now(),
                status: AgentStatus.IDLE,
            };

            // 创建助手消息占位
            const assistantMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                parts: [],
                timestamp: Date.now(),
                status: AgentStatus.THINKING,
            };

            setState((s) => ({
                ...s,
                status: AgentStatus.RUNNING,
                error: null,
                messages: [...s.messages, userMessage, assistantMessage],
            }));

            try {
                // 创建 Provider
                const provider = ProviderRegistry.createFromEnv(config.modelId || 'qwen3.5-plus', {
                    timeout: CLI_REQUEST_TIMEOUT_MS,
                });

                // 生成系统提示
                const systemPrompt = operatorPrompt({
                    directory: process.cwd(),
                    language: 'Chinese',
                });
                // 创建 Agent 实例
                agentRef.current = new Agent({
                    provider,
                    systemPrompt,
                    // toolRegistry: toolRegistryRef.current,
                    requestTimeout: CLI_REQUEST_TIMEOUT_MS,
                    maxRetries: CLI_MAX_RETRIES,
                    retryDelayMs: CLI_RETRY_DELAY_MS,
                    maxLoops: CLI_MAX_LOOPS,
                    // 恢复会话（如果配置了 sessionId）
                    sessionId: config.sessionId || state.currentSessionId || undefined,
                    stream: true,
                    thinking: config.thinking,
                    enableCompaction: true,
                    compactionConfig: {
                        keepMessagesNum: 40,
                        triggerRatio: 0.9,
                    },
                    memoryManager: memoryManagerRef.current ?? undefined,
                    streamCallback: (msg: AgentMessage) => {
                        handleStreamMessage(msg, assistantMessage.id);
                    },
                });

                // 监听重试事件
                // agentRef.current.on(EventType.TASK_RETRY, (data) => {
                //   console.log("🔄 任务重试中:", data);
                // });

                setState((s) => ({
                    ...s,
                    currentSessionId: agentRef.current!.getSessionId(),
                }));

                // 执行查询
                await agentRef.current.execute(content);

                // 更新最终消息状态
                setState((s) => ({
                    ...s,
                    status: AgentStatus.IDLE,
                    messages: s.messages.map((m) =>
                        m.id === assistantMessage.id ? { ...m, status: AgentStatus.COMPLETED } : m
                    ),
                }));
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                setState((s) => ({
                    ...s,
                    status: AgentStatus.FAILED,
                    error: errorMessage,
                    messages: s.messages.map((m) =>
                        m.id === assistantMessage.id
                            ? {
                                  ...m,
                                  status: AgentStatus.FAILED,
                                  parts: [
                                      ...m.parts,
                                      {
                                          id: `error-${Date.now()}`,
                                          type: 'text' as const,
                                          content: `Error: ${errorMessage}`,
                                      },
                                  ],
                              }
                            : m
                    ),
                }));
            }
        },
        [initialized, init, config, state.currentSessionId, handleStreamMessage]
    );

    const abort = useCallback(() => {
        if (agentRef.current) {
            agentRef.current.abort();
            setState((s) => ({ ...s, status: AgentStatus.ABORTED }));
        }
    }, []);

    const clearSession = useCallback(async () => {
        setState({
            status: AgentStatus.IDLE,
            currentSessionId: null,
            messages: [],
            error: null,
            usage: undefined,
        });
        agentRef.current = null;
        setConfigState((prev) => ({ ...prev, sessionId: undefined }));
    }, []);

    // 组件挂载时初始化
    useEffect(() => {
        init();
    }, [init]);

    return useMemo(
        () => ({
            state,
            config,
            setConfig,
            sendMessage,
            abort,
            clearSession,
            initialized,
        }),
        [state, config, setConfig, sendMessage, abort, clearSession, initialized]
    );
});

export type AgentContext = ReturnType<typeof useAgent>;
