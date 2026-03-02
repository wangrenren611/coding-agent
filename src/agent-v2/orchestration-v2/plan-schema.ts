import { z } from 'zod';
import type { GoalPlanV2 } from './types';

const TaskSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    role: z.string().min(1),
    description: z.string().min(1),
    dependsOn: z.array(z.string()).default([]),
    acceptanceCriteria: z.array(z.string()).default([]),
});

const PlanSchema = z.object({
    summary: z.string().min(1),
    tasks: z.array(TaskSchema).min(1),
});

function extractJsonCandidate(raw: string): string {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
        return fenced[1].trim();
    }

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return raw.slice(firstBrace, lastBrace + 1);
    }

    return raw.trim();
}

export function parsePlan(raw: string): GoalPlanV2 {
    const candidate = extractJsonCandidate(raw);
    const parsed = JSON.parse(candidate);
    const validated = PlanSchema.parse(parsed);
    const normalized = normalizePlan(validated);
    validateDag(normalized);
    return normalized;
}

export function planSchemaText(): string {
    return JSON.stringify(
        {
            summary: 'string',
            tasks: [
                {
                    id: 'string(unique)',
                    title: 'string',
                    role: 'string',
                    description: 'string',
                    dependsOn: ['task-id'],
                    acceptanceCriteria: ['string'],
                },
            ],
        },
        null,
        2
    );
}

function normalizePlan(plan: GoalPlanV2): GoalPlanV2 {
    const usedIds = new Set<string>();

    const tasks = plan.tasks.map((task, index) => {
        const base = task.id.trim() || `task-${index + 1}`;
        let id = base;
        let suffix = 1;
        while (usedIds.has(id)) {
            suffix += 1;
            id = `${base}-${suffix}`;
        }
        usedIds.add(id);

        const dependsOn = Array.from(
            new Set(task.dependsOn.map((dep) => dep.trim()).filter((dep) => dep.length > 0 && dep !== id))
        );

        return {
            ...task,
            id,
            title: task.title.trim(),
            role: task.role.trim(),
            description: task.description.trim(),
            dependsOn,
            acceptanceCriteria: task.acceptanceCriteria.map((item) => item.trim()).filter((item) => item.length > 0),
        };
    });

    const taskIds = new Set(tasks.map((task) => task.id));
    const filtered = tasks.map((task) => ({
        ...task,
        dependsOn: task.dependsOn.filter((dep) => taskIds.has(dep)),
    }));

    return {
        summary: plan.summary.trim(),
        tasks: filtered,
    };
}

function validateDag(plan: GoalPlanV2): void {
    const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (taskId: string) => {
        if (visited.has(taskId)) return;
        if (visiting.has(taskId)) {
            throw new Error(`Plan has circular dependency at task: ${taskId}`);
        }

        visiting.add(taskId);
        const task = tasks.get(taskId);
        if (!task) {
            throw new Error(`Plan references unknown task: ${taskId}`);
        }

        for (const dep of task.dependsOn) {
            if (!tasks.has(dep)) {
                throw new Error(`Plan dependency not found: ${dep} (required by ${taskId})`);
            }
            dfs(dep);
        }

        visiting.delete(taskId);
        visited.add(taskId);
    };

    for (const task of plan.tasks) {
        dfs(task.id);
    }
}
