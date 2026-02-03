import { ChatContainer } from '@/components/chat/ChatContainer'
import { getSession, createSession } from '@/lib/sessions'

interface ChatPageProps {
  params: Promise<{
    sessionId: string
  }>
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { sessionId } = await params
  let session = getSession(sessionId)

  // If session doesn't exist, create it
  if (!session) {
    session = createSession({ id: sessionId, title: 'New Chat' })
  }

  return <ChatContainer />
}
