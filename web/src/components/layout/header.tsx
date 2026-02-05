'use client'

import { Bot, Menu, X, Trash2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

interface HeaderProps {
  onClear?: () => void
  onAbort?: () => void
}

export default function Header({ onClear, onAbort }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="h-14 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/20">
          <Bot className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-semibold text-sm">Agent V4</h1>
          <p className="text-xs text-muted-foreground hidden sm:block">AI Development Assistant</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Action Buttons */}
        <div className="hidden md:flex items-center gap-2">
          {onAbort && (
            <Button variant="outline" size="sm" onClick={onAbort}>
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          )}
          {onClear && (
            <Button variant="outline" size="sm" onClick={onClear}>
              <Trash2 className="w-4 h-4 mr-2" />
              Clear
            </Button>
          )}
        </div>

        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {mobileMenuOpen && (
        <div className="absolute top-14 left-0 right-0 bg-card border-b border-border md:hidden">
          <nav className="flex flex-col p-4 gap-2">
            {onAbort && (
              <Button variant="outline" size="sm" onClick={() => { onAbort(); setMobileMenuOpen(false) }}>
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            )}
            {onClear && (
              <Button variant="outline" size="sm" onClick={() => { onClear(); setMobileMenuOpen(false) }}>
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
