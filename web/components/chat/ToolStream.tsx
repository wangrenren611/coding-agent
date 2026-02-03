'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileSearch,
  Globe,
  ListTodo,
  MoreHorizontal,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { cn, parseToolArgs } from '@/lib/utils'
import { ToolCategory, getToolCategory } from '@/lib/types'

interface ToolStreamProps {
  toolName: string
  args: string
  status?: 'pending' | 'running' | 'success' | 'error'
  result?: string
}

export function ToolStream({
  toolName,
  args,
  status = 'pending',
  result,
}: ToolStreamProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const category = getToolCategory(toolName)
  const parsedArgs = parseToolArgs(args)

  const statusIcon = {
    pending: <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />,
    running: <Loader2 className="h-3 w-3 animate-spin text-blue-500" />,
    success: <CheckCircle2 className="h-3 w-3 text-green-500" />,
    error: <XCircle className="h-3 w-3 text-destructive" />,
  }[status]

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {/* Tool header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {getCategoryIcon(category)}

        <span className="text-xs font-mono font-medium">{toolName}</span>

        <div className="flex-1" />

        {statusIcon}
      </button>

      {/* Tool content */}
      {isExpanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {/* Arguments */}
          {Object.keys(parsedArgs).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Arguments:</p>
              <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
                {JSON.stringify(parsedArgs, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Result:</p>
              <div
                className={cn(
                  'text-xs bg-muted rounded p-2 overflow-x-auto font-mono',
                  status === 'error' && 'bg-destructive/10'
                )}
              >
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getCategoryIcon(category: ToolCategory) {
  const iconClassName = 'h-4 w-4 shrink-0'

  switch (category) {
    case ToolCategory.FILE_OPERATIONS:
      return <FileSearch className={cn(iconClassName, 'text-blue-500')} />
    case ToolCategory.COMMAND_TOOLS:
      return <Terminal className={cn(iconClassName, 'text-orange-500')} />
    case ToolCategory.WEB_TOOLS:
      return <Globe className={cn(iconClassName, 'text-green-500')} />
    case ToolCategory.TASK_TOOLS:
      return <ListTodo className={cn(iconClassName, 'text-purple-500')} />
    default:
      return <MoreHorizontal className={cn(iconClassName, 'text-muted-foreground')} />
  }
}
