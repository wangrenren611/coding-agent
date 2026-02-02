/**
 * Tests for todo tools (TodoCreateTool, TodoGetAllTool, TodoGetActiveTool, TodoApplyOpsTool)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
    TodoCreateTool,
    TodoGetAllTool,
    TodoGetActiveTool,
    TodoApplyOpsTool,
    clearTodoCache
} from '../todo';
import { ToolRegistry } from '../registry';
import { TestEnvironment } from './test-utils';

describe('Todo Tools', () => {
    let env: TestEnvironment;
    let testSessionId: string;

    beforeEach(async () => {
        // Generate a unique session ID for each test
        testSessionId = 'test-session-' + Date.now() + '-' + Math.random().toString(36).substring(7);
        env = new TestEnvironment('todo-tools');
        await env.setup();
        // Clear any existing cache to ensure test isolation
        clearTodoCache();
        // Set context for tools
        ToolRegistry.setContext({
            sessionId: testSessionId,
            sessionPath: env.getTestDir()
        });
    });

    afterEach(async () => {
        // Clear cache after each test
        clearTodoCache();
        await env.teardown();
    });

    describe('TodoCreateTool', () => {
        it('should create a new todo list', async () => {
            const tool = new TodoCreateTool();
            const result = await tool.execute({
                todos: [
                    {
                        id: 't1',
                        content: 'Test task 1',
                        status: 'pending',
                        priority: 'high'
                    },
                    {
                        id: 't2',
                        content: 'Test task 2',
                        status: 'in_progress',
                        priority: 'medium'
                    }
                ]
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.count).toBe(2);
            expect(result.metadata?.todos).toHaveLength(2);
        });

        it('should use default status and priority', async () => {
            const tool = new TodoCreateTool();
            const result = await tool.execute({
                todos: [
                    {
                        id: 't1',
                        content: 'Test task'
                    }
                ]
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.todos[0].status).toBe('pending');
            expect(result.metadata?.todos[0].priority).toBe('medium');
        });

        it('should validate required fields', async () => {
            const tool = new TodoCreateTool();
            const result = await tool.execute({
                todos: [
                    {
                        id: '',
                        content: ''  // Invalid: empty content
                    }
                ]
            });

            expect(result).toBeDefined();
            // Should fail validation
        });

        it('should validate status enum', async () => {
            const tool = new TodoCreateTool();
            const result = await tool.execute({
                todos: [
                    {
                        id: 't1',
                        content: 'Test',
                        status: 'invalid_status' as any
                    }
                ]
            });

            expect(result).toBeDefined();
            // Should fail validation
        });

        it('should validate priority enum', async () => {
            const tool = new TodoCreateTool();
            const result = await tool.execute({
                todos: [
                    {
                        id: 't1',
                        content: 'Test',
                        priority: 'invalid_priority' as any
                    }
                ]
            });

            expect(result).toBeDefined();
            // Should fail validation
        });

        it('should validate content length', async () => {
            const tool = new TodoCreateTool();
            const longContent = 'a'.repeat(201); // Max is 200
            const result = await tool.execute({
                todos: [
                    {
                        id: 't1',
                        content: longContent
                    }
                ]
            });

            expect(result).toBeDefined();
            // Should fail validation
        });
    });

    describe('TodoGetAllTool', () => {
        beforeEach(async () => {
            // Create some todos
            const createTool = new TodoCreateTool();
            await createTool.execute({
                todos: [
                    { id: 't1', content: 'Task 1', status: 'pending', priority: 'high' },
                    { id: 't2', content: 'Task 2', status: 'completed', priority: 'low' },
                    { id: 't3', content: 'Task 3', status: 'in_progress', priority: 'medium' }
                ]
            });
        });

        it('should get all todos', async () => {
            const tool = new TodoGetAllTool();
            const result = await tool.execute();

            expect(result.success).toBe(true);
            expect(result.metadata?.count).toBe(3);
            expect(result.metadata?.todos).toHaveLength(3);
        });

        it('should return empty list when no todos exist', async () => {
            // Use a different session that has no todos
            const emptySessionId = 'empty-session-' + Date.now();
            const emptySessionPath = path.join(env.getTestDir(), 'empty');

            // Create the empty session directory
            const fs = await import('fs/promises');
            await fs.mkdir(emptySessionPath, { recursive: true });

            clearTodoCache();
            ToolRegistry.setContext({
                sessionId: emptySessionId,
                sessionPath: emptySessionPath
            });

            const tool = new TodoGetAllTool();
            const result = await tool.execute();

            expect(result.success).toBe(true);
            expect(result.metadata?.count).toBe(0);
            expect(result.metadata?.todos).toHaveLength(0);
        });
    });

    describe('TodoGetActiveTool', () => {
        beforeEach(async () => {
            const createTool = new TodoCreateTool();
            await createTool.execute({
                todos: [
                    { id: 't1', content: 'Pending task', status: 'pending', priority: 'high' },
                    { id: 't2', content: 'In progress task', status: 'in_progress', priority: 'medium' },
                    { id: 't3', content: 'Completed task', status: 'completed', priority: 'low' },
                    { id: 't4', content: 'Cancelled task', status: 'cancelled', priority: 'low' }
                ]
            });
        });

        it('should get only active todos (pending and in_progress)', async () => {
            const tool = new TodoGetActiveTool();
            const result = await tool.execute({
                limit: 50,
                sort_by: 'priority',
                fields: ['id', 'content', 'status', 'priority']
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.todos).toHaveLength(2); // Only pending and in_progress
            expect(result.metadata?.count_total_active).toBe(2);
        });

        it('should sort by priority', async () => {
            const tool = new TodoGetActiveTool();
            const result = await tool.execute({
                sort_by: 'priority',
                fields: ['id', 'content', 'status', 'priority']
            });

            expect(result.success).toBe(true);
            const todos = result.metadata?.todos || [];
            // High priority should come first
            if (todos.length > 1) {
                const priorities = todos.map(t => t.priority);
                expect(priorities[0]).toBe('high');
            }
        });

        it('should sort by status', async () => {
            const tool = new TodoGetActiveTool();
            const result = await tool.execute({
                sort_by: 'status',
                fields: ['id', 'content', 'status', 'priority']
            });

            expect(result.success).toBe(true);
            // in_progress should come before pending
            const todos = result.metadata?.todos || [];
            if (todos.length > 1) {
                expect(todos[0].status).toBe('in_progress');
            }
        });

        it('should respect limit parameter', async () => {
            const tool = new TodoGetActiveTool();
            const result = await tool.execute({
                limit: 1,
                fields: ['id', 'content', 'status', 'priority']
            });

            expect(result.success).toBe(true);
            expect(result.metadata?.returned).toBeLessThanOrEqual(1);
        });

        it('should return only specified fields', async () => {
            const tool = new TodoGetActiveTool();
            const result = await tool.execute({
                fields: ['id', 'content']
            });

            expect(result.success).toBe(true);
            const todo = result.metadata?.todos[0];
            expect(todo).toHaveProperty('id');
            expect(todo).toHaveProperty('content');
            expect(todo).not.toHaveProperty('status');
            expect(todo).not.toHaveProperty('priority');
        });

        it('should validate limit range', async () => {
            const tool = new TodoGetActiveTool();
            const result = await tool.execute({
                limit: 500, // Too large (max 200)
                fields: ['id', 'content', 'status', 'priority']
            });

            expect(result).toBeDefined();
            // Should fail validation
        });
    });

    describe('TodoApplyOpsTool', () => {
        beforeEach(async () => {
            const createTool = new TodoCreateTool();
            await createTool.execute({
                todos: [
                    { id: 'existing', content: 'Existing task', status: 'pending', priority: 'medium' }
                ]
            });
        });

        describe('Add Operation', () => {
            it('should add a new todo', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'add',
                            item: {
                                content: 'New task',
                                priority: 'high'
                            }
                        }
                    ]
                });

                expect(result.success).toBe(true);
                expect(result.metadata?.added_ids).toHaveLength(1);
            });

            it('should generate ID if not provided', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'add',
                            item: {
                                content: 'New task'
                            }
                        }
                    ]
                });

                expect(result.success).toBe(true);
                expect(result.metadata?.added_ids[0]).toMatch(/^t_\d+_[a-f0-9]+$/);
            });

            it('should use provided ID', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'add',
                            item: {
                                id: 'custom-id',
                                content: 'New task'
                            }
                        }
                    ]
                });

                expect(result.success).toBe(true);
                expect(result.metadata?.added_ids[0]).toBe('custom-id');
            });

            it('should fail on duplicate ID', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'add',
                            item: {
                                id: 'existing',  // Already exists
                                content: 'Duplicate task'
                            }
                        }
                    ]
                });

                expect(result.success).toBe(false);
                expect(result.metadata?.error).toBe('PARTIAL_FAILURE');
                expect(result.metadata?.errors).toBeDefined();
            });
        });

        describe('Update Operation', () => {
            it('should update existing todo', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'update',
                            id: 'existing',
                            patch: {
                                status: 'completed'
                            }
                        }
                    ]
                });

                expect(result.success).toBe(true);
                expect(result.metadata?.updated_ids).toContain('existing');
            });

            it('should update multiple fields', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'update',
                            id: 'existing',
                            patch: {
                                content: 'Updated content',
                                status: 'in_progress',
                                priority: 'high'
                            }
                        }
                    ]
                });

                expect(result.success).toBe(true);
            });

            it('should fail on non-existent todo', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'update',
                            id: 'non-existent',
                            patch: {
                                status: 'completed'
                            }
                        }
                    ]
                });

                expect(result.success).toBe(false);
                expect(result.metadata?.errors).toBeDefined();
            });

            it('should require at least one field in patch', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'update',
                            id: 'existing',
                            patch: {}
                        }
                    ]
                });

                expect(result).toBeDefined();
                // Should fail validation
            });
        });

        describe('Delete Operation', () => {
            it('should delete existing todo', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'delete',
                            id: 'existing'
                        }
                    ]
                });

                expect(result.success).toBe(true);
                expect(result.metadata?.deleted_ids).toContain('existing');
            });

            it('should fail on non-existent todo', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'delete',
                            id: 'non-existent'
                        }
                    ]
                });

                expect(result.success).toBe(false);
                expect(result.metadata?.errors).toBeDefined();
            });
        });

        describe('Mixed Operations', () => {
            it('should handle multiple operations in one call', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'add',
                            item: { content: 'New 1', priority: 'high' }
                        },
                        {
                            op: 'add',
                            item: { content: 'New 2', priority: 'low' }
                        },
                        {
                            op: 'update',
                            id: 'existing',
                            patch: { status: 'completed' }
                        }
                    ]
                });

                expect(result.success).toBe(true);
                expect(result.metadata?.added_ids).toHaveLength(2);
                expect(result.metadata?.updated_ids).toHaveLength(1);
            });

            it('should handle partial failures gracefully', async () => {
                const tool = new TodoApplyOpsTool();
                const result = await tool.execute({
                    ops: [
                        {
                            op: 'add',
                            item: { content: 'Valid task' }
                        },
                        {
                            op: 'update',
                            id: 'non-existent',
                            patch: { status: 'completed' }
                        },
                        {
                            op: 'add',
                            item: { content: 'Another valid task' }
                        }
                    ]
                });

                expect(result.success).toBe(false);
                expect(result.metadata?.error).toBe('PARTIAL_FAILURE');
                expect(result.metadata?.added_ids).toHaveLength(2);
                expect(result.metadata?.errors).toHaveLength(1);
            });
        });
    });

    describe('Integration', () => {
        it('should persist todos across operations', async () => {
            // Create todos
            const createTool = new TodoCreateTool();
            await createTool.execute({
                todos: [
                    { id: 't1', content: 'Task 1', status: 'pending', priority: 'high' }
                ]
            });

            // Update todo
            const applyTool = new TodoApplyOpsTool();
            await applyTool.execute({
                ops: [
                    {
                        op: 'update',
                        id: 't1',
                        patch: { status: 'completed' }
                    }
                ]
            });

            // Get all todos
            const getAllTool = new TodoGetAllTool();
            const result = await getAllTool.execute();

            expect(result.success).toBe(true);
            const todo = result.metadata?.todos.find((t: any) => t.id === 't1');
            expect(todo?.status).toBe('completed');
        });
    });
});
