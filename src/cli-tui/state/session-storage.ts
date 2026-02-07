/**
 * Session Storage for CLI-TUI
 *
 * Integrates MemoryManager for persistent session storage.
 * Provides session list management and current session operations.
 */

import { createMemoryManager, IMemoryManager } from '../../agent-v2/memory';
import type { Message } from '../types';
import type { Message as SessionMessage } from '../../agent-v2/session/types';

export interface SessionInfo {
  sessionId: string;
  title: string;
  lastMessageAt: number;
  messageCount: number;
}

export interface SessionStorage {
  memoryManager: IMemoryManager;
  currentSessionId: string | null;
  initialized: boolean;
}

// Default storage path
const DEFAULT_STORAGE_PATH = '.coding-agent/sessions';

/**
 * Initialize session storage with MemoryManager
 */
export async function initializeSessionStorage(
  storagePath: string = DEFAULT_STORAGE_PATH
): Promise<SessionStorage> {
  const memoryManager = createMemoryManager({
    type: 'file',
    connectionString: storagePath,
  });

  await memoryManager.initialize();

  return {
    memoryManager,
    currentSessionId: null,
    initialized: true,
  };
}

/**
 * Close session storage and cleanup resources
 */
export async function closeSessionStorage(storage: SessionStorage): Promise<void> {
  await storage.memoryManager.close();
  storage.initialized = false;
  storage.currentSessionId = null;
}

/**
 * List all available sessions
 */
export async function listSessions(storage: SessionStorage): Promise<SessionInfo[]> {
  const sessions = await storage.memoryManager.querySessions(
    { status: 'active' },
    { orderBy: 'updatedAt', orderDirection: 'desc' }
  );

  return sessions.map(session => ({
    sessionId: session.sessionId,
    title: session.title || `Session ${session.sessionId.slice(0, 8)}`,
    lastMessageAt: session.updatedAt,
    messageCount: session.totalMessages,
  }));
}

/**
 * Create a new session
 */
export async function createSession(
  storage: SessionStorage,
  systemPrompt: string,
  title?: string
): Promise<string> {
  const sessionId = await storage.memoryManager.createSession(undefined, systemPrompt);

  if (title) {
    await storage.memoryManager.updateSession(sessionId, { title });
  }

  storage.currentSessionId = sessionId;
  return sessionId;
}

/**
 * Load session messages from storage
 */
export async function loadSessionMessages(
  storage: SessionStorage,
  sessionId: string
): Promise<Message[]> {
  await sanitizeSessionMessagesForLLM(storage, sessionId);
  const context = await storage.memoryManager.getCurrentContext(sessionId);

  if (!context) {
    return [];
  }

  // Convert MemoryManager messages to UI messages
  return context.messages.map(msg => convertToUIMessage(msg));
}

/**
 * Save a message to current session
 */
export async function saveMessage(
  storage: SessionStorage,
  message: Message
): Promise<void> {
  if (!storage.currentSessionId) {
    throw new Error('No active session');
  }

  const memoryMessage = convertToMemoryMessage(message);
  await storage.memoryManager.addMessageToContext(
    storage.currentSessionId,
    memoryMessage,
    { addToHistory: true }
  );
}

/**
 * Update an existing message in the session
 */
export async function updateMessage(
  storage: SessionStorage,
  messageId: string,
  updates: Partial<Message>
): Promise<void> {
  if (!storage.currentSessionId) {
    throw new Error('No active session');
  }

  await storage.memoryManager.updateMessageInContext(
    storage.currentSessionId,
    messageId,
    convertToMemoryMessageUpdates(updates)
  );
}

/**
 * Delete a session
 */
export async function deleteSession(
  storage: SessionStorage,
  sessionId: string
): Promise<void> {
  await storage.memoryManager.deleteSession(sessionId);

  if (storage.currentSessionId === sessionId) {
    storage.currentSessionId = null;
  }
}

/**
 * Switch to a different session
 */
export async function switchSession(
  storage: SessionStorage,
  sessionId: string
): Promise<Message[]> {
  const session = await storage.memoryManager.getSession(sessionId);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  storage.currentSessionId = sessionId;
  return loadSessionMessages(storage, sessionId);
}

/**
 * Get or create a session for the current conversation
 */
