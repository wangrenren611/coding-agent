import { NextRequest, NextResponse } from 'next/server'
import { executeAgentQuery, abortAgent } from '@/lib/agent'

/**
 * POST /api/chat - Send a message and get SSE stream
 */
export async function POST(request: NextRequest) {
  try {
    const { message, sessionId } = await request.json()

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: 'Message and sessionId are required' },
        { status: 400 }
      )
    }

    // Create a readable stream for SSE
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        const sendMessage = (data: unknown) => {
          const message = `data: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(message))
        }

        try {
          await executeAgentQuery(
            sessionId,
            message,
            {
              onEvent: (event) => {
                sendMessage(event)
              },
              onError: (error) => {
                sendMessage({
                  type: 'error',
                  payload: { error: error.message },
                  sessionId,
                  timestamp: Date.now(),
                })
              },
              onComplete: () => {
                sendMessage({
                  type: 'status',
                  payload: { state: 'completed', message: 'Task completed' },
                  sessionId,
                  timestamp: Date.now(),
                })
                controller.close()
              },
            }
          )
        } catch (error) {
          sendMessage({
            type: 'error',
            payload: { error: (error as Error).message },
            sessionId,
            timestamp: Date.now(),
          })
          controller.close()
        }
      },
      cancel() {
        // Abort the agent if client disconnects
        abortAgent(sessionId)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    console.error('Error in chat API:', error)
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chat - Stop ongoing generation
 */
export async function DELETE(request: NextRequest) {
  try {
    const { sessionId } = await request.json()

    if (!sessionId) {
      return NextResponse.json(
        { error: 'SessionId is required' },
        { status: 400 }
      )
    }

    abortAgent(sessionId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error stopping chat:', error)
    return NextResponse.json(
      { error: 'Failed to stop chat' },
      { status: 500 }
    )
  }
}
