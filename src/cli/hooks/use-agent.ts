/**
 * Agent Hook
 *
 * 重构后的 useAgent hook，职责：
 * 1. 初始化和管理 Agent 实例
 * 2. 将 Agent 消息转换为 UI 事件
 * 3. 协调消息状态管理
 *
 * 设计原则：
 * - 单一职责：不直接处理消息组装逻辑，委托给 useMessageStore
 * - 事件驱动：通过事件适配器将核心层消息转换为 UI 事件
 * - 清晰的状态边界：Agent 实例、消息状态、加载状态分离
 */

import { useEffect, useRef, useCallback } from 'react';
import { Agent } from '../../agent-v2/agent/agent';
import { ToolRegistry } from '../../agent-v2/tool/registry';
import { ProviderRegistry, type ModelId } from '../../providers';
import type { AgentMessage } from '../../agent-v2/agent/stream-types';
import { useMessageStore } from './use-message-store';
import { AgentEventAdapter } from '../utils/event-adapter';
import type { UIMessage } from '../types/message-types';
import { operatorPrompt } from '../../agent-v2/prompts/operator';

// =============================================================================
// Hook 配置选项
// =============================================================================

export interface UseAgentOptions {
  model: ModelId;
}

export interface UseAgentReturn {
  /** 提交用户消息 */
  submitMessage: (message: string) => void;
  /** 消息列表（UI 格式） */
  messages: UIMessage[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** Agent 实例 */
  agent: Agent | null;
  /** 当前步骤 */
  currentStep: number;
  /** 清除所有消息 */
  clearMessages: () => void;
}

// =============================================================================
// Hook 实现
// =============================================================================

export function useAgent({ model }: UseAgentOptions): UseAgentReturn {
  // ---------------------------------------------------------------------------
  // Refs（保持引用稳定）
  // ---------------------------------------------------------------------------
  const agentRef = useRef<Agent | null>(null);
  const modelRef = useRef<string>(model);
  const adapterRef = useRef<AgentEventAdapter | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // 消息状态管理
  // ---------------------------------------------------------------------------
  const {
    messages,
    isLoading,
    currentStep,
    addUserMessage,
    applyEvent,
    clearMessages: clearMessageStore,
    setLoading,
  } = useMessageStore();

  // ---------------------------------------------------------------------------
  // Agent 初始化
  // ---------------------------------------------------------------------------
  const initAgent = useCallback(() => {
    // 清理旧的适配器
    adapterRef.current?.reset();


    // 创建 Provider
    const provider = ProviderRegistry.createFromEnv(model);

    // 创建 Agent 实例
    const agent = new Agent({
      provider,
      systemPrompt: operatorPrompt({ directory: process.cwd(), vcs: 'git', language: 'Chinese' }),
      stream: true,
      streamCallback: (message: AgentMessage) => {
        // 将 Agent 消息转换为 UI 事件
        adapterRef.current?.handleAgentMessage(message);
      },
    });

    // 保存引用
    agentRef.current = agent;
    modelRef.current = model;

    // 创建事件适配器
    const adapter = new AgentEventAdapter((event) => {
      // 将 UI 事件应用到消息存储
      applyEvent(event);
    });

    adapterRef.current = adapter;

  }, [model, applyEvent]);

  // ---------------------------------------------------------------------------
  // 生命周期管理
  // ---------------------------------------------------------------------------
  useEffect(() => {
    initAgent();

    // 清理函数
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [initAgent]);

  // ---------------------------------------------------------------------------
  // 提交消息
  // ---------------------------------------------------------------------------
  const submitMessage = useCallback((message: string) => {
    const currentAgent = agentRef.current;

    if (!currentAgent || !message.trim()) {
      return;
    }

    // 如果有正在执行的任务，先中止它
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();

    // 添加用户消息到状态
    const userMessageId = `user-${Date.now()}`;
    addUserMessage(message.trim(), userMessageId);

    // 调用 Agent
    setLoading(true);
    currentAgent.execute(message.trim())
      .then(() => {
        setLoading(false);
      })
      .catch((error) => {
        console.error('Agent execution error:', error);
        setLoading(false);
      });
  }, [addUserMessage, setLoading]);

  // ---------------------------------------------------------------------------
  // 清除消息
  // ---------------------------------------------------------------------------
  const clearMessages = useCallback(() => {
    clearMessageStore();
    // Agent 不需要清除，因为每次 execute 都会使用新的会话
  }, [clearMessageStore]);

  // ---------------------------------------------------------------------------
  // 返回值
  // ---------------------------------------------------------------------------
  return {
    submitMessage,
    messages,
    isLoading,
    agent: agentRef.current,
    currentStep,
    clearMessages,
  };
}

export default useAgent;
