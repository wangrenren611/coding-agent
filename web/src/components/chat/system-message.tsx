'use client'

import { Badge } from '@/components/ui/badge'
import { AlertCircle, Info, AlertTriangle } from 'lucide-react'
import type { Message } from '@/lib/types'

interface SystemMessageProps {
  message: Message & { level: 'info' | 'warn' | 'error' }
}

export default function SystemMessage({ message }: SystemMessageProps) {
  const getLevelConfig = () => {
    switch (message.level) {
      case 'info':
        return {
          icon: <Info className="w-4 h-4" />,
          badgeVariant: 'info' as const,
          bgColor: 'bg-blue-500/10 border-blue-500/20',
          textColor: 'text-blue-500',
        }
      case 'warn':
        return {
          icon: <AlertTriangle className="w-4 h-4" />,
          badgeVariant: 'warning' as const,
          bgColor: 'bg-yellow-500/10 border-yellow-500/20',
          textColor: 'text-yellow-500',
        }
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          badgeVariant: 'destructive' as const,
          bgColor: 'bg-destructive/10 border-destructive/20',
          textColor: 'text-destructive',
        }
    }
  }

  const config = getLevelConfig()

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${config.bgColor}`}>
      <div className={config.textColor}>{config.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant={config.badgeVariant} className="text-xs uppercase">
            {message.level}
          </Badge>
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">
          {message.content}
        </p>
      </div>
    </div>
  )
}
