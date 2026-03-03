/**
 * MCP 客户端
 *
 * 实现与 MCP 服务器的通信协议，基于 JSON-RPC 2.0
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import {
    ConnectionState,
    DEFAULT_REQUEST_TIMEOUT,
    MCP_CLIENT_CAPABILITIES,
    MCP_CLIENT_INFO,
    MCP_PROTOCOL_VERSION,
    McpClientEvent,
} from './types';
import type {
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcNotification,
    InitializeParams,
    InitializeResult,
    ToolsListResponse,
    ToolCallRequest,
    ToolCallResponse,
    McpServerConfig,
    McpTool,
} from './types';
import { getLogger, Logger } from '../logger';

/**
 * 待处理请求
 */
interface PendingRequest {
    resolve: (response: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

/**
 * MCP 客户端
 *
 * 负责与单个 MCP 服务器通信，管理连接生命周期
 */
export class McpClient extends EventEmitter {
    /** 服务器配置 */
    readonly config: McpServerConfig;

    /** 子进程 */
    private process: ChildProcess | null = null;

    /** 连接状态 */
    private _state: ConnectionState = ConnectionState.DISCONNECTED;

    /** 请求 ID 计数器 */
    private requestId = 0;

    /** 待处理请求映射 */
    private pendingRequests: Map<string, PendingRequest> = new Map();

    /** 缓存的工具列表 */
    private _tools: McpTool[] = [];

    /** 接收缓冲区 */
    private buffer = '';

    /** 日志器 */
    private readonly logger: Logger;

    /** 默认请求超时时间 */
    private readonly requestTimeout: number;

    constructor(config: McpServerConfig) {
        super();
        this.config = config;
        this.logger = getLogger();
        this.requestTimeout = config.timeout ?? DEFAULT_REQUEST_TIMEOUT;
    }

    /**
     * 获取当前连接状态
     */
    get state(): ConnectionState {
        return this._state;
    }

    /**
     * 获取缓存的工具列表
     */
    get tools(): McpTool[] {
        return this._tools;
    }

    /**
     * 建立连接
     */
    async connect(): Promise<void> {
        if (this._state !== ConnectionState.DISCONNECTED) {
            throw new Error(`Cannot connect: current state is ${this._state}`);
        }

        this.setState(ConnectionState.CONNECTING);

        try {
            await this.spawnProcess();
            this.setState(ConnectionState.CONNECTED);

            await this.initialize();
            this.setState(ConnectionState.READY);

            // 获取工具列表
            await this.refreshTools();
        } catch (error) {
            this.setState(ConnectionState.ERROR);
            throw error;
        }
    }

    /**
     * 断开连接
     */
    async disconnect(): Promise<void> {
        if (this.process) {
            // 发送 shutdown 请求（可选）
            try {
                await this.sendRequest('shutdown', {});
                this.sendNotification('exit', {});
            } catch {
                // 忽略关闭时的错误
            }

            // 强制终止进程
            this.process.kill();
            this.process = null;
        }

        // 清理待处理请求
        this.rejectAllPendingRequests(new Error('Connection closed'));
        this.buffer = '';
        this._tools = [];
        this.setState(ConnectionState.DISCONNECTED);

        // 移除所有事件监听器，确保进程可以退出
        this.removeAllListeners();
    }

    /**
     * 列出可用工具
     */
    async listTools(cursor?: string): Promise<ToolsListResponse> {
        const response = await this.sendRequest<ToolsListResponse>('tools/list', cursor ? { cursor } : {});
        return response.result!;
    }

    /**
     * 调用工具
     */
    async callTool(request: ToolCallRequest): Promise<ToolCallResponse> {
        const response = await this.sendRequest<ToolCallResponse>('tools/call', request);
        return response.result!;
    }

    /**
     * 刷新工具列表
     */
    async refreshTools(): Promise<McpTool[]> {
        const allTools: McpTool[] = [];
        let cursor: string | undefined;

        do {
            const response = await this.listTools(cursor);
            allTools.push(...response.tools);
            cursor = response.nextCursor;
        } while (cursor);

        this._tools = allTools;
        this.emit(McpClientEvent.TOOLS_CHANGED as string, allTools);
        return allTools;
    }

    // ==================== 私有方法 ====================

    /**
     * 启动子进程
     */
    private async spawnProcess(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                const isWindows = process.platform === 'win32';

                this.process = spawn(this.config.command, this.config.args || [], {
                    cwd: this.config.cwd,
                    env: { ...process.env, ...this.config.env },
                    shell: isWindows,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
                    throw new Error('Failed to create stdio streams');
                }

                // 处理标准输出
                this.process.stdout.setEncoding('utf8');
                this.process.stdout.on('data', (data: string) => {
                    this.handleStdout(data);
                });

                // 处理标准错误
                this.process.stderr.setEncoding('utf8');
                this.process.stderr.on('data', (data: string) => {
                    this.logger.debug('[MCP] stderr', { server: this.config.name, data: data.trim() });
                });

                // 处理进程错误
                this.process.on('error', (error: Error) => {
                    this.handleError(error, 'process');
                });

                // 处理进程退出
                this.process.on('close', (code: number | null, signal: string | null) => {
                    this.handleClose(code, signal);
                });

                // 等待进程启动
                setImmediate(() => {
                    if (this.process && this.process.pid) {
                        resolve();
                    } else {
                        reject(new Error('Failed to start MCP server process'));
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 执行初始化握手
     */
    private async initialize(): Promise<InitializeResult> {
        this.setState(ConnectionState.INITIALIZING);

        const params: InitializeParams = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: MCP_CLIENT_CAPABILITIES,
            clientInfo: MCP_CLIENT_INFO,
        };

        const response = await this.sendRequest<InitializeResult>('initialize', params);

        // 发送 initialized 通知
        this.sendNotification('notifications/initialized', {});

        return response.result!;
    }

    /**
     * 发送请求
     */
    private sendRequest<T = unknown>(method: string, params?: unknown): Promise<JsonRpcResponse<T>> {
        return new Promise<JsonRpcResponse<T>>((resolve, reject) => {
            if (!this.process || !this.process.stdin) {
                reject(new Error('MCP server process not running'));
                return;
            }

            const id = this.nextRequestId();
            const request: JsonRpcRequest = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };

            // 设置超时
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(String(id));
                reject(new Error(`Request timeout: ${method} (${this.requestTimeout}ms)`));
            }, this.requestTimeout);

            // 存储待处理请求
            this.pendingRequests.set(String(id), {
                resolve: resolve as (response: JsonRpcResponse) => void,
                reject,
                timeout,
            });

            // 发送请求
            this.sendMessage(request);
        });
    }

    /**
     * 发送通知（无需响应）
     */
    private sendNotification(method: string, params?: unknown): void {
        if (!this.process || !this.process.stdin) {
            return;
        }

        const notification: JsonRpcNotification = {
            jsonrpc: '2.0',
            method,
            params,
        };

        this.sendMessage(notification);
    }

    /**
     * 发送消息
     */
    private sendMessage(message: JsonRpcRequest | JsonRpcNotification): void {
        if (!this.process || !this.process.stdin) {
            return;
        }

        const data = JSON.stringify(message);
        this.logger.debug('[MCP] Sending', {
            server: this.config.name,
            method: 'method' in message ? message.method : 'notification',
        });

        this.process.stdin.write(data + '\n');
    }

    /**
     * 处理标准输出
     */
    private handleStdout(data: string): void {
        this.buffer += data;

        // 按行解析消息
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    this.handleMessage(message);
                } catch {
                    this.logger.warn('[MCP] Failed to parse message', {
                        server: this.config.name,
                        line: line.slice(0, 200),
                    });
                }
            }
        }
    }

