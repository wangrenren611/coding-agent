'use client'

import { useState, useCallback, useEffect } from 'react'
import { AgentStatus, type Message, type StreamEvent } from '@/lib/types'
import { getSession } from '@/lib/sessions'

export interface UseAgentOptions {
  sessionId: string
  onStatusChange?: (status: AgentStatus) => void
  onNewMessage?: (message: Message) => void
}

export function useAgent({ sessionId, onStatusChange, onNewMessage }: UseAgentOptions) {
  const [status, setStatus] = useState<AgentStatus>(AgentStatus.IDLE)
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState<string | null>(null)

  // Load messages from session
  const loadMessages = useCallback(async () => {
    const session = getSession(sessionId)
    if (session) {
      setMessages(session.messages)
    }
  }, [sessionId])

  // Update status and trigger callback
  const updateStatus = useCallback((newStatus: AgentStatus) => {
    setStatus(newStatus)
    onStatusChange?.(newStatus)
  }, [onStatusChange])

  // Handle stream events
  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'status':
        const payload = event.payload as { state: AgentStatus; message: string }
        updateStatus(payload.state)
        break

      case 'text':
        // Text content is updated in the stream handler
        break

      case 'error':
        const errorPayload = event.payload as { error: string }
        setError(errorPayload.error)
        updateStatus(AgentStatus.FAILED)
        break
    }
  }, [updateStatus])

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Load messages on mount
  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  return {
    status,
    messages,
    error,
    clearError,
    handleStreamEvent,
    loadMessages,
  }
}
