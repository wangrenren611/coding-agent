import type { AgentChatState, UIAssistantMessage } from './types';

export function selectLatestAssistantMessage(
    state: Pick<AgentChatState, 'messages' | 'latestAssistantMessageId'>
): UIAssistantMessage | null {
    const { latestAssistantMessageId, messages } = state;

    if (latestAssistantMessageId) {
        const hit = messages.find((message) => {
            return message.kind === 'assistant' && message.id === latestAssistantMessageId;
        });
        if (hit && hit.kind === 'assistant') return hit;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.kind === 'assistant') {
            return message;
        }
    }

    return null;
}
