import { z } from 'zod';
import { BaseTool, type ToolContext, type ToolResult } from '../tool/base';
import type {
    AgentRuntimeV3,
    InterAgentMessageV3,
    MessagingPortV3,
    NackMessageOptionsV3,
    NackMessageResultV3,
    ReceiveMessageOptionsV3,
    WaitForMessagesOptionsV3,
    WaitForMessagesResultV3,
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

const waitSchema = z.object({
    limit: z.number().int().min(1).max(100).optional().describe('Max number of messages to receive'),
    leaseMs: z.number().int().min(100).max(300000).optional().describe('Lease duration for in-flight messages'),
    waitMs: z.number().int().min(0).max(300000).optional().describe('How long to wait for new messages'),
    pollIntervalMs: z.number().int().min(20).max(5000).optional().describe('Polling interval while waiting'),
    parentRunId: z.string().optional().describe('Optional parent run id for timeout progress check'),
    includeChildProgressOnTimeout: z
        .boolean()
        .optional()
        .describe('When timed out, include child run progress snapshot'),
});

abstract class BaseMessagingToolV3<T extends z.ZodType> extends BaseTool<T> {
    protected readonly runtime: AgentRuntimeV3;

    constructor(runtime: AgentRuntimeV3) {
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

export class AgentSendMessageToolV3 extends BaseMessagingToolV3<typeof sendSchema> {
    name = 'agent_send_message';
    description = 'Send a structured message to another agent for collaboration.';
    schema = sendSchema;

    constructor(
        runtime: AgentRuntimeV3,
        private readonly port: MessagingPortV3
    ) {
        super(runtime);
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

export class AgentReceiveMessagesToolV3 extends BaseMessagingToolV3<typeof receiveSchema> {
    name = 'agent_receive_messages';
    description = 'Receive pending mailbox messages for current agent.';
    schema = receiveSchema;

    constructor(
        runtime: AgentRuntimeV3,
        private readonly port: MessagingPortV3
    ) {
        super(runtime);
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
                metadata: { agentId, count: messages.length, messages },
                output: JSON.stringify({ agentId, count: messages.length, messages }, null, 2),
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

export class AgentAckMessagesToolV3 extends BaseMessagingToolV3<typeof ackSchema> {
    name = 'agent_ack_messages';
    description = 'Acknowledge one or more received messages.';
    schema = ackSchema;

    constructor(
        runtime: AgentRuntimeV3,
        private readonly port: MessagingPortV3
    ) {
        super(runtime);
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
                metadata: { agentId, acked, missing },
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

export class AgentNackMessageToolV3 extends BaseMessagingToolV3<typeof nackSchema> {
    name = 'agent_nack_message';
    description = 'Nack a received message and trigger retry/dead-letter flow.';
    schema = nackSchema;

    constructor(
        runtime: AgentRuntimeV3,
        private readonly port: MessagingPortV3
    ) {
        super(runtime);
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
                metadata: { agentId, ...result },
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

export class AgentListDeadLettersToolV3 extends BaseMessagingToolV3<typeof deadLetterSchema> {
    name = 'agent_list_dead_letters';
    description = 'List dead-letter messages for current agent.';
    schema = deadLetterSchema;

    constructor(
        runtime: AgentRuntimeV3,
        private readonly port: MessagingPortV3
    ) {
        super(runtime);
    }

    execute(args: z.infer<typeof deadLetterSchema>, context?: ToolContext): ToolResult {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const messages = this.port.listDeadLetters(agentId, args.limit);
            return this.result({
                success: true,
                metadata: { agentId, count: messages.length, messages },
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

export class AgentWaitForMessagesToolV3 extends BaseMessagingToolV3<typeof waitSchema> {
    name = 'agent_wait_for_messages';
    description = 'Wait for mailbox messages; on timeout optionally return child run progress for supervision loops.';
    schema = waitSchema;

    constructor(
        runtime: AgentRuntimeV3,
        private readonly port: MessagingPortV3
    ) {
        super(runtime);
    }

    async execute(args: z.infer<typeof waitSchema>, context?: ToolContext): Promise<ToolResult> {
        try {
            const agentId = this.resolveCurrentAgentId(context);
            const result = await this.port.waitForMessages(agentId, {
                limit: args.limit,
                leaseMs: args.leaseMs,
                waitMs: args.waitMs,
                pollIntervalMs: args.pollIntervalMs,
                parentRunId: args.parentRunId,
                includeChildProgressOnTimeout: args.includeChildProgressOnTimeout,
            });
            return this.result({
                success: true,
                metadata: {
                    agentId,
                    ...result,
                },
                output: JSON.stringify(
                    {
                        agentId,
                        ...result,
                    },
                    null,
                    2
                ),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to wait for mailbox messages',
            };
        }
    }
}

export type {
    InterAgentMessageV3,
    ReceiveMessageOptionsV3,
    WaitForMessagesOptionsV3,
    WaitForMessagesResultV3,
    NackMessageOptionsV3,
    NackMessageResultV3,
    MessagingPortV3,
};
