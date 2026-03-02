import { z } from 'zod';
import { BaseTool, type ToolContext, type ToolResult } from '../tool/base';
import type { AgentRuntimeV3, DispatchPortV3, DispatchCommandV3, RunStatusSnapshotV3 } from './types';

const dispatchSchema = z.object({
    agentId: z.string().min(1).describe('Target agent id to execute task'),
    input: z.string().min(1).describe('Task input for target agent'),
    parentRunId: z
        .string()
        .optional()
        .describe('Optional parent run id; auto-resolved from current controller run if omitted'),
    timeoutMs: z.number().int().min(100).max(3_600_000).optional().describe('Optional timeout for child run'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata attached to child run'),
});

export class AgentDispatchTaskToolV3 extends BaseTool<typeof dispatchSchema> {
    name = 'agent_dispatch_task';
    description = 'Controller-only: dispatch a child task to another agent and create a child run.';
    schema = dispatchSchema;

    constructor(
        private readonly runtime: AgentRuntimeV3,
        private readonly port: DispatchPortV3
    ) {
        super();
    }

    async execute(args: z.infer<typeof dispatchSchema>, context?: ToolContext): Promise<ToolResult> {
        try {
            const callerAgentId = this.resolveCurrentAgentId(context);
            if (!this.port.isControllerAgent(callerAgentId)) {
                throw new Error(`agent_dispatch_task is controller-only: ${callerAgentId}`);
            }

            if (!this.port.hasAgent(args.agentId)) {
                throw new Error(`Unknown target agentId: ${args.agentId}`);
            }

            const parentRunId = args.parentRunId || (await this.resolveCurrentRunId(callerAgentId));
            const command: DispatchCommandV3 = {
                agentId: args.agentId,
                input: args.input,
                parentRunId,
                timeoutMs: args.timeoutMs,
                metadata: args.metadata,
            };

            const handle = await this.port.dispatch(command);
            return this.result({
                success: true,
                metadata: {
                    callerAgentId,
                    parentRunId: parentRunId || null,
                    childRunId: handle.runId,
                    childAgentId: handle.agentId,
                    childStatus: handle.status,
                },
                output: JSON.stringify(
                    {
                        callerAgentId,
                        parentRunId: parentRunId || null,
                        childRunId: handle.runId,
                        childAgentId: handle.agentId,
                        childStatus: handle.status,
                    },
                    null,
                    2
                ),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to dispatch child agent task',
            };
        }
    }

    private resolveCurrentAgentId(context?: ToolContext): string {
        const sessionId = context?.sessionId;
        if (!sessionId) {
            throw new Error('agent_dispatch_task requires sessionId in tool context');
        }
        const agentId = this.runtime.getAgentIdBySession(sessionId);
        if (!agentId) {
            throw new Error(`Cannot resolve agentId by sessionId: ${sessionId}`);
        }
        return agentId;
    }

    private async resolveCurrentRunId(agentId: string): Promise<string | undefined> {
        const running = await this.port.queryRuns({
            agentId,
            statuses: ['running'],
            limit: 1,
        });
        if (running[0]?.runId) {
            return running[0].runId;
        }

        const latest = await this.port.queryRuns({
            agentId,
            limit: 1,
        });
        return latest[0]?.runId;
    }
}

export type { DispatchPortV3, RunStatusSnapshotV3 };
