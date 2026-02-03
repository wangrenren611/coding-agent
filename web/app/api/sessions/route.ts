import { NextRequest, NextResponse } from 'next/server'
import {
  createSession,
  getAllSessions,
} from '@/lib/sessions'
import { type CreateSessionRequest, type ListSessionsResponse } from '@/lib/types'

/**
 * GET /api/sessions - List all sessions
 */
export async function GET() {
  try {
    const sessions = getAllSessions()

    const response: ListSessionsResponse = { sessions }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error listing sessions:', error)
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/sessions - Create a new session
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateSessionRequest = await request.json()
    const session = createSession({ title: body.title })

    const response = { session }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    console.error('Error creating session:', error)
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    )
  }
}
