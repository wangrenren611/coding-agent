'use client'

import { memo } from 'react'
import { Bot, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Message } from '@/lib/types'
import { ToolStream } from './ToolStream'
import { formatTime } from '@/lib/utils'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  if (isTool) {
    // Tool results are rendered inline in assistant messages
    return null
  }

  // Check if this message has tool_calls
  const toolCalls = 'tool_calls' in message ? message.tool_calls : undefined

  return (
    <div
      className={cn(
        'flex gap-3',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="shrink-0">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
        </div>
      )}

      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-3',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
        )}
      >
        <div className="text-sm whitespace-pre-wrap break-words">
          {message.content || <span className="italic opacity-50">Thinking...</span>}
        </div>

        {/* Tool calls display for assistant messages */}
        {!isUser && toolCalls && toolCalls.length > 0 && (
          <div className="mt-3 space-y-2">
            {toolCalls.map((tool: any, index: number) => (
              <ToolStream
                key={`${tool.callId}-${index}`}
                toolName={tool.toolName}
                args={tool.args}
                status={tool.status || 'success'}
                result={tool.result}
              />
            ))}
          </div>
        )}

        <div
          className={cn(
            'text-xs mt-1 opacity-70',
            isUser ? 'text-right' : 'text-left'
          )}
        >
          {message.timestamp && formatTime(message.timestamp)}
        </div>
      </div>

      {isUser && (
        <div className="shrink-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <User className="w-4 h-4" />
          </div>
        </div>
      )}
    </div>
  )
})
