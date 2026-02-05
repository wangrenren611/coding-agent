'use client'

import { useEffect, useRef } from 'react'
import ChatMessages from './chat-messages'
import ChatInput from './chat-input'
import type { Message } from '@/lib/types'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface ChatContainerProps {
  messages: Message[]
  isLoading: boolean
  onSendMessage: (content: string) => void
}

export default function ChatContainer({ messages, isLoading, onSendMessage }: ChatContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <ScrollArea className="flex-1">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <ChatMessages messages={messages} isLoading={isLoading} />
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <Separator />

      {/* Input Area */}
      <div className="p-4">
        <ChatInput onSend={onSendMessage} disabled={isLoading} />
      </div>
    </div>
  )
}
