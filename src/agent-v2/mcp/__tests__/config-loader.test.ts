/**
 * Config Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadMcpConfig, validateServerConfig } from '../config-loader';
import type { McpServerConfig } from '../types';

describe('loadMcpConfig', () => {
    const testDir = resolve(__dirname, 'test-configs');
    const testConfigPath = resolve(testDir, 'test-config.json');

    beforeEach(() => {
        if (!existsSync(testDir)) {
            mkdirSync(testDir, { recursive: true });
        }
    });

    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('should return empty config when file does not exist', () => {
        const result = loadMcpConfig('/non/existent/config.json');
        expect(result.mcpServers).toHaveLength(0);
    });

    it('should load standard format config', () => {
        const configContent = JSON.stringify({
            mcpServers: [
                {
                    name: 'test-server',
                    command: 'node',
                    args: ['-e', 'console.log("test")'],
                },
            ],
        });
        writeFileSync(testConfigPath, configContent);
        const result = loadMcpConfig(testConfigPath);
        expect(result.mcpServers).toHaveLength(1);
        expect(result.mcpServers[0].name).toBe('test-server');
    });

    it('should load Claude Desktop format config', () => {
        const configContent = JSON.stringify({
            mcpServers: {
                filesystem: {
                    command: 'npx',
                    args: ['-y', 'mcp-server-filesystem'],
                },
            },
        });
        writeFileSync(testConfigPath, configContent);
        const result = loadMcpConfig(testConfigPath);
        expect(result.mcpServers).toHaveLength(1);
        expect(result.mcpServers[0].name).toBe('filesystem');
    });

    it('should filter disabled servers', () => {
        const configContent = JSON.stringify({
            mcpServers: [
                {
                    name: 'disabled-server',
                    command: 'node',
                    disabled: true,
                },
                {
                    name: 'enabled-server',
                    command: 'node',
                },
            ],
        });
        writeFileSync(testConfigPath, configContent);
        const result = loadMcpConfig(testConfigPath);
        expect(result.mcpServers).toHaveLength(1);
        expect(result.mcpServers[0].name).toBe('enabled-server');
    });

    it('should resolve environment variables in args', () => {
        process.env.TEST_API_KEY = 'test-value';
        const configContent = JSON.stringify({
            mcpServers: [
                {
                    name: 'env-test',
                    command: 'echo',
                    args: ['${TEST_API_KEY}'],
                },
            ],
        });
        writeFileSync(testConfigPath, configContent);
        const result = loadMcpConfig(testConfigPath);
        expect(result.mcpServers[0].args).toContain('test-value');
        delete process.env.TEST_API_KEY;
    });

    it('should resolve environment variables with default values', () => {
        const configContent = JSON.stringify({
            mcpServers: [
                {
                    name: 'env-test',
                    command: 'echo',
                    args: ['${NON_EXISTENT_VAR:-default-value}'],
                },
            ],
        });
        writeFileSync(testConfigPath, configContent);
        const result = loadMcpConfig(testConfigPath);
        expect(result.mcpServers[0].args).toContain('default-value');
    });
});

describe('validateServerConfig', () => {
    it('should validate correct config', () => {
        const config = {
            name: 'test-server',
            command: 'node',
            args: ['-e', 'console.log("test")'],
        };
        expect(validateServerConfig(config)).toBe(true);
    });

    it('should reject config missing name', () => {
        const config = {
            command: 'node',
        } as unknown as McpServerConfig;
        expect(validateServerConfig(config)).toBe(false);
    });

    it('should reject config missing command', () => {
        const config = {
            name: 'test-server',
        } as unknown as McpServerConfig;
        expect(validateServerConfig(config)).toBe(false);
    });
});
