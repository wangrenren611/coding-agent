import { NextRequest, NextResponse } from 'next/server'
import {
  getSession,
  deleteSession as deleteSessionStore,
} from '@/lib/sessions'
import { type GetSessionResponse, type DeleteSessionResponse } from '@/lib/types'

/**
 * GET /api/sessions/[id] - Get a session by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = getSession(params.id)

    const response: GetSessionResponse = { session }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error getting session:', error)
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/sessions/[id] - Delete a session
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const success = deleteSessionStore(params.id)

    const response: DeleteSessionResponse = { success }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error deleting session:', error)
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/sessions/[id] - Update a session (e.g., rename)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { updateSession } = await import('@/lib/sessions')

    const session = updateSession(params.id, body)

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    const response = { session }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error updating session:', error)
    return NextResponse.json(
      { error: 'Failed to update session' },
      { status: 500 }
    )
  }
}
