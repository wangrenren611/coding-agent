/**
 * ============================================================================
 * Plan Module - Tools (简化版)
 * ============================================================================
 *
 * Plan 工具 - 只保留 plan_create，用于创建 Markdown 文档
 */

import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../tool/base';
import type { IMemoryManager } from '../memory/types';
import { planCreateSchema } from './types';
import { createPlanStorage } from './storage';

// ==================== 常量 ====================

const PLAN_CREATE_DESCRIPTION = `Create a new implementation plan in Markdown format.

Use this tool to:
- Plan complex multi-step implementation tasks
- Break down large features into manageable steps
- Document prerequisites, risks, and acceptance criteria

The plan will be saved as a Markdown document that can be read during execution.`;

// ==================== Plan Create Tool ====================

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

        const storage = createPlanStorage(
            context?.memoryManager as IMemoryManager | undefined,
            sessionId,
            context?.environment || process.cwd()
        );

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
                    title: meta.title,
                    filePath: meta.filePath,
                },
                output: `Plan created: "${meta.title}"\nFile: ${meta.filePath}`,
            });
        } catch (error) {
            const err = error as Error;
            return this.result({
                success: false,
                metadata: { error: 'CREATE_FAILED' },
                output: `Failed to create plan: ${err.message}`,
            });
        }
    }
}

// ==================== Exports ====================

/** 所有 Plan 工具 */
export const planTools = [PlanCreateTool];
