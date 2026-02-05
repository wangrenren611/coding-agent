/**
 * Web Chat Store Hook
 *
 * Adapter for the cli-v2 chat store to work with React 19
 */

import { useChatStore as useCliChatStore } from '../../../src/cli-v2/state/chat-store'
import type { ChatStore } from '../../../src/cli-v2/state/chat-store'

// Re-export the hook
export { useChatStore } from '../../../src/cli-v2/state/chat-store'

// Re-export types
export type { ChatStore } from '../../../src/cli-v2/state/chat-store'
