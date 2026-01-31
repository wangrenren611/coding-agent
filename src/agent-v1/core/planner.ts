/**
 * Planner - 任务规划器
 *
 * 负责任务分解、步骤规划和依赖分析
 */

import type { LLMProvider } from '../../providers';
import type { LLMRequestMessage } from '../../providers/types';
import type {
    TaskPlan,
    Task,
    TaskStatus,
    ExecutionContext,
} from '../types';
import { ToolRegistry } from '../tools/registry';
import { v4 as uuidv4 } from 'uuid';

/**
 * 规划器配置
 */
export interface PlannerConfig {
    /** LLM Provider */
    provider: LLMProvider;
    /** 工具注册表 */
    toolRegistry: ToolRegistry;
}

/**
 * Planner - 任务规划器
 *
 * 使用 LLM 将复杂任务分解为可执行的子任务序列
 */
export class Planner {
    private config: PlannerConfig;

    constructor(config: PlannerConfig) {
        this.config = config;
    }

    /**
     * 创建任务计划
     */
    async createPlan(task: string, context: ExecutionContext): Promise<TaskPlan> {
        // 获取可用工具
        const availableTools = this.config.toolRegistry.getToolDescriptions();

        // 构建规划提示词
        const messages: LLMRequestMessage[] = [
            {
                role: 'system',
                content: this.getPlanningPrompt(availableTools),
            },
            {
                role: 'user',
                content: `Task: ${task}\n\nWorking directory: ${context.workingDirectory}\n\nPlease break this down into a step-by-step plan.`,
            },
        ];

        // 调用 LLM 生成计划
        const response = await this.config.provider.generate(messages);

        if (!response) {
            // 如果 LLM 没有响应，返回简单的单步计划
            return this.createSimplePlan(task);
        }

        // 解析 LLM 响应，提取任务列表
        const planText = response.choices[0].message.content || '';
        return this.parsePlanFromText(task, planText);
    }

    /**
     * 获取规划提示词
     */
    private getPlanningPrompt(availableTools: string): string {
        return `You are a task planning assistant. Your job is to break down complex tasks into clear, executable steps.

${availableTools}

When creating a plan:
1. Break the task into 3-7 clear, actionable steps
2. Each step should be specific and verifiable
3. Steps should be ordered logically with dependencies considered
4. Use the available tools when relevant

Respond with your plan in the following format:

## Plan Summary
[Brief description of the overall approach]

## Steps
1. [First step description]
   - Tool: (tool name if applicable)
   - Details: (any specific details)

2. [Second step description]
   ...

## Expected Outcome
[What the completed task should achieve]`;
    }

    /**
     * 从文本解析计划
     */
    private parsePlanFromText(task: string, planText: string): TaskPlan {
        const subtasks: Task[] = [];

        // 使用正则表达式提取步骤
        const stepRegex = /^\d+\.\s+\*\*(.+?)\*\*(?:\s*\n\s*- Tool:\s*(.+?))?(?:\s*\n\s*- Details:\s*(.+?))?(?=\n\d+\.|$)/gms;
        const matches = Array.from(planText.matchAll(stepRegex));

        if (matches.length === 0) {
            // 如果没有匹配到步骤，使用简单的文本分割
            return this.createSimplePlan(task);
        }

        let previousTaskId: string | null = null;

        for (const match of matches) {
            const description = match[1]?.trim() || 'Unnamed step';
            const toolName = match[2]?.trim();
            const details = match[3]?.trim();

            const task: Task = {
                id: uuidv4(),
                description: details ? `${description}\n${details}` : description,
                status: 'pending' as TaskStatus,
                subtaskIds: [],
                dependencies: previousTaskId ? [previousTaskId] : [],
                createdAt: new Date(),
            };

            // 如果指定了工具，记录在描述中
            if (toolName) {
                task.description = `[Using: ${toolName}] ${task.description}`;
            }

            subtasks.push(task);
            previousTaskId = task.id;
        }

        // 创建主任务
        const mainTask: Task = {
            id: uuidv4(),
            description: task,
            status: 'pending' as TaskStatus,
            subtaskIds: subtasks.map(t => t.id),
            dependencies: [],
            createdAt: new Date(),
        };

        // 构建执行顺序
        const executionOrder = subtasks.map(t => t.id);

        return {
            mainTask,
            subtasks,
            executionOrder,
        };
    }

    /**
     * 创建简单计划（回退方案）
     */
    private createSimplePlan(task: string): TaskPlan {
        const subtask: Task = {
            id: uuidv4(),
            description: `Complete the task: ${task}`,
            status: 'pending' as TaskStatus,
            subtaskIds: [],
            dependencies: [],
            createdAt: new Date(),
        };

        const mainTask: Task = {
            id: uuidv4(),
            description: task,
            status: 'pending' as TaskStatus,
            subtaskIds: [subtask.id],
            dependencies: [],
            createdAt: new Date(),
        };

        return {
            mainTask,
            subtasks: [subtask],
            executionOrder: [subtask.id],
        };
    }

    /**
     * 更新计划（基于执行进度）
     */
    updatePlan(
        plan: TaskPlan,
        completedTaskIds: string[],
        failedTaskIds: string[]
    ): TaskPlan {
        // 标记完成的任务
        for (const taskId of completedTaskIds) {
            const task = this.findTask(plan, taskId);
            if (task) {
                task.status = 'completed' as TaskStatus;
                task.completedAt = new Date();
            }
        }

        // 标记失败的任务
        for (const taskId of failedTaskIds) {
            const task = this.findTask(plan, taskId);
            if (task) {
                task.status = 'failed' as TaskStatus;
            }
        }

        // 更新执行顺序，跳过被阻塞的任务
        const updatedExecutionOrder = plan.executionOrder.filter(taskId => {
            const task = this.findTask(plan, taskId);
            if (!task) return false;

            // 检查依赖是否满足
            const dependenciesMet = task.dependencies.every(depId =>
                completedTaskIds.includes(depId)
            );

            return dependenciesMet && task.status !== 'completed';
        });

        return {
            ...plan,
            executionOrder: updatedExecutionOrder,
        };
    }

    /**
     * 查找任务
     */
    private findTask(plan: TaskPlan, taskId: string): Task | undefined {
        if (plan.mainTask.id === taskId) return plan.mainTask;
        return plan.subtasks.find(t => t.id === taskId);
    }
}
