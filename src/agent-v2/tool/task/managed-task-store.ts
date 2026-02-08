import fs from 'node:fs/promises';
import path from 'node:path';
import type { IMemoryManager, TaskData } from '../../memory/types';
import {
  ManagedTask,
  ManagedTaskListSchema,
  MANAGED_TASK_PARENT_ID,
  MANAGED_TASK_SCHEMA_VERSION,
  compareTaskIds,
  unique,
} from './shared';

const taskListCache = new Map<string, ManagedTask[]>();
let inMemoryTaskList: ManagedTask[] = [];

function cacheKey(sessionId?: string): string {
  if (!sessionId) return '__memory__';
  return sessionId;
}

function resolveTaskFilePath(sessionId: string): string {
  const basePath = path.join('.memory', sessionId);
  return path.join(basePath, 'task-list.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function buildManagedTaskStorageId(sessionId: string, taskId: string): string {
  return `managed-task-${encodeURIComponent(sessionId)}-${encodeURIComponent(taskId)}`;
}

function mapManagedTaskToTaskData(task: ManagedTask, sessionId: string): Omit<TaskData, 'createdAt' | 'updatedAt'> {
  return {
    id: buildManagedTaskStorageId(sessionId, task.id),
    taskId: buildManagedTaskStorageId(sessionId, task.id),
    sessionId,
    parentTaskId: MANAGED_TASK_PARENT_ID,
    status: task.status,
    title: task.subject,
    description: task.description,
    metadata: {
      schemaVersion: MANAGED_TASK_SCHEMA_VERSION,
      managedTask: {
        logicalTaskId: task.id,
        activeForm: task.activeForm,
        owner: task.owner || '',
        blocks: task.blocks,
        blockedBy: task.blockedBy,
        metadata: task.metadata,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    },
  };
}

function mapTaskDataToManagedTask(task: TaskData): ManagedTask | null {
  if (task.parentTaskId !== MANAGED_TASK_PARENT_ID) return null;
  if (!isRecord(task.metadata)) return null;
  const envelope = task.metadata;
  if (!isRecord(envelope.managedTask)) return null;
  const managed = envelope.managedTask;

  const logicalTaskId = typeof managed.logicalTaskId === 'string'
    ? managed.logicalTaskId
    : null;
  if (!logicalTaskId) return null;

  const activeForm = typeof managed.activeForm === 'string'
    ? managed.activeForm
    : `${task.title}...`;
  const owner = typeof managed.owner === 'string' ? managed.owner : '';
  const blocks = unique(asStringArray(managed.blocks));
  const blockedBy = unique(asStringArray(managed.blockedBy));
  const createdAt = typeof managed.createdAt === 'string'
    ? managed.createdAt
    : new Date(task.createdAt).toISOString();
  const updatedAt = typeof managed.updatedAt === 'string'
    ? managed.updatedAt
    : new Date(task.updatedAt).toISOString();

  if (task.status !== 'pending' && task.status !== 'in_progress' && task.status !== 'completed') {
    return null;
  }

  return {
    id: logicalTaskId,
    subject: task.title,
    description: task.description || '',
    activeForm,
    status: task.status,
    owner,
    metadata: isRecord(managed.metadata) ? managed.metadata : undefined,
    blocks,
    blockedBy,
    createdAt,
    updatedAt,
  };
}

async function loadTasksFromFile(filePath: string): Promise<ManagedTask[]> {
  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read task list file: ${error}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim() || '[]');
  } catch (error) {
    throw new Error(`Failed to parse task list file: ${error}`);
  }

  const result = ManagedTaskListSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Task list file format is invalid: ${result.error.issues.map((i) => i.message).join(', ')}`);
  }

  return result.data.map((task) => ({
    ...task,
    blocks: unique(task.blocks),
    blockedBy: unique(task.blockedBy),
  }));
}

export async function loadTasks(
  sessionId?: string,
  memoryManager?: IMemoryManager,
): Promise<ManagedTask[]> {
  if (sessionId && memoryManager) {
    const storedTasks = await memoryManager.queryTasks(
      {
        sessionId,
        parentTaskId: MANAGED_TASK_PARENT_ID,
      },
      {
        orderBy: 'createdAt',
        orderDirection: 'asc',
      },
    );

    const managedTasks = storedTasks
      .map(mapTaskDataToManagedTask)
      .filter((task): task is ManagedTask => task !== null)
      .sort((a, b) => compareTaskIds(a.id, b.id));
    if (managedTasks.length > 0) {
      return managedTasks;
    }

    const legacyFilePath = resolveTaskFilePath(sessionId);
    const legacyTasks = await loadTasksFromFile(legacyFilePath);
    if (legacyTasks.length > 0) {
      for (const task of legacyTasks) {
        await memoryManager.saveTask(mapManagedTaskToTaskData(task, sessionId));
      }
      return legacyTasks.sort((a, b) => compareTaskIds(a.id, b.id));
    }
    return [];
  }

  if (!sessionId) {
    return inMemoryTaskList;
  }

  const key = cacheKey(sessionId);
  if (taskListCache.has(key)) {
    return taskListCache.get(key) || [];
  }

  const filePath = resolveTaskFilePath(sessionId);
  const normalized = await loadTasksFromFile(filePath);
  taskListCache.set(key, normalized);
  return normalized;
}

export async function saveTasks(
  tasks: ManagedTask[],
  sessionId?: string,
  memoryManager?: IMemoryManager,
): Promise<void> {
  if (sessionId && memoryManager) {
    const existing = await memoryManager.queryTasks({
      sessionId,
      parentTaskId: MANAGED_TASK_PARENT_ID,
    });

    const nextTaskIds = new Set(tasks.map((task) => task.id));

    for (const task of tasks) {
      await memoryManager.saveTask(mapManagedTaskToTaskData(task, sessionId));
    }

    for (const taskData of existing) {
      const mapped = mapTaskDataToManagedTask(taskData);
      if (!mapped) continue;
      if (!nextTaskIds.has(mapped.id)) {
        await memoryManager.deleteTask(taskData.taskId);
      }
    }
    return;
  }

  if (!sessionId) {
    inMemoryTaskList = tasks;
    return;
  }

  const key = cacheKey(sessionId);
  const filePath = resolveTaskFilePath(sessionId);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to save task list file: ${error}`);
  }
  taskListCache.set(key, tasks);
}

