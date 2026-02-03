'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SessionList } from '@/components/sessions/SessionList'
import { useChatStream } from '@/hooks/use-chat-stream'
import { getSession, getAllSessions, createSession } from '@/lib/sessions'
import { AgentStatus, type Message, type StreamEvent } from '@/lib/types'
import { Button } from '@/components/ui/button'

// Simple UUID generator for client-side message IDs
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

export function ChatContainer() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.sessionId as string

  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sessions, setSessions] = useState(getAllSessions())

  const { isStreaming, agentStatus, error, sendMessage, stopStreaming } =
    useChatStream({
      sessionId,
      onEvent: handleStreamEvent,
      onError: (err) => {
        console.error('Stream error:', err)
      },
      onComplete: () => {
        // Reload messages when complete
        loadMessages()
        setSessions(getAllSessions()) // Refresh sessions to update titles
      },
    })

  // Load messages for this session
  const loadMessages = useCallback(async () => {
    if (!sessionId) return

    try {
      const response = await fetch(`/api/chat/messages?sessionId=${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        setMessages(data.messages)
      }
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  // Handle stream events
  function handleStreamEvent(event: StreamEvent) {
    console.log('Stream event:', event.type, event.msgId)
    switch (event.type) {
      case 'text':
        if (event.msgId) {
          const newContent = (event.payload as { content: string })?.content || ''

          // Skip empty content events - they're just for signaling
          if (!newContent) return

          setMessages(prev => {
            const existing = prev.find(m => m.messageId === event.msgId)

            if (existing) {
              // Update existing message - append content
              return prev.map(m =>
                m.messageId === event.msgId
                  ? { ...m, content: (m.content || '') + newContent }
                  : m
              )
            } else {
              // Create new assistant message with content
              return [
                ...prev,
                {
                  messageId: event.msgId,
                  role: 'assistant',
                  type: 'text',
                  content: newContent,
                  timestamp: Date.now(),
                },
              ]
            }
          })
        }
        break

      case 'tool_call_created':
        if (event.msgId && event.payload?.tool_calls) {
          setMessages(prev => {
            const toolCalls = (event.payload as { tool_calls: unknown[] }).tool_calls
            const existing = prev.find(m => m.messageId === event.msgId)
            if (existing) {
              return prev.map(m =>
                m.messageId === event.msgId
                  ? { ...m, tool_calls: toolCalls }
                  : m
              )
            } else {
              // Create new message with tool calls
              return [
                ...prev,
                {
                  messageId: event.msgId,
                  role: 'assistant',
                  type: 'tool-call',
                  content: '',
                  tool_calls: toolCalls,
                  timestamp: Date.now(),
                },
              ]
            }
          })
        }
        break

      case 'status':
        // Status events only update the loading state, don't create messages
        console.log('Status:', (event.payload as { state: AgentStatus; message: string }).state)
        break
    }
  }

  // Handle sending a message
  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return

      // Add user message immediately
      const userMessage: Message = {
        messageId: generateMessageId(),
        role: 'user',
        type: 'text',
        content,
        timestamp: Date.now(),
      }

      setMessages(prev => [...prev, userMessage])

      // Send via stream
      await sendMessage(content)
    },
    [isStreaming, sendMessage]
  )

  // Handle stopping
  const handleStop = useCallback(() => {
    stopStreaming()
  }, [stopStreaming])

  // Handle new chat
  const handleNewChat = useCallback(() => {
    const newSession = createSession()
    router.push(`/chat/${newSession.id}`)
  }, [router])

  // Handle session change (from SessionList)
  const handleSessionChange = useCallback((newSessionId: string) => {
    router.push(`/chat/${newSessionId}`)
  }, [router])

  // Refresh sessions
  const refreshSessions = useCallback(() => {
    setSessions(getAllSessions())
  }, [])

  // Load messages on mount and when session changes
  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Verify session exists
  useEffect(() => {
    if (sessionId && !isLoading) {
      const session = getSession(sessionId)
      if (!session && sessions.length > 0) {
        // Session doesn't exist, redirect to first session
        router.push(`/chat/${sessions[0].id}`)
      }
    }
  }, [sessionId, sessions, isLoading, router])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const currentSession = getSession(sessionId)

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 shrink-0">
        <SessionList
          currentSessionId={sessionId}
          onSessionChange={handleSessionChange}
          onNewChat={handleNewChat}
          sessions={sessions}
          onRefresh={refreshSessions}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center justify-between px-6">
          <h1 className="text-lg font-semibold truncate">
            {currentSession?.title || 'Chat'}
          </h1>
          <div className="flex items-center gap-2">
            {(agentStatus === AgentStatus.RUNNING ||
              agentStatus === AgentStatus.THINKING ||
              agentStatus === AgentStatus.RETRYING) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                <span>
                  {agentStatus === AgentStatus.THINKING
                    ? 'Thinking...'
                    : agentStatus === AgentStatus.RETRYING
                      ? 'Retrying...'
                      : 'Processing...'}
                </span>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewChat}
              className="hidden sm:inline-flex"
            >
              New Chat
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-auto">
          <MessageList messages={messages} isStreaming={isStreaming} />
        </div>

        {/* Error display */}
        {error && (
          <div className="px-6 py-2 bg-destructive/10 border-t border-destructive/20 flex items-center gap-2 text-destructive">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border p-4">
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            disabled={isStreaming}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  )
}
