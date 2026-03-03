/**
 * MCP 管理器
 *
 * 管理多个 MCP 服务器连接，协调工具注册
 */

import { getLogger, Logger } from '../logger';
import { McpClient } from './client';
import { McpToolAdapter, createToolAdapters } from './tool-adapter';
import { loadMcpConfig } from './config-loader';
import { ConnectionState } from './types';
import type { McpServerConfig, McpConnectionInfo } from './types';
import type { ToolRegistry } from '../tool/registry';

/**
 * MCP 管理器配置
 */
export interface McpManagerConfig {
    /** 工具注册表（可选，用于自动注册工具） */
    toolRegistry?: ToolRegistry;
    /** 配置文件路径（可选） */
    configPath?: string;
}

/**
 * MCP 管理器
 *
 * 单例模式，管理所有 MCP 服务器连接
 */
export class McpManager {
    /** 单例实例 */
    private static instance: McpManager | null = null;

    /** 所有客户端 */
    private readonly clients: Map<string, McpClient> = new Map();

    /** 连接信息 */
    private readonly connectionInfo: Map<string, McpConnectionInfo> = new Map();

    /** 工具适配器 */
    private readonly toolAdapters: Map<string, McpToolAdapter[]> = new Map();

    /** 工具注册表 */
    private toolRegistry?: ToolRegistry;

    /** 日志器 */
    private readonly logger: Logger;

    /** 是否已初始化 */
    private initialized = false;

    constructor() {
        this.logger = getLogger();
    }

    /**
     * 获取单例实例
     */
    static getInstance(): McpManager {
        if (!McpManager.instance) {
            McpManager.instance = new McpManager();
        }
        return McpManager.instance;
    }

    /**
     * 重置单例（用于测试）
     */
    static resetInstance(): void {
        if (McpManager.instance) {
            McpManager.instance.disconnectAll().catch(() => {});
            McpManager.instance = null;
        }
    }

    /**
     * 初始化管理器
     */
    async initialize(config?: McpManagerConfig): Promise<void> {
        if (config?.toolRegistry) {
            this.setToolRegistry(config.toolRegistry);
        }

        if (this.initialized) {
            this.logger.debug('[MCP] Manager already initialized');
            return;
        }

        await this.loadAndConnect(config?.configPath);
        this.initialized = true;
    }

    /**
     * 加载配置并连接所有服务器
     */
    async loadAndConnect(configPath?: string): Promise<void> {
        const config = loadMcpConfig(configPath);
        const serversToConnect = config.mcpServers.filter((server) => server.autoConnect !== false);

        if (serversToConnect.length === 0) {
            this.logger.info('[MCP] No servers configured');
            return;
        }

        this.logger.info('[MCP] Connecting to servers', {
            count: serversToConnect.length,
        });

        // 并行连接所有服务器
        const results = await Promise.allSettled(
            serversToConnect.map((serverConfig) => this.connectServer(serverConfig))
        );

        // 统计结果
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        this.logger.info('[MCP] Connection results', {
            succeeded,
            failed,
            total: results.length,
        });
    }

    /**
     * 连接单个服务器
     */
    async connectServer(config: McpServerConfig): Promise<McpClient> {
        const serverName = config.name;

        // 检查是否已连接
        if (this.clients.has(serverName)) {
            this.logger.warn('[MCP] Server already connected', { serverName });
            return this.clients.get(serverName)!;
        }

        this.logger.info('[MCP] Connecting to server', { serverName });

        // 创建客户端
        const client = new McpClient(config);

        // 监听状态变更
        client.on('stateChanged', (data: { previousState: ConnectionState; newState: ConnectionState }) => {
            this.updateConnectionInfo(serverName, client, data.newState);
        });

        // 监听错误
        client.on('error', (data: { error: Error; context?: string }) => {
            this.logger.error('[MCP] Server error', data.error, { serverName, context: data.context });
        });

        // 更新初始状态
        this.updateConnectionInfo(serverName, client, ConnectionState.CONNECTING);

        try {
            // 建立连接
            await client.connect();

            // 创建工具适配器
            const adapters = createToolAdapters(client, client.tools, serverName);
            this.syncServerTools(serverName, adapters);

            // 更新连接信息
            this.updateConnectionInfo(serverName, client, client.state);

            // 存储客户端
            this.clients.set(serverName, client);

            return client;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.logger.error('[MCP] Failed to connect to server', error as Error, { serverName });

            // 更新错误状态
            this.updateConnectionInfo(serverName, client, ConnectionState.ERROR, errorMessage);
            await client.disconnect().catch(() => {});

            throw error;
        }
    }

    /**
     * 断开单个服务器
     */
    async disconnectServer(serverName: string): Promise<void> {
        const client = this.clients.get(serverName);

        if (!client) {
            this.logger.warn('[MCP] Server not found', { serverName });
            return;
        }

        this.logger.info('[MCP] Disconnecting from server', { serverName });

        // 从注册表移除该服务器的 MCP 工具
        const adapters = this.toolAdapters.get(serverName) ?? [];
        if (this.toolRegistry && adapters.length > 0) {
            this.toolRegistry.unregister(adapters.map((adapter) => adapter.name));
        }

        // 断开连接
        await client.disconnect();

        // 移除客户端
        this.clients.delete(serverName);

        // 移除工具适配器
        this.toolAdapters.delete(serverName);

        // 更新连接信息
        this.connectionInfo.delete(serverName);
    }

