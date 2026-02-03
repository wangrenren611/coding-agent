/**
 * Agent wrapper for web interface
 * Integrates with the existing agent-v2 module
 */

import { Agent } from '@src/agent-v2/agent/agent'
import { ProviderRegistry } from '@src/providers'
import type { LLMProvider } from '@src/providers'
import { AgentStatus, type StreamEvent, type Message as AgentMessage } from './types'
import { addMessage, updateMessage, getSession, createSession } from './sessions'

// Simple UUID generator
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ==================== Agent Manager ====================

/**
 * Manages agent instances per session
 */
class AgentManager {
  private agents: Map<string, WebAgent> = new Map()

  /**
   * Get or create an agent for a session
   */
  getOrCreateAgent(sessionId: string, options?: AgentOptions): WebAgent {
    let agent = this.agents.get(sessionId)

    if (!agent) {
      agent = new WebAgent(sessionId, options)
      this.agents.set(sessionId, agent)
    }

    return agent
  }

  /**
   * Remove an agent (when session is deleted)
   */
  removeAgent(sessionId: string): void {
    const agent = this.agents.get(sessionId)
    if (agent) {
      agent.abort()
      this.agents.delete(sessionId)
    }
  }

  /**
   * Get an existing agent without creating
   */
  getAgent(sessionId: string): WebAgent | undefined {
    return this.agents.get(sessionId)
  }

  /**
   * Clear all agents
   */
  clear(): void {
    this.agents.forEach(agent => agent.abort())
    this.agents.clear()
  }
}

// ==================== Web Agent ====================

export interface AgentOptions {
  provider?: LLMProvider
  systemPrompt?: string
  workingDirectory?: string
}

export interface StreamCallbacks {
  onEvent?: (event: StreamEvent) => void
  onError?: (error: Error) => void
  onComplete?: () => void
}

/**
 * WebAgent wraps the Agent class for web usage
 * Handles session integration and event streaming
 */
class WebAgent {
  private sessionId: string
  private agent: Agent | null = null
  private options: AgentOptions
  private currentMessageId: string | null = null
  private isInitialized = false

  constructor(sessionId: string, options: AgentOptions = {}) {
    this.sessionId = sessionId
    this.options = options
  }

  /**
   * Initialize the agent with provider
   */
  private async initAgent(): Promise<void> {
    if (this.isInitialized) return

    // Get or create provider
    let provider: LLMProvider

    if (this.options.provider) {
      provider = this.options.provider
    } else {
      // Load from environment or use default
      // ProviderRegistry.createFromEnv takes a modelId (like 'glm-4.7', 'minimax-2.1')
      const modelId = (process.env.LLM_MODEL_ID || 'glm-4.7') as any
      provider = ProviderRegistry.createFromEnv(modelId, {
        apiKey: process.env.LLM_API_KEY,
        baseURL: process.env.LLM_BASE_URL,
      })
    }

    // Create the agent
    this.agent = new Agent({
      provider,
      systemPrompt: this.options.systemPrompt,
      stream: true,
      streamCallback: (data) => {
        this.handleStreamEvent(data)
      },
    })

    this.isInitialized = true
  }

  /**
   * Execute a query and stream results
   */
  async execute(message: string, callbacks: StreamCallbacks = {}): Promise<void> {
    await this.initAgent()

    if (!this.agent) {
      throw new Error('Agent initialization failed')
    }

    // Store callbacks for use in stream handler
    this.currentCallbacks = callbacks

    // Create user message
    const userMessage: AgentMessage = {
      messageId: uuidv4(),
      role: 'user',
      type: 'text',
      content: message,
      timestamp: Date.now(),
    }

    // Add to session
    const session = addMessage(this.sessionId, userMessage)

    // Emit user message event
    callbacks.onEvent?.({
      type: 'text',
      payload: { content: '' },
      msgId: userMessage.messageId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
    })

    // Execute the agent
    try {
      const response = await this.agent.execute(message)
      callbacks.onComplete?.()
    } catch (error) {
      callbacks.onError?.(error as Error)
    }
  }

  /**
   * Current callbacks for streaming
   */
  private currentCallbacks: StreamCallbacks = {}

  /**
   * Handle stream events from the agent
   */
  private handleStreamEvent(event: any): void {
    const { onEvent, onError } = this.currentCallbacks

    try {
      // Map agent event to web event
      const streamEvent: StreamEvent = {
        type: event.type,
        payload: event.payload,
        msgId: event.msgId,
        sessionId: event.sessionId || this.sessionId,
        timestamp: event.timestamp || Date.now(),
      }

      // Update session with message data
      this.updateSessionFromEvent(streamEvent)

      onEvent?.(streamEvent)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  /**
   * Update session based on stream event
   */
  private updateSessionFromEvent(event: StreamEvent): void {
    if (!event.msgId) return

    switch (event.type) {
      case 'text':
        // Update message content
        if (event.payload?.content) {
          updateMessage(this.sessionId, event.msgId, {
            content: event.payload.content as string,
          })
        }
        break

      case 'tool_call_created':
        // Add tool call info
        updateMessage(this.sessionId, event.msgId, {
          tool_calls: event.payload?.tool_calls as any,
        })
        break

      case 'tool_call_result':
        // Add tool result message
        const resultPayload = event.payload as any
        addMessage(this.sessionId, {
          messageId: uuidv4(),
          role: 'tool',
          type: 'tool-result',
          tool_call_id: resultPayload.callId,
          content: resultPayload.result,
          timestamp: Date.now(),
        })
        break
    }
  }

  /**
   * Get current messages from session
   */
  getMessages(): AgentMessage[] {
    const session = createSession({ id: this.sessionId })
    return session.messages
  }

  /**
   * Get current agent status
   */
  getStatus(): AgentStatus {
    return this.agent?.getStatus() ?? AgentStatus.IDLE
  }

  /**
   * Abort current execution
   */
  abort(): void {
    this.agent?.abort()
    this.currentCallbacks = {}
  }
}

// ==================== Singleton Agent Manager ====================

let agentManagerInstance: AgentManager | null = null

export function getAgentManager(): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager()
  }
  return agentManagerInstance
}

// ==================== Convenience Functions ====================

export async function executeAgentQuery(
  sessionId: string,
  message: string,
  callbacks: StreamCallbacks,
  options?: AgentOptions
): Promise<void> {
  const manager = getAgentManager()
  const agent = manager.getOrCreateAgent(sessionId, options)
  return agent.execute(message, callbacks)
}

export function getAgentStatus(sessionId: string): AgentStatus {
  const manager = getAgentManager()
  const agent = manager.getAgent(sessionId)
  return agent?.getStatus() ?? AgentStatus.IDLE
}

export function abortAgent(sessionId: string): void {
  const manager = getAgentManager()
  const agent = manager.getAgent(sessionId)
  agent?.abort()
}

export function removeAgent(sessionId: string): void {
  const manager = getAgentManager()
  manager.removeAgent(sessionId)
}
