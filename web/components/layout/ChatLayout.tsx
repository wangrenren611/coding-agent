'use client'

import { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ui/theme-toggle'

interface ChatLayoutProps {
  children: ReactNode
  title?: string
  actions?: ReactNode
}

export function ChatLayout({ children, title, actions }: ChatLayoutProps) {
  return (
    <div className="flex h-screen">
      {/* Sidebar - Session List */}
      <div className="w-64 shrink-0 border-r border-border">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground/80">
            Conversations
          </h2>
        </div>
        <div id="session-list-container">
          {/* SessionList will be rendered here */}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            {title && (
              <h1 className="text-lg font-semibold truncate">{title}</h1>
            )}
          </div>

          <div className="flex items-center gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
