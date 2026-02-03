import {
  type CreateSessionOptions,
  type Message,
  type Session,
} from './types'
import { generateSessionTitle } from './utils'

// Simple UUID generator for client-side use
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ==================== In-Memory Session Storage ====================

// In production, this should be replaced with a database
class SessionStore {
  private sessions: Map<string, Session> = new Map()
  private storageKey = 'coding-agent-sessions'

  constructor() {
    if (typeof window !== 'undefined') {
      this.loadFromStorage()
    }
  }

  // ==================== Storage Management ====================

  private saveToStorage(): void {
    if (typeof window === 'undefined') return

    try {
      const sessionsArray = Array.from(this.sessions.values())
      localStorage.setItem(this.storageKey, JSON.stringify(sessionsArray))
    } catch (error) {
      console.error('Failed to save sessions to storage:', error)
    }
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') return

    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        const sessionsArray: Session[] = JSON.parse(stored)
        this.sessions.clear()
        sessionsArray.forEach(session => {
          this.sessions.set(session.id, session)
        })
      }
    } catch (error) {
      console.error('Failed to load sessions from storage:', error)
    }
  }

  // ==================== Session Operations ====================

  createSession(options: CreateSessionOptions = {}): Session {
    const id = options.id || uuidv4()
    const now = Date.now()

    const session: Session = {
      id,
      title: options.title || 'New Chat',
      createdAt: now,
      updatedAt: now,
      messages: [],
    }

    this.sessions.set(id, session)
    this.saveToStorage()

    return session
  }

  getSession(id: string): Session | null {
    return this.sessions.get(id) || null
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    )
  }

  updateSession(id: string, updates: Partial<Session>): Session | null {
    const session = this.sessions.get(id)
    if (!session) return null

    const updated = {
      ...session,
      ...updates,
      id, // Ensure id doesn't change
      updatedAt: Date.now(),
    }

    this.sessions.set(id, updated)
    this.saveToStorage()

    return updated
  }

  deleteSession(id: string): boolean {
    const result = this.sessions.delete(id)
    if (result) {
      this.saveToStorage()
    }
    return result
  }

  addMessage(sessionId: string, message: Message): Session | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    // Update title if this is the first user message
    let title = session.title
    if (
      session.messages.length === 0 &&
      message.role === 'user' &&
      title === 'New Chat'
    ) {
      title = generateSessionTitle(message.content)
    }

    const updated = {
      ...session,
      title,
      messages: [...session.messages, { ...message, timestamp: message.timestamp || Date.now() }],
      updatedAt: Date.now(),
    }

    this.sessions.set(sessionId, updated)
    this.saveToStorage()

    return updated
  }

  updateMessage(
    sessionId: string,
    messageId: string,
    updates: Partial<Message>
  ): Session | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    const messages = session.messages.map(msg =>
      msg.messageId === messageId ? { ...msg, ...updates } : msg
    )

    const updated = {
      ...session,
      messages,
      updatedAt: Date.now(),
    }

    this.sessions.set(sessionId, updated)
    this.saveToStorage()

    return updated
  }

  clear(): void {
    this.sessions.clear()
    this.saveToStorage()
  }
}

// ==================== Singleton Instance ====================

let sessionStoreInstance: SessionStore | null = null

export function getSessionStore(): SessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new SessionStore()
  }
  return sessionStoreInstance
}

// ==================== Convenience Functions ====================

export function createSession(options?: CreateSessionOptions): Session {
  return getSessionStore().createSession(options)
}

export function getSession(id: string): Session | null {
  return getSessionStore().getSession(id)
}

export function getAllSessions(): Session[] {
  return getSessionStore().getAllSessions()
}

export function updateSession(
  id: string,
  updates: Partial<Session>
): Session | null {
  return getSessionStore().updateSession(id, updates)
}

export function deleteSession(id: string): boolean {
  return getSessionStore().deleteSession(id)
}

export function addMessage(sessionId: string, message: Message): Session | null {
  return getSessionStore().addMessage(sessionId, message)
}

export function updateMessage(
  sessionId: string,
  messageId: string,
  updates: Partial<Message>
): Session | null {
  return getSessionStore().updateMessage(sessionId, messageId, updates)
}