export async function getOrCreateCurrentSession(
  storage: SessionStorage,
  systemPrompt: string
): Promise<string> {
  if (storage.currentSessionId) {
    const session = await storage.memoryManager.getSession(storage.currentSessionId);
    if (session) {
      await sanitizeSessionMessagesForLLM(storage, storage.currentSessionId);
      return storage.currentSessionId;
    }
  }

  // Create new session if none exists
  return createSession(storage, systemPrompt);
}

/**
 * 修复会话中的非法 system 角色消息：
 * - 仅保留第一条 system 消息
 * - 删除出现在中间或末尾的 system 消息（通常是 UI 错误提示误写入）
 */
export async function sanitizeSessionMessagesForLLM(
  storage: SessionStorage,
  sessionId: string
): Promise<boolean> {
  try {
    const context = await storage.memoryManager.getCurrentContext(sessionId);
    if (!context) return false;

    const original = context.messages;
    const cleaned: SessionMessage[] = [];

    for (const msg of original) {
      if (msg.role === 'system') {
        if (cleaned.length === 0) {
          cleaned.push(msg);
        }
        continue;
      }
      cleaned.push(msg);
    }

    if (cleaned.length === 0 || cleaned[0]?.role !== 'system') {
      cleaned.unshift({
        messageId: 'system',
        role: 'system',
        content: context.systemPrompt || '',
      });
    }

    const changed = JSON.stringify(cleaned) !== JSON.stringify(original);
    if (!changed) return false;

    await storage.memoryManager.saveCurrentContext({
      id: context.id,
      contextId: context.contextId,
      sessionId: context.sessionId,
      systemPrompt: context.systemPrompt,
      messages: cleaned,
      version: context.version + 1,
      lastCompactionId: context.lastCompactionId,
      stats: context.stats,
    });

    await storage.memoryManager.updateSession(sessionId, {
      totalMessages: cleaned.length,
    });

    return true;
  } catch (error) {
    console.warn(`Failed to sanitize session ${sessionId}:`, error);
    return false;
  }
}

// ==================== Message Conversion ====================

/**
 * Tool call structure from MemoryManager
 */
interface MemoryToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Convert MemoryManager Message to UI Message
 */
function convertToUIMessage(msg: import('../../agent-v2/session/types').Message): Message {
  const base: Message = {
    id: msg.messageId || (msg as { id?: string }).id || '',
    role: msg.role as 'user' | 'assistant' | 'system',
    content: messageContentToText(msg.content),
    timestamp: Date.now(), // MemoryManager doesn't store timestamp in Message
  };

  // Handle assistant messages with tool calls
  const toolCalls = (msg as { tool_calls?: MemoryToolCall[] }).tool_calls;
  if (msg.role === 'assistant' && toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
    base.toolCalls = toolCalls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || '{}'),
      status: 'pending' as const,
      startedAt: Date.now(),
    }));
  }

  // Handle tool result messages
  if (msg.role === 'tool') {
    base.role = 'assistant'; // Tool messages are displayed as assistant
    // Content is already set
  }

  return base;
}

function messageContentToText(content: import('../../agent-v2/session/types').Message['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text || '';
        case 'image_url':
          return `[image] ${part.image_url?.url || ''}`.trim();
        case 'file':
          return `[file] ${part.file?.filename || part.file?.file_id || ''}`.trim();
        case 'input_audio':
          return '[audio]';
        case 'input_video':
          return `[video] ${part.input_video?.url || part.input_video?.file_id || ''}`.trim();
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Convert UI Message to MemoryManager Message
 */
function convertToMemoryMessage(msg: Message): import('../../agent-v2/session/types').Message {
  const base: import('../../agent-v2/session/types').Message = {
    messageId: msg.id,
    role: msg.role,
    content: msg.content,
    type: 'text',
  };

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    base.type = 'tool-call';
    base.tool_calls = msg.toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.args),
      },
    }));
  }

  return base;
}

/**
 * Convert UI Message updates to MemoryManager format
 */
function convertToMemoryMessageUpdates(
  updates: Partial<Message>
): Partial<import('../../agent-v2/session/types').Message> {
  const result: Partial<import('../../agent-v2/session/types').Message> = {};

  if (updates.content !== undefined) {
    result.content = updates.content;
  }

  if (updates.role !== undefined) {
    result.role = updates.role;
  }

  return result;
}
