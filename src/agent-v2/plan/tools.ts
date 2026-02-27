/**
 * Plan Module - Tools
 *
 * Plan 工具实现
 */

import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../tool/base';
import { planCreateSchema, isValidSessionId } from './types';
import { createPlanStorage, PlanStorageError } from './storage';

// ==================== 常量 ====================

const PLAN_CREATE_DESCRIPTION = `Create a new implementation plan in Markdown format.

Use this tool to:
- Plan complex multi-step implementation tasks
- Break down large features into manageable steps
- Document prerequisites, risks, and acceptance criteria

The plan will be saved as a Markdown document that can be read during execution.`;

// ==================== Plan Create Tool ====================

/**
 * plan_create 工具
 *
 * 在 Plan 模式下创建实现计划文档
 */
export class PlanCreateTool extends BaseTool<typeof planCreateSchema> {
    name = 'plan_create';
    description = PLAN_CREATE_DESCRIPTION;
    schema = planCreateSchema;

    async execute(
        args: z.infer<typeof this.schema>,
        context?: ToolContext
    ): Promise<ToolResult> {
        const sessionId = context?.sessionId;
        if (!sessionId) {
            return this.result({
                success: false,
                metadata: { error: 'NO_SESSION' },
                output: 'Session ID is required to create a plan',
            });
        }

        // 验证 sessionId 格式
        if (!isValidSessionId(sessionId)) {
            return this.result({
                success: false,
                metadata: { error: 'INVALID_SESSION_ID' },
                output: `Invalid session ID format: ${sessionId}`,
            });
        }

        const baseDir = context?.workingDirectory || process.cwd();
        const storage = createPlanStorage(baseDir);

        try {
            const meta = await storage.create({
                title: args.title,
                content: args.content,
                sessionId,
            });

            return this.result({
                success: true,
                metadata: {
                    id: meta.id,
                    sessionId: meta.sessionId,
                    title: meta.title,
                    filePath: meta.filePath,
                },
                output: `Plan created: "${meta.title}"\nSession: ${meta.sessionId}\nFile: ${meta.filePath}`,
            });
        } catch (error) {
            if (error instanceof PlanStorageError) {
                return this.result({
                    success: false,
                    metadata: { error: error.code },
                    output: `Failed to create plan: ${error.message}`,
                });
            }
            const err = error as Error;
            return this.result({
                success: false,
                metadata: { error: 'CREATE_FAILED' },
                output: `Failed to create plan: ${err.message}`,
            });
        }
    }
}
