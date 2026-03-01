import { z } from 'zod';
import { BaseTool, type ToolContext, type ToolResult } from '../tool/base';
import type { InterAgentMessage, StateStore } from './types';

const sendSchema = z.object({
    toAgentId: z.string().min(1).describe('Target agent id'),
    payload: z.record(z.string(), z.unknown()).describe('Message payload object'),
    topic: z.string().optional().describe('Optional message topic for policy and routing'),
    idempotencyKey: z.string().optional().describe('Optional idempotency key for deduplication'),
    correlationId: z.string().optional().describe('Optional correlation id'),
    runId: z.string().optional().describe('Optional run id for traceability'),
});

const receiveSchema = z.object({
    limit: z.number().int().min(1).max(100).optional().describe('Max number of messages to receive'),
    leaseMs: z.number().int().min(100).max(300000).optional().describe('Lease duration in milliseconds'),
});

const ackSchema = z.object({
    messageIds: z.array(z.string().min(1)).min(1).max(100).describe('Message ids to acknowledge'),
});

const nackSchema = z.object({
    messageId: z.string().min(1).describe('Message id to negative-acknowledge'),
    error: z.string().optional().describe('Reason for nack'),
    requeueDelayMs: z.number().int().min(0).max(300000).optional().describe('Delay before requeue'),
});

const listDeadSchema = z.object({
    limit: z.number().int().min(1).max(100).optional().describe('Max dead letters to list'),
});

const requeueDeadSchema = z.object({
    messageId: z.string().min(1).describe('Dead-letter message id'),
    delayMs: z.number().int().min(0).max(300000).optional().describe('Delay before moving back to queue'),
    resetAttempts: z.boolean().optional().describe('Whether to reset attempt counter to 0'),
});

export interface AgentMessagingPort {
    sendMessage(message: Omit<InterAgentMessage, 'messageId' | 'timestamp'>): InterAgentMessage;
    receiveMailbox(agentId: string, options?: { limit?: number; leaseMs?: number }): InterAgentMessage[];
    ackMailboxMessage(agentId: string, messageId: string): boolean;
    nackMailboxMessage(
        agentId: string,
        messageId: string,
        options?: { error?: string; requeueDelayMs?: number }
    ): { requeued: boolean; deadLettered: boolean; message?: InterAgentMessage };
    listDeadLetters(agentId: string, limit?: number): InterAgentMessage[];
    requeueDeadLetter(
        agentId: string,
        messageId: string,
        options?: { delayMs?: number; resetAttempts?: boolean }
    ): boolean;
}

abstract class BaseAgentMessagingTool<T extends z.ZodType> extends BaseTool<T> {
    protected readonly stateStore: StateStore;

    constructor(stateStore: StateStore) {
        super();
        this.stateStore = stateStore;
    }

    protected resolveCurrentAgentId(context?: ToolContext): string {
        const sessionId = context?.sessionId;
        if (!sessionId) {
            throw new Error('agent messaging requires sessionId in tool context');
        }

        const agentId = this.stateStore.getAgentIdBySession(sessionId);
        if (!agentId) {
            throw new Error(`agent messaging cannot resolve agent by sessionId: ${sessionId}`);
        }
        return agentId;
    }
}

export class AgentSendMessageTool extends BaseAgentMessagingTool<typeof sendSchema> {
    name = 'agent_send_message';
    description =
        'Send a structured message from current agent to another agent. Use this for inter-agent coordination.';
    schema = sendSchema;
    private readonly port: AgentMessagingPort;

    constructor(stateStore: StateStore, port: AgentMessagingPort) {
        super(stateStore);
        this.port = port;
    }

    execute(args: z.infer<typeof sendSchema>, context?: ToolContext): ToolResult {
        try {
            const fromAgentId = this.resolveCurrentAgentId(context);
            const sent = this.port.sendMessage({
                fromAgentId,
                toAgentId: args.toAgentId,
                payload: args.payload,
                topic: args.topic,
                idempotencyKey: args.idempotencyKey,
                correlationId: args.correlationId,
                runId: args.runId,
            });
            return this.result({
                success: true,
                metadata: sent,
                output: `Message sent from ${fromAgentId} to ${args.toAgentId} (${sent.messageId})`,
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to send inter-agent message',
            };
        }
    }
}

export class AgentReceiveMessagesTool extends BaseAgentMessagingTool<typeof receiveSchema> {
    name = 'agent_receive_messages';
    description =
        'Receive pending mailbox messages for current agent. Use this before planning next action with other agents.';
    schema = receiveSchema;
    private readonly port: AgentMessagingPort;

