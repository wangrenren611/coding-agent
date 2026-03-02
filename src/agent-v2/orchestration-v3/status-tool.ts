import { z } from 'zod';
import { BaseTool, type ToolContext, type ToolResult } from '../tool/base';
import type { AgentRuntimeV3, RunStatusQueryV3, StatusPortV3 } from './types';

const statusSchema = z.object({
    runId: z.string().optional().describe('Optional run id'),
    agentId: z.string().optional().describe('Optional agent id filter'),
    parentRunId: z.string().optional().describe('Optional parent run id filter'),
    statuses: z
        .array(z.enum(['queued', 'running', 'completed', 'failed', 'aborted', 'cancelled']))
        .optional()
        .describe('Optional status filter'),
    limit: z.number().int().min(1).max(200).optional().describe('Max rows to return'),
});

export class AgentGetStatusToolV3 extends BaseTool<typeof statusSchema> {
    name = 'agent_get_status';
    description = 'Get current execution status of child agents and runs.';
    schema = statusSchema;

    private readonly runtime: AgentRuntimeV3;
    private readonly port: StatusPortV3;

    constructor(runtime: AgentRuntimeV3, port: StatusPortV3) {
        super();
        this.runtime = runtime;
        this.port = port;
    }

    async execute(args: z.infer<typeof statusSchema>, context?: ToolContext): Promise<ToolResult> {
        try {
            const requester = this.resolveCurrentAgentId(context);
            const requesterRole = this.port.getAgentRole(requester)?.trim().toLowerCase();

            const query: RunStatusQueryV3 = {
                runId: args.runId,
                agentId: args.agentId,
                parentRunId: args.parentRunId,
                statuses: args.statuses,
                limit: args.limit,
            };

            if (!query.runId && !query.agentId && !query.parentRunId) {
                if (requesterRole === 'controller') {
                    query.parentAgentId = requester;
                } else {
                    query.agentId = requester;
                }
            }

            const runs = await this.port.queryRuns(query);
            const summary: Record<string, number> = {};
            for (const run of runs) {
                summary[run.status] = (summary[run.status] || 0) + 1;
            }

            return this.result({
                success: true,
                metadata: {
                    requesterAgentId: requester,
                    count: runs.length,
                    summary,
                    runs,
                },
                output: JSON.stringify(
                    {
                        requesterAgentId: requester,
                        count: runs.length,
                        summary,
                        runs,
                    },
                    null,
                    2
                ),
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                output: 'Failed to get agent status',
            };
        }
    }

    private resolveCurrentAgentId(context?: ToolContext): string {
        const sessionId = context?.sessionId;
        if (!sessionId) {
            throw new Error('agent_get_status requires sessionId in tool context');
        }
        const agentId = this.runtime.getAgentIdBySession(sessionId);
        if (!agentId) {
            throw new Error(`Cannot resolve agentId by sessionId: ${sessionId}`);
        }
        return agentId;
    }
}
