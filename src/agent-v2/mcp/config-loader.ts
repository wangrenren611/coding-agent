/**
 * MCP 配置加载器
 *
 * 加载和解析 MCP 配置文件，支持多种配置格式
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { z as zod } from 'zod';
import { getLogger } from '../logger';
import type { McpServerConfig, McpConfig } from './types';

/**
 * 配置文件搜索路径
 */
const CONFIG_SEARCH_PATHS = ['.mcp.json', 'mcp.json', '.mcp/config.json', '.claude/mcp.json', '.config/mcp.json'];

/**
 * 服务器配置 Schema（用于验证）
 */
const McpServerConfigSchema = zod.object({
    name: zod.string().min(1, 'Server name is required'),
    command: zod.string().min(1, 'Command is required'),
    args: zod.array(zod.string()).optional(),
    env: zod.record(zod.string(), zod.string()).optional(),
    cwd: zod.string().optional(),
    timeout: zod.number().positive().optional(),
    autoConnect: zod.boolean().optional(),
    disabled: zod.boolean().optional(),
});

/**
 * Claude Desktop/Cursor 格式服务器配置（不包含 name）
 */
const ClaudeDesktopServerSchema = zod.object({
    command: zod.string().min(1, 'Command is required'),
    args: zod.array(zod.string()).optional(),
    env: zod.record(zod.string(), zod.string()).optional(),
    cwd: zod.string().optional(),
    timeout: zod.number().positive().optional(),
    autoConnect: zod.boolean().optional(),
    disabled: zod.boolean().optional(),
});

/**
 * 标准配置格式 Schema
 */
const StandardConfigSchema = zod.object({
    mcpServers: zod.array(McpServerConfigSchema),
});

/**
 * Claude Desktop/Cursor 格式 Schema（对象形式）
 */
const ClaudeDesktopConfigSchema = zod.object({
    mcpServers: zod.record(zod.string(), ClaudeDesktopServerSchema),
});

/**
 * 简化格式 Schema（直接数组）
 */
const ArrayConfigSchema = zod.array(McpServerConfigSchema);

/**
 * 加载 MCP 配置
 *
 * @param configPath 配置文件路径（可选，默认自动搜索）
 * @returns MCP 配置
 */
export function loadMcpConfig(configPath?: string): McpConfig {
    const logger = getLogger();

    // 确定配置文件路径
    const resolvedPath = configPath ? resolve(configPath) : findConfigFile();

    if (!resolvedPath) {
        logger.debug('[MCP] No config file found');
        return { mcpServers: [] };
    }

    logger.info('[MCP] Loading config', { path: resolvedPath });

    try {
        const content = readFileSync(resolvedPath, 'utf8');
        const rawConfig = JSON.parse(content);

        // 解析并标准化配置
        const config = parseConfig(rawConfig);

        // 解析环境变量
        config.mcpServers = config.mcpServers.map((server) => resolveEnvVariables(server));

        // 过滤禁用的服务器
        const enabledServers = config.mcpServers.filter((server) => !server.disabled);

        logger.info('[MCP] Config loaded', {
            totalServers: config.mcpServers.length,
            enabledServers: enabledServers.length,
        });

        return { mcpServers: enabledServers };
    } catch (error) {
        logger.error('[MCP] Failed to load config', error as Error, { path: resolvedPath });
        return { mcpServers: [] };
    }
}

/**
 * 查找配置文件
 */
function findConfigFile(): string | null {
    for (const searchPath of CONFIG_SEARCH_PATHS) {
        const fullPath = resolve(process.cwd(), searchPath);
        if (existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}

/**
 * 解析配置（支持多种格式）
 */
function parseConfig(rawConfig: unknown): McpConfig {
    // 尝试标准格式
    const standardResult = StandardConfigSchema.safeParse(rawConfig);
    if (standardResult.success) {
        return standardResult.data;
    }

    // 尝试 Claude Desktop/Cursor 格式（对象形式）
    const claudeResult = ClaudeDesktopConfigSchema.safeParse(rawConfig);
    if (claudeResult.success) {
        const servers = Object.entries(claudeResult.data.mcpServers).map(([name, config]) => ({
            ...config,
            name,
        }));
        return { mcpServers: servers };
    }

    // 尝试简化格式（直接数组）
    const arrayResult = ArrayConfigSchema.safeParse(rawConfig);
    if (arrayResult.success) {
        return { mcpServers: arrayResult.data };
    }

    // 无法识别的格式
    getLogger().warn('[MCP] Unknown config format, returning empty config');
    return { mcpServers: [] };
}

/**
 * 解析环境变量
 *
 * 支持 ${VAR_NAME} 和 ${VAR_NAME:-default} 格式
 */
function resolveEnvVariables(config: McpServerConfig): McpServerConfig {
    const resolved = { ...config };

    // 解析 env 中的环境变量
    if (resolved.env) {
        resolved.env = Object.fromEntries(
            Object.entries(resolved.env).map(([key, value]) => {
                return [key, resolveEnvValue(value)];
            })
        );
    }

    // 解析 args 中的环境变量
    if (resolved.args) {
        resolved.args = resolved.args.map((arg) => resolveEnvValue(arg));
    }

    return resolved;
}

/**
 * 解析单个环境变量值
 */
function resolveEnvValue(value: string): string {
    // 匹配 ${VAR_NAME} 或 ${VAR_NAME:-default}
    const envVarPattern = /\$\{([^}]+)\}/g;

    return value.replace(envVarPattern, (match, expr) => {
        // 检查是否有默认值
        const colonIndex = expr.indexOf(':-');

        if (colonIndex !== -1) {
            const varName = expr.slice(0, colonIndex);
            const defaultValue = expr.slice(colonIndex + 2);
            return process.env[varName] || defaultValue;
        }

        // 没有默认值
        const varValue = process.env[expr];
        if (varValue === undefined) {
            getLogger().warn('[MCP] Environment variable not found', { var: expr });
            return match; // 保留原始值
        }
        return varValue;
    });
}

/**
 * 验证服务器配置
 */
export function validateServerConfig(config: McpServerConfig): boolean {
    const result = McpServerConfigSchema.safeParse(config);
    if (!result.success) {
        getLogger().error('[MCP] Invalid server config', undefined, {
            name: config.name,
            errors: result.error.issues,
        });
        return false;
    }
    return true;
}

/**
 * 获取配置文件搜索路径列表
 */
export function getConfigSearchPaths(): string[] {
    return CONFIG_SEARCH_PATHS.map((p) => resolve(process.cwd(), p));
}
