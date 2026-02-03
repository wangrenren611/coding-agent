'use client'

import { useState } from 'react'
import {
  Plus,
  MessageSquare,
  Trash2,
  Edit2,
  Check,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type Session } from '@/lib/types'
import { formatTimestamp, cn } from '@/lib/utils'
import { updateSession, deleteSession as deleteSessionStore } from '@/lib/sessions'

interface SessionListProps {
  sessions: Session[]
  currentSessionId: string
  onSessionChange: (id: string) => void
  onNewChat: () => void
  onRefresh: () => void
}

export function SessionList({
  sessions,
  currentSessionId,
  onSessionChange,
  onNewChat,
  onRefresh,
}: SessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const handleCreateSession = () => {
    onNewChat()
  }

  const handleStartEdit = (id: string, title: string) => {
    setEditingId(id)
    setEditTitle(title)
  }

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      updateSession(editingId, { title: editTitle.trim() })
      setEditingId(null)
      setEditTitle('')
      onRefresh()
    }
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
  }

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this conversation?')) {
      deleteSessionStore(id)
      onRefresh()
    }
  }

  return (
    <div className="flex flex-col h-full bg-muted/50 border-r border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <Button
          onClick={handleCreateSession}
          className="w-full justify-start"
          variant="default"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Session List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {sessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <MessageSquare className="mx-auto h-12 w-12 mb-2 opacity-50" />
              <p>No conversations yet</p>
              <p className="text-xs mt-1">Create a new chat to get started</p>
            </div>
          ) : (
            sessions.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === currentSessionId}
                isEditing={session.id === editingId}
                editTitle={editTitle}
                onEditTitleChange={setEditTitle}
                onSelect={() => onSessionChange(session.id)}
                onStartEdit={() => handleStartEdit(session.id, session.title)}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onDelete={(e) => handleDeleteSession(session.id, e)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface SessionItemProps {
  session: Session
  isActive: boolean
  isEditing: boolean
  editTitle: string
  onEditTitleChange: (title: string) => void
  onSelect: () => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: (e: React.MouseEvent) => void
}

function SessionItem({
  session,
  isActive,
  isEditing,
  editTitle,
  onEditTitleChange,
  onSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: SessionItemProps) {
  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-accent hover:text-accent-foreground'
      )}
      onClick={isEditing ? undefined : onSelect}
    >
      <MessageSquare className="h-4 w-4 shrink-0" />

      {isEditing ? (
        <div className="flex-1 flex items-center gap-1">
          <input
            type="text"
            value={editTitle}
            onChange={e => onEditTitleChange(e.target.value)}
            className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
          />
          <button
            className="h-6 w-6 flex items-center justify-center hover:bg-accent rounded"
            onClick={e => {
              e.stopPropagation()
              onSaveEdit()
            }}
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            className="h-6 w-6 flex items-center justify-center hover:bg-accent rounded"
            onClick={e => {
              e.stopPropagation()
              onCancelEdit()
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{session.title}</p>
            <p
              className={cn(
                'text-xs truncate',
                isActive
                  ? 'text-primary-foreground/70'
                  : 'text-muted-foreground'
              )}
            >
              {formatTimestamp(session.updatedAt)}
            </p>
          </div>

          <div
            className={cn(
              'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity',
              isActive && 'opacity-100'
            )}
          >
            <button
              className="h-7 w-7 flex items-center justify-center hover:bg-accent rounded"
              onClick={e => {
                e.stopPropagation()
                onStartEdit()
              }}
            >
              <Edit2 className="h-3 w-3" />
            </button>
            <button
              className="h-7 w-7 flex items-center justify-center hover:bg-accent text-destructive hover:text-destructive rounded"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
