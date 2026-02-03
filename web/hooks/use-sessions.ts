'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  createSession,
  getAllSessions,
  deleteSession as deleteSessionStore,
  updateSession,
  type Session,
} from '@/lib/sessions'

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  // Load sessions on mount
  useEffect(() => {
    const loadSessions = () => {
      try {
        const loaded = getAllSessions()
        setSessions(loaded)

        // Set current session to the most recent one
        if (loaded.length > 0 && !currentSessionId) {
          setCurrentSessionId(loaded[0].id)
        }
      } catch (error) {
        console.error('Failed to load sessions:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadSessions()
  }, [])

  // Create a new session
  const createNewSession = useCallback((title?: string) => {
    const newSession = createSession({ title })
    setSessions(prev => [newSession, ...prev])
    setCurrentSessionId(newSession.id)
    return newSession
  }, [])

  // Delete a session
  const deleteSession = useCallback((id: string) => {
    const success = deleteSessionStore(id)
    if (success) {
      setSessions(prev => prev.filter(s => s.id !== id))

      // If we deleted the current session, switch to another one
      if (currentSessionId === id) {
        const remaining = sessions.filter(s => s.id !== id)
        setCurrentSessionId(remaining.length > 0 ? remaining[0].id : null)
      }
    }
    return success
  }, [currentSessionId, sessions])

  // Rename a session
  const renameSession = useCallback((id: string, title: string) => {
    const updated = updateSession(id, { title })
    if (updated) {
      setSessions(prev =>
        prev.map(s => (s.id === id ? updated : s))
      )
    }
    return updated
  }, [])

  // Refresh sessions from storage
  const refreshSessions = useCallback(() => {
    const loaded = getAllSessions()
    setSessions(loaded)
  }, [])

  // Get current session
  const getCurrentSession = useCallback(() => {
    if (!currentSessionId) return null
    return sessions.find(s => s.id === currentSessionId) || null
  }, [currentSessionId, sessions])

  return {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    getCurrentSession,
    createNewSession,
    deleteSession,
    renameSession,
    refreshSessions,
    isLoading,
  }
}
