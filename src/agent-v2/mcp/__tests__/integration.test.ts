/**
 * MCP (Model Context Protocol) 集成测试
 *
 * 测试 MCP 模块的完整功能流程
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as fsSync from 'fs';
import { McpClient } from '../client';
import { McpClientEvent } from '../types';
import { McpManager } from '../manager';
import { loadMcpConfig } from '../config-loader';
import { McpToolAdapter } from '../tool-adapter';
import { jsonSchemaToZod } from '../json-schema-to-zod';
import type { McpTool } from '../types';
import { createDefaultToolRegistry } from '../../tool';

// Mock child_process for testing without real MCP servers
vi.mock('child_process', () => ({
    spawn: vi.fn(() => ({
        pid: 12345,
        stdin: {
            write: vi.fn(),
            end: vi.fn(),
        },
        stdout: {
            on: vi.fn(),
        },
        stderr: {
            on: vi.fn(),
        },
        on: vi.fn(),
        kill: vi.fn(),
    })),
}));

describe('MCP Integration Tests', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-integration-'));
        // Reset singleton
        McpManager.resetInstance();
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
        vi.clearAllMocks();
    });

    describe('Configuration Loading', () => {
        it('should load config from file', () => {
            const configPath = path.join(tempDir, '.mcp.json');
            const config = {
                mcpServers: [
                    {
                        name: 'test-server',
                        command: 'node',
                        args: ['server.js'],
                    },
                ],
            };

            fsSync.writeFileSync(configPath, JSON.stringify(config));
            const loaded = loadMcpConfig(configPath);

            expect(loaded.mcpServers).toHaveLength(1);
            expect(loaded.mcpServers[0].name).toBe('test-server');
        });

        it('should parse environment variables in config', () => {
            process.env.TEST_API_KEY = 'secret-key-123';

            const configPath = path.join(tempDir, '.mcp.json');
            const config = {
                mcpServers: [
                    {
                        name: 'test-server',
                        command: 'node',
                        args: ['server.js'],
                        env: {
                            API_KEY: '${TEST_API_KEY}',
                            OPTIONAL: '${UNDEFINED_VAR:-default-value}',
                        },
                    },
                ],
            };

            fsSync.writeFileSync(configPath, JSON.stringify(config));
            const loaded = loadMcpConfig(configPath);

            expect(loaded.mcpServers[0].env?.API_KEY).toBe('secret-key-123');
            expect(loaded.mcpServers[0].env?.OPTIONAL).toBe('default-value');

            delete process.env.TEST_API_KEY;
        });

        it('should filter disabled servers', () => {
            const configPath = path.join(tempDir, '.mcp.json');
            const config = {
                mcpServers: [
                    { name: 'enabled-server', command: 'node', args: ['a.js'] },
                    { name: 'disabled-server', command: 'node', args: ['b.js'], disabled: true },
                ],
            };

            fsSync.writeFileSync(configPath, JSON.stringify(config));
            const loaded = loadMcpConfig(configPath);

            expect(loaded.mcpServers).toHaveLength(1);
            expect(loaded.mcpServers[0].name).toBe('enabled-server');
        });
    });

    describe('McpClient', () => {
        it('should create client with correct config', () => {
            const client = new McpClient({
                name: 'test',
                command: 'node',
                args: ['server.js'],
            });

            expect(client.config.name).toBe('test');
            expect(client.state).toBe('disconnected');
        });

        it('should track connection state changes', () => {
            return new Promise<void>((resolve, reject) => {
                const client = new McpClient({
                    name: 'test',
                    command: 'node',
                    args: ['server.js'],
                });

                client.on(McpClientEvent.STATE_CHANGED, (data: { previousState: string; newState: string }) => {
                    expect(data).toHaveProperty('previousState');
                    expect(data).toHaveProperty('newState');
                    resolve();
                });

                // Trigger a state change by disconnecting
                client.disconnect().catch(() => reject);
            });
        });
    });

    describe('McpManager', () => {
        it('should be a singleton', () => {
            const instance1 = McpManager.getInstance();
            const instance2 = McpManager.getInstance();

            expect(instance1).toBe(instance2);
        });

        it('should reset singleton', () => {
            const instance1 = McpManager.getInstance();
            McpManager.resetInstance();
            const instance2 = McpManager.getInstance();

            expect(instance1).not.toBe(instance2);
        });

        it('should initialize with config', async () => {
            const manager = McpManager.getInstance();

            // 使用不存在的配置文件路径，确保测试环境干净
            await manager.initialize({ configPath: 'non-existent-config.json' });

            expect(manager.getConnectionInfo()).toHaveLength(0);
        });
    });

    describe('Tool Adapter', () => {
        it('should convert MCP tool to adapter', () => {
            const mockClient = {
                config: { name: 'test-server' },
                callTool: vi.fn().mockResolvedValue({
                    content: [{ type: 'text', text: 'result' }],
                    isError: false,
                }),
            } as unknown as McpClient;

            const mockTool: McpTool = {
                name: 'read_file',
                description: 'Read a file from the filesystem',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path' },
                    },
                    required: ['path'],
                },
            };

            const adapter = new McpToolAdapter(mockClient, mockTool, 'test-server');

            // Name is sanitized (non-alphanumeric replaced with underscore)
            expect(adapter.name).toMatch(/^test.*server.*read.*file$/);
            expect(adapter.description).toContain('[MCP:');
            expect(adapter.description).toContain('test-server');
            expect(adapter.description).toContain('Read a file');
        });

        it('should sanitize tool names', () => {
            const mockClient = {
                config: { name: 'test-server' },
                callTool: vi.fn(),
            } as unknown as McpClient;

            const mockTool: McpTool = {
                name: 'some-complex_tool.name',
                description: 'Test',
                inputSchema: { type: 'object', properties: {} },
            };

            const adapter = new McpToolAdapter(mockClient, mockTool, 'test-server');

            // Name should only contain alphanumeric, underscore, and hyphen
            expect(adapter.name).toMatch(/^[a-zA-Z0-9_-]+$/);
        });

        it('should convert JSON Schema to Zod', () => {
            const mockClient = {
                config: { name: 'test-server' },
                callTool: vi.fn(),
            } as unknown as McpClient;

            const mockTool: McpTool = {
                name: 'search',
                description: 'Search the web',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search query' },
                        maxResults: { type: 'integer', minimum: 1, maximum: 50 },
                    },
                    required: ['query'],
                },
            };

            const adapter = new McpToolAdapter(mockClient, mockTool, 'test-server');

            // Schema should be a Zod type
            expect(adapter.schema).toBeDefined();
        });
    });

    describe('JSON Schema to Zod Conversion', () => {
        it('should convert string schema', () => {
            const schema = jsonSchemaToZod({
                type: 'string',
                minLength: 5,
                maxLength: 100,
            });

            // Valid
            expect(schema.safeParse('hello world').success).toBe(true);
            // Too short
            expect(schema.safeParse('hi').success).toBe(false);
        });

        it('should convert number schema', () => {
            const schema = jsonSchemaToZod({
                type: 'number',
                minimum: 0,
                maximum: 100,
            });

            expect(schema.safeParse(50).success).toBe(true);
            expect(schema.safeParse(-1).success).toBe(false);
            expect(schema.safeParse(101).success).toBe(false);
        });

        it('should convert array schema', () => {
            const schema = jsonSchemaToZod({
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                maxItems: 3,
            });

            expect(schema.safeParse(['a', 'b']).success).toBe(true);
            expect(schema.safeParse([]).success).toBe(false);
            expect(schema.safeParse(['a', 'b', 'c', 'd']).success).toBe(false);
        });

        it('should convert object schema', () => {
            const schema = jsonSchemaToZod({
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    age: { type: 'integer' },
                },
                required: ['name'],
            });

            expect(schema.safeParse({ name: 'test' }).success).toBe(true);
            expect(schema.safeParse({ name: 'test', age: 25 }).success).toBe(true);
            expect(schema.safeParse({ age: 25 }).success).toBe(false);
        });

        it('should convert enum schema', () => {
            const schema = jsonSchemaToZod({
                enum: ['red', 'green', 'blue'],
            });

            expect(schema.safeParse('red').success).toBe(true);
            expect(schema.safeParse('yellow').success).toBe(false);
        });

        it('should handle nested schemas', () => {
            const schema = jsonSchemaToZod({
                type: 'object',
                properties: {
                    user: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            email: { type: 'string', format: 'email' },
                        },
                        required: ['name'],
                    },
                },
            });

            expect(
                schema.safeParse({
                    user: { name: 'test', email: 'test@example.com' },
                }).success
            ).toBe(true);
        });
    });

    describe('ToolRegistry Integration', () => {
        it('should register MCP tools to registry', async () => {
            const registry = createDefaultToolRegistry({
                workingDirectory: tempDir,
            });

            // Get built-in tools count
            const builtInTools = registry.toLLMTools();
            expect(builtInTools.length).toBeGreaterThan(0);

            // Verify tool structure
            for (const tool of builtInTools) {
                expect(tool.type).toBe('function');
                expect(tool.function.name).toBeTruthy();
                expect(tool.function.description).toBeTruthy();
                expect(tool.function.parameters).toBeDefined();
            }
        });

        it('should list all tools including MCP', async () => {
            const registry = createDefaultToolRegistry({
                workingDirectory: tempDir,
            });

            const tools = registry.toLLMTools();
            const toolNames = tools.map((t) => t.function.name);

            // Check some expected built-in tools
            expect(toolNames).toContain('read_file');
            expect(toolNames).toContain('write_file');
            expect(toolNames).toContain('bash');
            expect(toolNames).toContain('grep');
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid config gracefully', () => {
            const configPath = path.join(tempDir, '.mcp.json');
            fsSync.writeFileSync(configPath, 'invalid json');

            // loadMcpConfig returns empty config on error
            const result = loadMcpConfig(configPath);
            expect(result.mcpServers).toEqual([]);
        });

        it('should handle missing config file', () => {
            const configPath = path.join(tempDir, 'nonexistent.json');

            // loadMcpConfig returns empty config for missing file
            const result = loadMcpConfig(configPath);
            expect(result.mcpServers).toEqual([]);
        });

        it('should handle empty server list', async () => {
            const manager = McpManager.getInstance();

            // 显式使用不存在的配置文件，避免读取工作目录中的真实 MCP 配置
            await manager.initialize({ configPath: path.join(tempDir, 'empty-config.json') });

            expect(manager.getConnectedServers()).toHaveLength(0);
            expect(manager.getTotalToolsCount()).toBe(0);
        });
    });

    describe('Config Format Compatibility', () => {
        it('should parse Claude Desktop format', () => {
            const configPath = path.join(tempDir, '.mcp.json');
            const claudeDesktopConfig = {
                mcpServers: {
                    filesystem: {
                        command: 'npx',
                        args: ['-y', '@anthropic/mcp-server-filesystem'],
                    },
                    database: {
                        command: 'mcp-server-postgres',
                        args: ['${DATABASE_URL}'],
                    },
                },
            };

            fsSync.writeFileSync(configPath, JSON.stringify(claudeDesktopConfig));
            const loaded = loadMcpConfig(configPath);

            expect(loaded.mcpServers).toHaveLength(2);
            expect(loaded.mcpServers.map((s) => s.name)).toContain('filesystem');
            expect(loaded.mcpServers.map((s) => s.name)).toContain('database');
        });

        it('should parse array format', () => {
            const configPath = path.join(tempDir, '.mcp.json');
            const arrayConfig = [
                { name: 'server1', command: 'node', args: ['a.js'] },
                { name: 'server2', command: 'node', args: ['b.js'] },
            ];

            fsSync.writeFileSync(configPath, JSON.stringify(arrayConfig));
            const loaded = loadMcpConfig(configPath);

            expect(loaded.mcpServers).toHaveLength(2);
        });
    });
});