    /**
     * 处理接收到的消息
     */
    private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
        // 响应消息
        if ('id' in message && ('result' in message || 'error' in message)) {
            this.handleResponse(message as JsonRpcResponse);
            return;
        }

        // 通知消息
        if ('method' in message && !('id' in message)) {
            this.handleNotification(message as JsonRpcNotification);
            return;
        }

        this.logger.warn('[MCP] Unknown message type', {
            server: this.config.name,
            message,
        });
    }

    /**
     * 处理响应
     */
    private handleResponse(response: JsonRpcResponse): void {
        const pending = this.pendingRequests.get(String(response.id));

        if (!pending) {
            this.logger.warn('[MCP] Received response for unknown request', {
                server: this.config.name,
                id: response.id,
            });
            return;
        }

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(String(response.id));

        if (response.error) {
            const error = new Error(`MCP Error [${response.error.code}]: ${response.error.message}`);
            pending.reject(error);
        } else {
            pending.resolve(response);
        }
    }

    /**
     * 处理通知
     */
    private handleNotification(notification: JsonRpcNotification): void {
        this.logger.debug('[MCP] Notification', {
            server: this.config.name,
            method: notification.method,
        });

        // 发出通知事件
        this.emit(McpClientEvent.NOTIFICATION as string, notification);

        // 处理工具列表变更
        if (notification.method === 'notifications/tools/list_changed') {
            this.refreshTools().catch((error) => {
                this.handleError(error, 'refresh_tools');
            });
        }
    }

    /**
     * 处理错误
     */
    private handleError(error: Error, context?: string): void {
        this.logger.error('[MCP] Error', error, { server: this.config.name, context });

        this.emit(McpClientEvent.ERROR as string, {
            error,
            serverName: this.config.name,
            context,
        });

        // 如果是进程错误，设置错误状态
        if (context === 'process') {
            this.setState(ConnectionState.ERROR);
            this.rejectAllPendingRequests(error);
        }
    }

    /**
     * 处理进程关闭
     */
    private handleClose(code: number | null, signal: string | null): void {
        this.logger.info('[MCP] Process closed', { server: this.config.name, code, signal });

        this.emit(McpClientEvent.CLOSE as string, { code, signal });

        // 清理状态
        this.process = null;
        this.setState(ConnectionState.DISCONNECTED);
        this.rejectAllPendingRequests(new Error('MCP server process closed'));
    }

    /**
     * 设置状态
     */
    private setState(newState: ConnectionState): void {
        const previousState = this._state;
        this._state = newState;

        this.emit(McpClientEvent.STATE_CHANGED as string, {
            previousState,
            newState,
            serverName: this.config.name,
        });
    }

    /**
     * 生成下一个请求 ID
     */
    private nextRequestId(): number {
        this.requestId += 1;
        return this.requestId;
    }

    /**
     * 拒绝所有待处理请求
     */
    private rejectAllPendingRequests(error: Error): void {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }
}
