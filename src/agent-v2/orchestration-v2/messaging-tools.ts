import { z } from 'zod';
import { BaseTool, type ToolContext, type ToolResult } from '../tool/base';
import type {
    AgentRuntimeV2,
    InterAgentMessageV2,
    NackMessageOptionsV2,
    NackMessageResultV2,
    ReceiveMessageOptionsV2,
} from './types';

const sendSchema = z.object({
    toAgentId: z.string().min(1).describe('Target agent id'),
    payload: z.record(z.string(), z.unknown()).describe('Message payload object'),
    topic: z.string().optional().describe('Optional message topic'),
    idempotencyKey: z.string().optional().describe('Optional idempotency key'),
    correlationId: z.string().optional().describe('Optional correlation id'),
    runId: z.string().optional().describe('Optional run id for tracing'),
    maxAttempts: z.number().int().min(1).max(10).optional().describe('Max retry attempts before dead-letter'),
});

const receiveSchema = z.object({
    limit: z.number().int().min(1).max(100).optional().describe('Max number of messages to receive'),
    leaseMs: z.number().int().min(100).max(300000).optional().describe('Lease duration for in-flight messages'),
});

const ackSchema = z.object({
    messageIds: z.array(z.string().min(1)).min(1).max(100).describe('Message ids to acknowledge'),
});

const nackSchema = z.object({
    messageId: z.string().min(1).describe('Message id to nack'),
    error: z.string().optional().describe('Nack reason'),
    requeueDelayMs: z.number().int().min(0).max(300000).optional().describe('Delay before requeue'),
});

const deadLetterSchema = z.object({
    limit: z.number().int().min(1).max(100).optional().describe('Max dead letters to return'),
});

export interface MessagingPortV2 {
    sendMessage(message: Omit<InterAgentMessageV2, 'messageId' | 'timestamp'>): InterAgentMessageV2;
    receiveMessages(agentId: string, options?: ReceiveMessageOptionsV2): InterAgentMessageV2[];
    ackMessage(agentId: string, messageId: string): boolean;
    nackMessage(agentId: string, messageId: string, options?: NackMessageOptionsV2): NackMessageResultV2;
    listDeadLetters(agentId: string, limit?: number): InterAgentMessageV2[];
}

abstract class BaseMessagingToolV2<T extends z.ZodType> extends BaseTool<T> {
    protected readonly runtime: AgentRuntimeV2;

    constructor(runtime: AgentRuntimeV2) {
        super();
        this.runtime = runtime;
    }

    protected resolveCurrentAgentId(context?: ToolContext): string {
        const sessionId = context?.sessionId;
        if (!sessionId) {
            throw new Error('Messaging tools require sessionId in tool context');
        }

        const agentId = this.runtime.getAgentIdBySession(sessionId);
        if (!agentId) {
            throw new Error(`Cannot resolve agentId by sessionId: ${sessionId}`);
        }

        return agentId;
    }
}

export class AgentSendMessageToolV2 extends BaseMessagingToolV2<typeof sendSchema> {
    name = 'agent_send_message';
    description = 'Send a structured message to another agent for collaboration.';
    schema = sendSchema;
    private readonly port: MessagingPortV2;

    constructor(runtime: AgentRuntimeV2, port: MessagingPortV2) {
        super(runtime);
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
                maxAttempts: args.maxAttempts,
            });
            return this.result({
                success: true,
                metadata: sent,
                output: `Message sent (${sent.messageId}) from ${fromAgentId} to ${args.toAgentId}`,
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

export class AgentReceiveMessagesToolV2 extends BaseMessagingToolV2<typeof receiveSchema> {
    name = 'agent_receive_messages';
    description = 'Receive pending mailbox messages for current agent.';
    schema = receiveSchema;
    private readonly port: MessagingPortV2;

    constructor(runtime: AgentRuntimeV2, port: MessagingPortV2) {
        super(runtime);
        this.port = port;
    }

    execute(args: z.infer<typeof receiveSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const messages = this.port.receiveMessages(agentId, {
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
                output: 'Failed to receive mailbox messages',
            };
        }
    }
}

export class AgentAckMessagesToolV2 extends BaseMessagingToolV2<typeof ackSchema> {
    name = 'agent_ack_messages';
    description = 'Acknowledge one or more received messages.';
    schema = ackSchema;
    private readonly port: MessagingPortV2;

    constructor(runtime: AgentRuntimeV2, port: MessagingPortV2) {
        super(runtime);
        this.port = port;
    }

    execute(args: z.infer<typeof ackSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const acked: string[] = [];
            const missing: string[] = [];
            for (const messageId of args.messageIds) {
                if (this.port.ackMessage(agentId, messageId)) {
                    acked.push(messageId);
                } else {
                    missing.push(messageId);
                }
            }

            return this.result({
                success: true,
                metadata: {
                    agentId,
                    acked,
                    missing,
                },
                output: JSON.stringify({ agentId, acked, missing }, null, 2),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to ack messages',
            };
        }
    }
}

export class AgentNackMessageToolV2 extends BaseMessagingToolV2<typeof nackSchema> {
    name = 'agent_nack_message';
    description = 'Nack a received message and trigger retry/dead-letter flow.';
    schema = nackSchema;
    private readonly port: MessagingPortV2;

    constructor(runtime: AgentRuntimeV2, port: MessagingPortV2) {
        super(runtime);
        this.port = port;
    }

    execute(args: z.infer<typeof nackSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const result = this.port.nackMessage(agentId, args.messageId, {
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
                output: 'Failed to nack message',
            };
        }
    }
}

export class AgentListDeadLettersToolV2 extends BaseMessagingToolV2<typeof deadLetterSchema> {
    name = 'agent_list_dead_letters';
    description = 'List dead-letter messages for current agent.';
    schema = deadLetterSchema;
    private readonly port: MessagingPortV2;

    constructor(runtime: AgentRuntimeV2, port: MessagingPortV2) {
        super(runtime);
        this.port = port;
    }

    execute(args: z.infer<typeof deadLetterSchema>, context?: ToolContext): ToolResult {
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
