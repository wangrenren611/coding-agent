import z from 'zod';
import { BaseTool, ToolResult } from './base';
import { DESCRIPTION_WRITE } from './todowrite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ToolRegistry } from './registry';

const Status = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
const Priority = z.enum(['high', 'medium', 'low']);

const TodoInfo = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(200),
  status: Status.default('pending'),
  priority: Priority.default('medium'),
}).strict();

type TodoItem = z.infer<typeof TodoInfo>;

let todoList: TodoItem[] = [];
const todoCache = new Map<string, TodoItem[]>();

function resolveTodoPath(sessionId: string, sessionPath?: string): string {
  const basePath = sessionPath && sessionPath.length > 0
    ? sessionPath
    : path.join('.memory', sessionId);
  return path.join(basePath, 'todos.json');
}

async function loadTodos(sessionId: string, sessionPath?: string): Promise<TodoItem[]> {
  if (todoCache.has(sessionId)) {
    return todoCache.get(sessionId) || [];
  }

  const filePath = resolveTodoPath(sessionId, sessionPath);

  // === 底层异常：读取文件失败 ===
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // 文件不存在，返回空列表
      todoCache.set(sessionId, []);
      return [];
    }
    throw new Error(`Failed to read todo file: ${error}`);
  }

  // === 业务错误：JSON 解析失败 ===
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim() || '[]');
  } catch (error) {
    throw new Error(`Failed to parse todo file: ${error}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Todo file contains invalid format');
  }

  todoCache.set(sessionId, parsed);
  return parsed;
}

async function saveTodos(sessionId: string, sessionPath: string | undefined, todos: TodoItem[]): Promise<void> {
  const filePath = resolveTodoPath(sessionId, sessionPath);

  // === 底层异常：写入文件失败 ===
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(todos, null, 2));
  } catch (error) {
    throw new Error(`Failed to save todo file: ${error}`);
  }

  todoCache.set(sessionId, todos);
}

export class TodoCreateTool extends BaseTool<any> {
  schema = z.object({
    todos: z.array(TodoInfo).describe('The list of todo operations to perform'),
  }).strict();

  name = 'todo_create';
  description = DESCRIPTION_WRITE;

  async execute({ todos }: { todos: TodoItem[] }): Promise<ToolResult> {
    const context = ToolRegistry.getContext();

    // Apply default values to todos that don't have them
    const normalizedTodos = todos.map(todo => ({
      ...todo,
      status: todo.status || 'pending',
      priority: todo.priority || 'medium',
    }));

    // === 底层异常：保存失败 ===
    if (context.sessionId) {
      await saveTodos(context.sessionId, context.sessionPath, normalizedTodos);
    } else {
      todoList = normalizedTodos;
    }

    const data = { count: normalizedTodos.length, todos: normalizedTodos };
    return this.result({
      success: true,
      metadata: data,
      output: `Successfully created ${data.count} todo(s)`,
    });
  }
}

export class TodoGetAllTool extends BaseTool<any> {
  schema = z.object({});
  name = 'todo_get_all';
  description = 'List all todos';

  async execute(): Promise<ToolResult> {
    const context = ToolRegistry.getContext();

    // === 底层异常：加载失败 ===
    const todos = context.sessionId
      ? await loadTodos(context.sessionId, context.sessionPath)
      : todoList;

    const data = { count: todos.length, todos };
    return this.result({
      success: true,
      metadata: data,
      output: `Retrieved ${data.count} todo(s)`,
    });
  }
}

export class TodoGetActiveTool extends BaseTool<any> {
  schema = z.object({
    limit: z.number().int().min(1).max(200).default(50),
    sort_by: z.enum(['priority', 'status', 'none']).default('priority'),
    fields: z.array(z.enum(['id', 'content', 'status', 'priority']))
      .min(1)
      .default(['id', 'content', 'status', 'priority']),
  }).strict();

  name = 'todo_get_active';
  description = 'List active todos (pending/in_progress).';

  async execute({ limit, sort_by, fields }: { limit: number; sort_by: 'priority'|'status'|'none'; fields: string[] }): Promise<ToolResult> {
    const context = ToolRegistry.getContext();

    // === 底层异常：加载失败 ===
    const todos: TodoItem[] = context.sessionId
      ? await loadTodos(context.sessionId, context.sessionPath)
      : todoList;

    const active = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');

    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const statusRank: Record<string, number> = { in_progress: 0, pending: 1 };

    let resultList = active.slice();
    if (sort_by === 'priority') {
      resultList.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
    } else if (sort_by === 'status') {
      resultList.sort((a, b) => statusRank[a.status] - statusRank[b.status]);
    }

    resultList = resultList.slice(0, limit);

    const trimmed = resultList.map(t => {
      const o: any = {};
      for (const f of fields) o[f] = (t as any)[f];
      return o;
    });

    const data = {
      count_total_active: active.length,
      returned: trimmed.length,
      todos: trimmed,
    };

    return this.result({
      success: true,
      metadata: data,
      output: `Retrieved ${data.returned} active todo(s) out of ${data.count_total_active} total`,
    });
  }
}

const NonEmptyPatch = z.object({
  content: z.string().min(1).max(200).optional(),
  status: Status.optional(),
  priority: Priority.optional(),
}).strict().refine(p => Object.keys(p).length > 0, {
  message: 'patch must include at least one field',
});

const TodoOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    item: TodoInfo.omit({ id: true }).extend({
      id: z.string().min(1).optional(),
    }).strict(),
  }).strict(),
  z.object({
    op: z.literal('update'),
    id: z.string().min(1),
    patch: NonEmptyPatch,
  }).strict(),
  z.object({
    op: z.literal('delete'),
    id: z.string().min(1),
  }).strict(),
]);

type TodoOpType = z.infer<typeof TodoOp>;

export class TodoApplyOpsTool extends BaseTool<any> {
  name = 'todo_apply_ops';
  description = `Apply todo operations (add/update/delete).

## Operation Types

### add
Add a new todo item. ID is auto-generated if not provided.
Example: {"op": "add", "item": {"content": "Implement feature X", "priority": "high", "status": "pending"}}

### update
Update an existing todo. The 'id' specifies which todo to update. The 'patch' contains fields to update.
Example: {"op": "update", "id": "t_1", "patch": {"content": "New content", "status": "completed", "priority": "high"}}

### delete
Delete a todo by ID.
Example: {"op": "delete", "id": "t_1"}`;

  schema = z.object({
    ops: z.array(TodoOp).describe('Array of todo operations'),
  }).strict();

  async execute({ ops }: { ops: TodoOpType[] }): Promise<ToolResult> {
    const context = ToolRegistry.getContext();

    // === 底层异常：加载失败 ===
    const todos: TodoItem[] = context.sessionId
      ? await loadTodos(context.sessionId, context.sessionPath)
      : todoList;

    const byId = new Map(todos.map(t => [t.id, t]));
    const updated_ids: string[] = [];
    const added_ids: string[] = [];
    const deleted_ids: string[] = [];
    const errors: Array<{ op: string; id?: string; message: string }> = [];

    for (const op of ops) {
      if (op.op === 'add') {
        const id = op.item.id ?? `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        // === 业务错误：ID 重复 ===
        if (byId.has(id)) {
          errors.push({ op: 'add', id, message: 'id already exists' });
          continue;
        }
        const item: TodoItem = {
          id,
          content: op.item.content,
          status: op.item.status ?? 'pending',
          priority: op.item.priority ?? 'medium',
        };
        byId.set(id, item);
        added_ids.push(id);
      } else if (op.op === 'update') {
        // === 业务错误：ID 不存在 ===
        const item = byId.get(op.id);
        if (!item) {
          errors.push({ op: 'update', id: op.id, message: 'todo not found' });
          continue;
        }
        const next = { ...item, ...op.patch };
        byId.set(op.id, next);
        updated_ids.push(op.id);
      } else if (op.op === 'delete') {
        // === 业务错误：ID 不存在 ===
        if (!byId.has(op.id)) {
          errors.push({ op: 'delete', id: op.id, message: 'todo not found' });
          continue;
        }
        byId.delete(op.id);
        deleted_ids.push(op.id);
      }
    }

    const nextTodos = Array.from(byId.values());

    // === 底层异常：保存失败 ===
    if (context.sessionId) {
      await saveTodos(context.sessionId, context.sessionPath, nextTodos);
    } else {
      todoList = nextTodos;
    }

    // 有错误时返回部分成功 - 仍然保存成功的结果，但标记为部分失败
    if (errors.length > 0) {
      const data = {
        count: nextTodos.length,
        added_ids,
        updated_ids,
        deleted_ids,
        todos: nextTodos,
        errors,
        partialSuccess: true,
      };
      return this.result({
        success: false,
        metadata: { error: 'PARTIAL_FAILURE', ...data } as any,
        output: `PARTIAL_FAILURE: Some operations failed: ${errors.map(e => e.message).join(', ')}`,
      });
    }

    const data = {
      count: nextTodos.length,
      added_ids,
      updated_ids,
      deleted_ids,
      todos: nextTodos,
      errors: [],
    };

    return this.result({
      success: true,
      metadata: data,
      output: `Successfully applied ${added_ids.length} add(s), ${updated_ids.length} update(s), ${deleted_ids.length} deletion(s)`,
    });
  }
}

export function clearTodoCache(sessionId?: string): void {
  if (sessionId) {
    todoCache.delete(sessionId);
  } else {
    todoCache.clear();
  }
}

const TodoTools = () => {
  return [
    new TodoCreateTool(),
    new TodoGetAllTool(),
    new TodoGetActiveTool(),
    new TodoApplyOpsTool(),
  ]
}

export default TodoTools;