    /**
     * 断开所有服务器
     */
    async disconnectAll(): Promise<void> {
        this.logger.info('[MCP] Disconnecting from all servers', {
            count: this.clients.size,
        });

        const disconnectPromises = Array.from(this.clients.keys()).map((serverName) =>
            this.disconnectServer(serverName)
        );

        await Promise.allSettled(disconnectPromises);
        this.initialized = false;
    }

    /**
     * 刷新服务器工具列表
     */
    async refreshServerTools(serverName: string): Promise<void> {
        const client = this.clients.get(serverName);

        if (!client) {
            this.logger.warn('[MCP] Server not found for refresh', { serverName });
            return;
        }

        try {
            // 获取最新工具列表
            const tools = await client.refreshTools();

            // 重新创建适配器
            const adapters = createToolAdapters(client, tools, serverName);
            this.syncServerTools(serverName, adapters);

            // 更新连接信息
            this.updateConnectionInfo(serverName, client, client.state);

            this.logger.info('[MCP] Tools refreshed', {
                serverName,
                toolCount: tools.length,
            });
        } catch (error) {
            this.logger.error('[MCP] Failed to refresh tools', error as Error, { serverName });
        }
    }

    /**
     * 获取所有连接信息
     */
    getConnectionInfo(): McpConnectionInfo[] {
        return Array.from(this.connectionInfo.values());
    }

    /**
     * 获取已连接的服务器列表
     */
    getConnectedServers(): string[] {
        return Array.from(this.clients.entries())
            .filter(([, client]) => client.state === ConnectionState.READY)
            .map(([name]) => name);
    }

    /**
     * 获取工具总数
     */
    getTotalToolsCount(): number {
        let total = 0;
        for (const adapters of this.toolAdapters.values()) {
            total += adapters.length;
        }
        return total;
    }

    /**
     * 获取所有工具适配器
     */
    getAllToolAdapters(): McpToolAdapter[] {
        const allAdapters: McpToolAdapter[] = [];
        for (const adapters of this.toolAdapters.values()) {
            allAdapters.push(...adapters);
        }
        return allAdapters;
    }

    /**
     * 设置工具注册表
     */
    setToolRegistry(registry: ToolRegistry): void {
        this.toolRegistry = registry;
        this.syncAllToolsToRegistry();
    }

    // ==================== 私有方法 ====================

    /**
     * 更新连接信息
     */
    private updateConnectionInfo(serverName: string, client: McpClient, state: ConnectionState, error?: string): void {
        const previous = this.connectionInfo.get(serverName);
        const preservedError = state === ConnectionState.READY ? undefined : previous?.error;
        this.connectionInfo.set(serverName, {
            serverName,
            state,
            toolsCount: client.tools.length,
            error: error ?? preservedError,
            lastUpdated: new Date().toISOString(),
        });
    }

    /**
     * 同步单个服务器的工具到本地缓存和工具注册表
     */
    private syncServerTools(serverName: string, adapters: McpToolAdapter[]): void {
        const previousAdapters = this.toolAdapters.get(serverName) ?? [];
        this.toolAdapters.set(serverName, adapters);

        if (!this.toolRegistry) {
            return;
        }

        const previousNames = new Set(previousAdapters.map((adapter) => adapter.name));
        const currentNames = new Set(adapters.map((adapter) => adapter.name));
        const removedNames = Array.from(previousNames).filter((name) => !currentNames.has(name));

        if (removedNames.length > 0) {
            this.toolRegistry.unregister(removedNames);
        }

        if (adapters.length > 0) {
            try {
                this.toolRegistry.upsert(adapters);
            } catch (error) {
                this.logger.error('[MCP] Failed to synchronize tools into registry', error as Error, {
                    serverName,
                    toolCount: adapters.length,
                });
            }
        }

        this.logger.info('[MCP] Tools synchronized', {
            serverName,
            totalTools: adapters.length,
            removedTools: removedNames.length,
        });
    }

    /**
     * 将所有已缓存工具同步到当前注册表
     */
    private syncAllToolsToRegistry(): void {
        if (!this.toolRegistry) {
            return;
        }

        for (const [serverName, adapters] of this.toolAdapters.entries()) {
            this.syncServerTools(serverName, adapters);
        }
    }
}

/**
 * 初始化 MCP
 *
 * 便捷函数，用于在应用启动时初始化 MCP
 *
 * @param toolRegistry 工具注册表
 * @param configPath 配置文件路径（可选）
 */
export async function initializeMcp(toolRegistry?: ToolRegistry, configPath?: string): Promise<McpManager> {
    const manager = McpManager.getInstance();
    await manager.initialize({ toolRegistry, configPath });
    return manager;
}

/**
 * 断开所有 MCP 连接
 */
export async function disconnectMcp(): Promise<void> {
    const manager = McpManager.getInstance();
    await manager.disconnectAll();
}
