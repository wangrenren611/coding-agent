/**
 * MCP Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpManager } from '../manager';

describe('McpManager', () => {
    let manager: McpManager;

    beforeEach(() => {
        // Reset singleton for each test
        McpManager.resetInstance();
        manager = McpManager.getInstance();
    });

    afterEach(async () => {
        await manager.disconnectAll();
    });

    describe('getInstance', () => {
        it('should return singleton instance', () => {
            const manager1 = McpManager.getInstance();
            const manager2 = McpManager.getInstance();
            expect(manager1).toBe(manager2);
        });
    });

    describe('getConnectionInfo', () => {
        it('should return empty array initially', () => {
            const info = manager.getConnectionInfo();
            expect(info).toEqual([]);
        });
    });

    describe('getConnectedServers', () => {
        it('should return empty array initially', () => {
            const servers = manager.getConnectedServers();
            expect(servers).toEqual([]);
        });
    });

    describe('getTotalToolsCount', () => {
        it('should return 0 initially', () => {
            const count = manager.getTotalToolsCount();
            expect(count).toBe(0);
        });
    });

    describe('getAllToolAdapters', () => {
        it('should return empty array initially', () => {
            const adapters = manager.getAllToolAdapters();
            expect(adapters).toEqual([]);
        });
    });

    describe('disconnectAll', () => {
        it('should complete without error when no servers connected', async () => {
            await expect(manager.disconnectAll()).resolves.toBeUndefined();
        });
    });
});
