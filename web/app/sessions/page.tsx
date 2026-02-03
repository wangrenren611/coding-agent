'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSession, getAllSessions } from '@/lib/sessions'
import { Button } from '@/components/ui/button'

export default function SessionsPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState(getAllSessions())
  const [isCreating, setIsCreating] = useState(false)

  // Redirect to first session if available
  useEffect(() => {
    if (sessions.length > 0) {
      router.push(`/chat/${sessions[0].id}`)
    }
  }, [sessions, router])

  const handleNewChat = () => {
    setIsCreating(true)
    const newSession = createSession()
    router.push(`/chat/${newSession.id}`)
  }

  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold mb-2">Coding Agent</h1>
        <p className="text-muted-foreground mb-8">
          AI-powered coding assistant to help you write, debug, and understand code.
        </p>

        <Button
          onClick={handleNewChat}
          disabled={isCreating}
          size="lg"
          className="w-full sm:w-auto"
        >
          {isCreating ? (
            <>
              <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Creating...
            </>
          ) : (
            <>
              <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Start New Chat
            </>
          )}
        </Button>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          <div className="p-4 rounded-lg border border-border bg-card">
            <h3 className="font-medium mb-1">Write Code</h3>
            <p className="text-xs text-muted-foreground">
              Generate code snippets, functions, and complete modules
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card">
            <h3 className="font-medium mb-1">Debug Issues</h3>
            <p className="text-xs text-muted-foreground">
              Analyze errors and find solutions to your bugs
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card">
            <h3 className="font-medium mb-1">Explain Code</h3>
            <p className="text-xs text-muted-foreground">
              Get detailed explanations of complex code logic
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
