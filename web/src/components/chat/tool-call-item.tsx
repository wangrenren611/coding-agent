'use client'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatDuration } from '@/lib/utils'
import type { ToolInvocation } from '@/lib/types'
import { CheckCircle, XCircle, Clock, Loader2, Wrench } from 'lucide-react'

interface ToolCallItemProps {
  toolCall: ToolInvocation
}

export default function ToolCallItem({ toolCall }: ToolCallItemProps) {
  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-muted-foreground" />
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'error':
        return <XCircle className="w-4 h-4 text-destructive" />
    }
  }

  const getStatusVariant = (): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" => {
    switch (toolCall.status) {
      case 'pending':
        return 'secondary'
      case 'running':
        return 'info'
      case 'success':
        return 'success'
      case 'error':
        return 'destructive'
      default:
        return 'secondary'
    }
  }

  return (
    <Card className="p-3 bg-background/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-muted-foreground" />
          <span className="font-mono text-sm font-medium">{toolCall.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <Badge variant={getStatusVariant()} className="text-xs">
            {toolCall.status}
          </Badge>
        </div>
      </div>

      {/* Arguments */}
      {Object.keys(toolCall.args).length > 0 && (
        <details className="mb-2">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Arguments
          </summary>
          <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
            {JSON.stringify(toolCall.args, null, 2)}
          </pre>
        </details>
      )}

      {/* Stream Output */}
      {toolCall.streamOutput && (
        <div className="mb-2">
          <p className="text-xs text-muted-foreground mb-1">Output:</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
            {toolCall.streamOutput}
          </pre>
        </div>
      )}

      {/* Result */}
      {toolCall.result && (
        <div className="mb-2">
          <p className="text-xs text-muted-foreground mb-1">Result:</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
            {toolCall.result}
          </pre>
        </div>
      )}

      {/* Error */}
      {toolCall.error && (
        <div className="mb-2">
          <p className="text-xs text-destructive mb-1">Error:</p>
          <pre className="text-xs bg-destructive/10 text-destructive p-2 rounded overflow-x-auto">
            {toolCall.error}
          </pre>
        </div>
      )}

      {/* Duration */}
      {toolCall.duration && (
        <p className="text-xs text-muted-foreground">
          Completed in {formatDuration(toolCall.duration)}
        </p>
      )}
    </Card>
  )
}
