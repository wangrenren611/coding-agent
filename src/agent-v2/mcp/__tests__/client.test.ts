/**
 * MCP Client Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../client';
import { ConnectionState, McpClientEvent } from '../types';
import type { McpServerConfig } from '../types';

describe('McpClient', () => {
    let client: McpClient;

    const testConfig: McpServerConfig = {
        name: 'test-server',
        command: 'node',
        args: ['-e', 'console.log("test")'],
    };

    beforeEach(() => {
        client = new McpClient(testConfig);
    });

    afterEach(async () => {
        if (client) {
            await client.disconnect();
        }
    });

    describe('constructor', () => {
        it('should create client with config', () => {
            expect(client).toBeDefined();
            expect(client.config.name).toBe('test-server');
        });

        it('should have initial state as disconnected', () => {
            expect(client.state).toBe(ConnectionState.DISCONNECTED);
        });

        it('should have empty tools initially', () => {
            expect(client.tools).toEqual([]);
        });
    });

    describe('state management', () => {
        it('should track connection state changes', () => {
            return new Promise<void>((resolve) => {
                client.on(McpClientEvent.STATE_CHANGED, (data) => {
                    expect(data).toHaveProperty('previousState');
                    expect(data).toHaveProperty('newState');
                    expect(data).toHaveProperty('serverName');
                    resolve();
                });

                // Trigger a state change
                client.disconnect().catch(() => {});
            });
        });
    });

    describe('disconnect', () => {
        it('should disconnect cleanly', async () => {
            await client.disconnect();
            expect(client.state).toBe(ConnectionState.DISCONNECTED);
        });

        it('should be safe to call disconnect multiple times', async () => {
            await client.disconnect();
            await client.disconnect();
            expect(client.state).toBe(ConnectionState.DISCONNECTED);
        });
    });
});
