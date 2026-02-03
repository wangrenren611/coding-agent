'use client'

import { useCallback, useRef, useState } from 'react'
import {
  type StreamEvent,
  type Message,
  AgentStatus,
} from '@/lib/types'
import { addMessage, updateMessage } from '@/lib/sessions'

export interface UseChatStreamOptions {
  sessionId: string
  onEvent?: (event: StreamEvent) => void
  onError?: (error: Error) => void
  onComplete?: () => void
}

export interface ChatStreamState {
  isStreaming: boolean
  agentStatus: AgentStatus
  error: string | null
}

export function useChatStream(options: UseChatStreamOptions) {
  const { sessionId, onEvent, onError, onComplete } = options

  const [state, setState] = useState<ChatStreamState>({
    isStreaming: false,
    agentStatus: AgentStatus.IDLE,
    error: null,
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const eventSourceRef = useRef<Response | null>(null)

  const sendMessage = useCallback(
    async (message: string): Promise<void> => {
      // Abort any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      // Reset state
      setState({
        isStreaming: true,
        agentStatus: AgentStatus.RUNNING,
        error: null,
      })

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, sessionId }),
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        eventSourceRef.current = response

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (!reader) {
          throw new Error('No reader available')
        }

        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()

          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Process complete SSE messages
          const lines = buffer.split('\n\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data: StreamEvent = JSON.parse(line.slice(6))

                // Update local state based on event type
                if (data.type === 'status') {
                  const payload = data.payload as { state: AgentStatus; message: string }
                  setState(prev => ({
                    ...prev,
                    agentStatus: payload.state,
                  }))
                }

                // Call custom event handler
                onEvent?.(data)
              } catch (parseError) {
                console.error('Failed to parse SSE data:', parseError)
              }
            }
          }
        }

        setState({
          isStreaming: false,
          agentStatus: AgentStatus.COMPLETED,
          error: null,
        })

        onComplete?.()
      } catch (error) {
        const err = error as Error
        setState({
          isStreaming: false,
          agentStatus: AgentStatus.FAILED,
          error: err.message,
        })
        onError?.(err)
      }
    },
    [sessionId, onEvent, onError, onComplete]
  )

  const stopStreaming = useCallback(async (): Promise<void> => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    try {
      await fetch('/api/chat', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      })
    } catch (error) {
      console.error('Error stopping stream:', error)
    }

    setState({
      isStreaming: false,
      agentStatus: AgentStatus.ABORTED,
      error: null,
    })
  }, [sessionId])

  return {
    ...state,
    sendMessage,
    stopStreaming,
  }
}