    constructor(stateStore: StateStore, port: AgentMessagingPort) {
        super(stateStore);
        this.port = port;
    }

    execute(args: z.infer<typeof receiveSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const messages = this.port.receiveMailbox(agentId, {
                limit: args.limit,
                leaseMs: args.leaseMs,
            });
            return this.result({
                success: true,
                metadata: {
                    agentId,
                    count: messages.length,
                    messages,
                },
                output: JSON.stringify(
                    {
                        agentId,
                        count: messages.length,
                        messages,
                    },
                    null,
                    2
                ),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to receive inter-agent messages',
            };
        }
    }
}

export class AgentAckMessagesTool extends BaseAgentMessagingTool<typeof ackSchema> {
    name = 'agent_ack_messages';
    description = 'Acknowledge one or more mailbox messages after successful processing.';
    schema = ackSchema;
    private readonly port: AgentMessagingPort;

    constructor(stateStore: StateStore, port: AgentMessagingPort) {
        super(stateStore);
        this.port = port;
    }

    execute(args: z.infer<typeof ackSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const acked: string[] = [];
            const notFound: string[] = [];
            for (const messageId of args.messageIds) {
                if (this.port.ackMailboxMessage(agentId, messageId)) {
                    acked.push(messageId);
                } else {
                    notFound.push(messageId);
                }
            }
            return this.result({
                success: true,
                metadata: {
                    agentId,
                    acked,
                    notFound,
                },
                output: JSON.stringify({ agentId, acked, notFound }, null, 2),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to ack mailbox messages',
            };
        }
    }
}

export class AgentNackMessageTool extends BaseAgentMessagingTool<typeof nackSchema> {
    name = 'agent_nack_message';
    description = 'Negative-ack a mailbox message to trigger retry or dead-letter handling.';
    schema = nackSchema;
    private readonly port: AgentMessagingPort;

    constructor(stateStore: StateStore, port: AgentMessagingPort) {
        super(stateStore);
        this.port = port;
    }

    execute(args: z.infer<typeof nackSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const result = this.port.nackMailboxMessage(agentId, args.messageId, {
                error: args.error,
                requeueDelayMs: args.requeueDelayMs,
            });
            return this.result({
                success: true,
                metadata: {
                    agentId,
                    ...result,
                },
                output: JSON.stringify({ agentId, ...result }, null, 2),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to nack mailbox message',
            };
        }
    }
}

export class AgentListDeadLettersTool extends BaseAgentMessagingTool<typeof listDeadSchema> {
    name = 'agent_list_dead_letters';
    description = 'List dead-letter messages for the current agent.';
    schema = listDeadSchema;
    private readonly port: AgentMessagingPort;

    constructor(stateStore: StateStore, port: AgentMessagingPort) {
        super(stateStore);
        this.port = port;
    }

    execute(args: z.infer<typeof listDeadSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const messages = this.port.listDeadLetters(agentId, args.limit);
            return this.result({
                success: true,
                metadata: {
                    agentId,
                    count: messages.length,
                    messages,
                },
                output: JSON.stringify({ agentId, count: messages.length, messages }, null, 2),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to list dead letters',
            };
        }
    }
}

export class AgentRequeueDeadLetterTool extends BaseAgentMessagingTool<typeof requeueDeadSchema> {
    name = 'agent_requeue_dead_letter';
    description = 'Move a dead-letter message back to queue for retry.';
    schema = requeueDeadSchema;
    private readonly port: AgentMessagingPort;

    constructor(stateStore: StateStore, port: AgentMessagingPort) {
        super(stateStore);
        this.port = port;
    }

    execute(args: z.infer<typeof requeueDeadSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const requeued = this.port.requeueDeadLetter(agentId, args.messageId, {
                delayMs: args.delayMs,
                resetAttempts: args.resetAttempts,
            });
            return this.result({
                success: true,
                metadata: {
                    agentId,
                    requeued,
                },
                output: JSON.stringify({ agentId, requeued }, null, 2),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to requeue dead-letter message',
            };
        }
    }
}
