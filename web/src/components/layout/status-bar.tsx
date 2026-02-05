'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { formatTimestamp, formatDuration } from '@/lib/utils'
import type { Message, AgentExecutionState } from '@/lib/types'
import { Activity, CheckCircle, Clock, XCircle, Loader2 } from 'lucide-react'

interface StatusBarProps {
  executionState: AgentExecutionState
  statusMessage?: string
  messages: Message[]
}

export default function StatusBar({ executionState, statusMessage, messages }: StatusBarProps) {
  // Get all tool calls from messages
  const allToolCalls = messages.flatMap(msg => msg.toolCalls || [])

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <CardTitle className="text-sm mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Status
        </CardTitle>

        {/* Execution State */}
        <div className="flex items-center gap-2 mb-3">
          {executionState === 'idle' && (
            <Badge variant="secondary" className="gap-1">
              <Clock className="w-3 h-3" />
              Idle
            </Badge>
          )}
          {executionState === 'thinking' && (
            <Badge variant="info" className="gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Thinking
            </Badge>
          )}
          {executionState === 'running' && (
            <Badge variant="info" className="gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Running
            </Badge>
          )}
          {executionState === 'completed' && (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="w-3 h-3" />
              Completed
            </Badge>
          )}
          {executionState === 'error' && (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="w-3 h-3" />
              Error
            </Badge>
          )}
        </div>

        {statusMessage && (
          <p className="text-xs text-muted-foreground">{statusMessage}</p>
        )}
      </div>

      <Separator />

      {/* Tool Calls List */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Tool Calls ({allToolCalls.length})
            </h3>

            {allToolCalls.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No tool calls yet
              </p>
            ) : (
              allToolCalls.map((toolCall) => (
                <Card key={toolCall.id} className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-mono font-medium">
                        {toolCall.name}
                      </h4>
                      {toolCall.status === 'pending' && (
                        <Badge variant="secondary" className="text-xs">Pending</Badge>
                      )}
                      {toolCall.status === 'running' && (
                        <Badge variant="info" className="text-xs gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Running
                        </Badge>
                      )}
                      {toolCall.status === 'success' && (
                        <Badge variant="success" className="text-xs gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Success
                        </Badge>
                      )}
                      {toolCall.status === 'error' && (
                        <Badge variant="destructive" className="text-xs gap-1">
                          <XCircle className="w-3 h-3" />
                          Error
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {/* Arguments */}
                    {Object.keys(toolCall.args).length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Arguments:</p>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                          {JSON.stringify(toolCall.args, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Stream Output */}
                    {toolCall.streamOutput && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Output:</p>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                          {toolCall.streamOutput}
                        </pre>
                      </div>
                    )}

                    {/* Result */}
                    {toolCall.result && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Result:</p>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                          {toolCall.result}
                        </pre>
                      </div>
                    )}

                    {/* Error */}
                    {toolCall.error && (
                      <div>
                        <p className="text-xs text-destructive mb-1">Error:</p>
                        <pre className="text-xs bg-destructive/10 text-destructive p-2 rounded overflow-x-auto">
                          {toolCall.error}
                        </pre>
                      </div>
                    )}

                    {/* Duration */}
                    {toolCall.duration && (
                      <p className="text-xs text-muted-foreground">
                        Duration: {formatDuration(toolCall.duration)}
                      </p>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
