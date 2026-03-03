/**
 * MCP (Model Context Protocol) 类型定义
 *
 * 基于 MCP 规范 2025-03-26
 * @see https://spec.modelcontextprotocol.io/specification/2025-03-26/
 */

// ==================== JSON-RPC 2.0 基础类型 ====================

/**
 * JSON-RPC 版本
 */
export type JsonRpcVersion = '2.0';

/**
 * JSON-RPC 请求 ID 类型
 */
export type JsonRpcId = string | number;

/**
 * JSON-RPC 请求
 */
export interface JsonRpcRequest<T = unknown> {
    jsonrpc: JsonRpcVersion;
    id: JsonRpcId;
    method: string;
    params?: T;
}

/**
 * JSON-RPC 响应
 */
export interface JsonRpcResponse<T = unknown> {
    jsonrpc: JsonRpcVersion;
    id: JsonRpcId;
    result?: T;
    error?: JsonRpcError;
}

/**
 * JSON-RPC 错误
 */
export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

/**
 * JSON-RPC 通知（无需响应）
 */
export interface JsonRpcNotification<T = unknown> {
    jsonrpc: JsonRpcVersion;
    method: string;
    params?: T;
}

// ==================== MCP 标准错误码 ====================

/**
 * MCP 标准错误码
 * @see https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/messages/#error-codes
 */
export const McpErrorCodes = {
    // JSON-RPC 标准错误
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    // MCP 特定错误
    RESOURCE_NOT_FOUND: -32001,
    RESOURCE_TEMPORARILY_UNAVAILABLE: -32002,
    PROMPT_NOT_FOUND: -32003,
    TOOL_NOT_FOUND: -32004,
    TOOL_EXECUTION_ERROR: -32005,
    INVALID_TOOL_INPUT: -32006,
} as const;

// ==================== 初始化相关 ====================

/**
 * 客户端能力
 */
export interface ClientCapabilities {
    experimental?: Record<string, unknown>;
    roots?: {
        listChanged?: boolean;
    };
    /** 按 MCP 规范为对象类型；不支持时应省略该字段 */
    sampling?: Record<string, unknown>;
}

/**
 * 服务器能力
 */
export interface ServerCapabilities {
    experimental?: Record<string, unknown>;
    logging?: boolean;
    prompts?: {
        listChanged?: boolean;
    };
    resources?: {
        subscribe?: boolean;
        listChanged?: boolean;
    };
    tools?: {
        listChanged?: boolean;
    };
}

/**
 * 实现信息
 */
export interface Implementation {
    name: string;
    version: string;
}

/**
 * 初始化请求参数
 */
export interface InitializeParams {
    protocolVersion: string;
    capabilities: ClientCapabilities;
    clientInfo: Implementation;
}

/**
 * 初始化响应结果
 */
export interface InitializeResult {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    serverInfo: Implementation;
    instructions?: string;
}

// ==================== 工具相关 ====================

/**
 * JSON Schema 定义
 */
export interface JsonSchema {
    type?: string | string[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    enum?: (string | number | boolean | null)[];
    anyOf?: JsonSchema[];
    allOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    description?: string;
    default?: unknown;
    format?: string;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    additionalProperties?: boolean | JsonSchema;
    $ref?: string;
    [key: string]: unknown;
}

/**
 * 工具定义
 */
export interface McpTool {
    /** 工具名称 */
    name: string;
    /** 工具描述 */
    description?: string;
    /** 输入参数 Schema */
    inputSchema: JsonSchema;
    /** 输出 Schema (可选) */
    outputSchema?: JsonSchema;
    /** 标题 (可选) */
    title?: string;
}

/**
 * 工具列表请求参数
 */
export interface ToolsListParams {
    cursor?: string;
}

/**
 * 工具列表响应
 */
export interface ToolsListResponse {
    tools: McpTool[];
    nextCursor?: string;
}

/**
 * 工具调用请求
 */
export interface ToolCallRequest {
    name: string;
    arguments?: Record<string, unknown>;
}

/**
 * 工具调用响应
 */
export interface ToolCallResponse {
    content: ToolContent[];
    isError?: boolean;
}

/**
 * 工具内容类型
 */
export type ToolContent = TextContent | ImageContent | ResourceContent;

/**
 * 文本内容
 */
export interface TextContent {
    type: 'text';
    text: string;
}

/**
 * 图片内容
 */
export interface ImageContent {
    type: 'image';
    data: string;
    mimeType: string;
}

/**
 * 资源内容
 */
export interface ResourceContent {
    type: 'resource';
    resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
    };
}