export async function saveTaskEntry(
  task: ManagedTask,
  sessionId?: string,
  memoryManager?: IMemoryManager,
): Promise<void> {
  if (sessionId && memoryManager) {
    await memoryManager.saveTask(mapManagedTaskToTaskData(task, sessionId));
    return;
  }

  if (!sessionId) {
    const index = inMemoryTaskList.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      inMemoryTaskList[index] = task;
    } else {
      inMemoryTaskList = [...inMemoryTaskList, task];
    }
    return;
  }

  const key = cacheKey(sessionId);
  const filePath = resolveTaskFilePath(sessionId);
  const current = taskListCache.has(key)
    ? (taskListCache.get(key) || [])
    : await loadTasksFromFile(filePath);
  const merged = [
    ...current.filter((item) => item.id !== task.id),
    task,
  ].sort((a, b) => compareTaskIds(a.id, b.id));

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to save task list file: ${error}`);
  }
  taskListCache.set(key, merged);
}

export async function deleteTaskEntry(
  taskId: string,
  sessionId?: string,
  memoryManager?: IMemoryManager,
): Promise<void> {
  if (sessionId && memoryManager) {
    await memoryManager.deleteTask(buildManagedTaskStorageId(sessionId, taskId));
    return;
  }

  if (!sessionId) {
    inMemoryTaskList = inMemoryTaskList.filter((item) => item.id !== taskId);
    return;
  }

  const key = cacheKey(sessionId);
  const filePath = resolveTaskFilePath(sessionId);
  const current = taskListCache.has(key)
    ? (taskListCache.get(key) || [])
    : await loadTasksFromFile(filePath);
  const next = current.filter((item) => item.id !== taskId);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to save task list file: ${error}`);
  }
  taskListCache.set(key, next);
}

export function applyMetadataPatch(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown | null>,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function clearManagedTaskState(sessionId?: string): void {
  if (!sessionId) {
    taskListCache.clear();
    inMemoryTaskList = [];
    return;
  }

  taskListCache.delete(cacheKey(sessionId));
}
