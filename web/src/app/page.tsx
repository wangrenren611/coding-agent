'use client'

import ChatContainer from '@/components/chat/chat-container'
import Header from '@/components/layout/header'
import StatusBar from '@/components/layout/status-bar'
import { useChatStore } from '@/hooks/use-chat-store'
import { useAgentApi } from '@/hooks/use-agent-api'

export default function Home() {
  const { messages, executionState, statusMessage, isLoading, addUserMessage, applyEvent, setExecutionState, clearMessages } = useChatStore()

  // 创建 API hook
  const { sendMessage, abort, clearSession } = useAgentApi({
    onEvent: (event) => {
      applyEvent(event)
    },
    onError: (error) => {
      setExecutionState('error', error)
    },
    onComplete: () => {
      setExecutionState('completed', 'Response completed')
    },
  })

  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return

    // 添加用户消息
    addUserMessage(content)

    // 设置 Agent 状态为思考中
    setExecutionState('thinking', 'Agent is thinking...')

    // 发送消息到 Agent API
    await sendMessage(content)
  }

  const handleAbort = () => {
    abort()
    setExecutionState('idle', 'Request aborted')
  }

  const handleClear = async () => {
    clearMessages()
    await clearSession()
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <Header onClear={handleClear} onAbort={isLoading ? handleAbort : undefined} />

      <div className="flex flex-1 overflow-hidden">
        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <ChatContainer
            messages={messages}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
          />
        </main>

        {/* Status Sidebar */}
        <aside className="w-80 border-l border-border bg-card/50 flex flex-col">
          <StatusBar
            executionState={executionState}
            statusMessage={statusMessage}
            messages={messages}
          />
        </aside>
      </div>
    </div>
  )
}
