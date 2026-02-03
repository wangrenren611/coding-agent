'use client'

import { memo, useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@/lib/types'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
}

export const MessageList = memo(function MessageList({
  messages,
  isStreaming,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Function to check if user is near bottom (within 100px)
    const isNearBottom = () => {
      return container.scrollHeight - container.scrollTop - container.clientHeight < 100
    }

    // Scroll to bottom if near bottom
    const scrollToBottom = () => {
      container.scrollTop = container.scrollHeight
    }

    // Scroll immediately when messages change
    if (messages.length > 0) {
      if (isNearBottom() || isStreaming) {
        scrollToBottom()
        userScrolledRef.current = false
      }
    }
  }, [messages, isStreaming])

  // Handle user scroll events
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      // Clear any pending timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      // Debounce the check
      scrollTimeoutRef.current = setTimeout(() => {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

        if (!isNearBottom) {
          userScrolledRef.current = true
        } else {
          userScrolledRef.current = false
        }
      }, 100)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto scrollbar-minimal"
    >
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-lg font-medium">Start a conversation</p>
              <p className="text-sm mt-2">
                Ask me to help you with coding tasks, explain concepts, or more.
              </p>
            </div>
          </div>
        ) : (
          messages.map(message => (
            <MessageBubble
              key={message.messageId}
              message={message}
              isStreaming={isStreaming}
            />
          ))
        )}
      </div>
    </div>
  )
})