/**
 * 工具列表变更通知
 */
export interface ToolListChangedNotification {
    method: 'notifications/tools/list_changed';
}

// ==================== 服务器配置 ====================

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
    /** 服务器名称（唯一标识） */
    name: string;
    /** 启动命令 */
    command: string;
    /** 命令参数 */
    args?: string[];
    /** 环境变量 */
    env?: Record<string, string>;
    /** 工作目录 */
    cwd?: string;
    /** 请求超时时间（毫秒，默认 120000） */
    timeout?: number;
    /** 是否在启动时自动连接（默认 true） */
    autoConnect?: boolean;
    /** 启动失败时是否禁用（默认 false） */
    disabled?: boolean;
}

/**
 * MCP 配置文件格式
 */
export interface McpConfig {
    /** MCP 服务器列表 */
    mcpServers: McpServerConfig[];
}

// ==================== 连接状态 ====================

/**
 * 连接状态枚举
 */
export enum ConnectionState {
    /** 已断开 */
    DISCONNECTED = 'disconnected',
    /** 正在连接 */
    CONNECTING = 'connecting',
    /** 已连接 */
    CONNECTED = 'connected',
    /** 初始化中 */
    INITIALIZING = 'initializing',
    /** 就绪（可使用） */
    READY = 'ready',
    /** 错误状态 */
    ERROR = 'error',
}

/**
 * 连接信息
 */
export interface McpConnectionInfo {
    /** 服务器名称 */
    serverName: string;
    /** 连接状态 */
    state: ConnectionState;
    /** 可用工具数量 */
    toolsCount: number;
    /** 错误信息（如果有） */
    error?: string;
    /** 服务器信息 */
    serverInfo?: Implementation;
    /** 服务器能力 */
    capabilities?: ServerCapabilities;
    /** 最后更新时间 */
    lastUpdated: string;
}

// ==================== 事件类型 ====================

/**
 * MCP 客户端事件
 */
export enum McpClientEvent {
    /** 状态变更 */
    STATE_CHANGED = 'stateChanged',
    /** 工具列表变更 */
    TOOLS_CHANGED = 'toolsChanged',
    /** 错误发生 */
    ERROR = 'error',
    /** 连接关闭 */
    CLOSE = 'close',
    /** 收到通知 */
    NOTIFICATION = 'notification',
}

/**
 * 状态变更事件数据
 */
export interface StateChangedEventData {
    previousState: ConnectionState;
    newState: ConnectionState;
    serverName: string;
}

/**
 * 错误事件数据
 */
export interface ErrorEventData {
    error: Error;
    serverName: string;
    context?: string;
}

// ==================== 工具适配器相关 ====================

/**
 * MCP 工具适配器元数据
 */
export interface McpToolMetadata {
    /** 原始工具名称 */
    originalName: string;
    /** 服务器名称 */
    serverName: string;
    /** 服务器配置 */
    serverConfig: McpServerConfig;
}

// ==================== 常量 ====================

/**
 * MCP 协议版本
 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * 默认请求超时时间（毫秒）
 */
export const DEFAULT_REQUEST_TIMEOUT = 120000; // 2 分钟

/**
 * MCP 客户端信息
 */
export const MCP_CLIENT_INFO: Implementation = {
    name: 'coding-agent',
    version: '1.0.0',
};

/**
 * MCP 客户端能力
 */
export const MCP_CLIENT_CAPABILITIES: ClientCapabilities = {
    roots: {
        listChanged: true,
    },
    sampling: {},
};
