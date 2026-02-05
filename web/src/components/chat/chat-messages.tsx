'use client'

import MessageItem from './message-item'
import type { Message } from '@/lib/types'
import { Loader2 } from 'lucide-react'

interface ChatMessagesProps {
  messages: Message[]
  isLoading: boolean
}

export default function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-4">
          <Loader2 className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Start a conversation</h2>
        <p className="text-muted-foreground max-w-md">
          Send a message to begin interacting with the AI agent. Ask me anything about development tasks, code review, or general questions.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}

      {isLoading && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Agent is thinking...</span>
        </div>
      )}
    </div>
  )
}
