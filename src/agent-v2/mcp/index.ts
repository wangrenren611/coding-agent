/**
 * MCP 模块公共 API
 */

export { McpClient } from './client';
export { McpManager } from './manager';
export { McpToolAdapter, createToolAdapters } from './tool-adapter';
export { loadMcpConfig, validateServerConfig, getConfigSearchPaths } from './config-loader';
export { jsonSchemaToZod } from './json-schema-to-zod';

// 类型导出
export type {
    McpConfig,
    McpServerConfig,
    McpConnectionInfo,
    ConnectionState,
    McpErrorCodes,
    McpClientEvent,
    McpToolMetadata,
    JsonSchema,
    InitializeParams,
    InitializeResult,
    ToolsListParams,
    ToolCallRequest,
    ToolCallResponse,
    ToolContent,
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcError,
    JsonRpcNotification,
    McpTool,
} from './types';

export type { McpManagerConfig } from './manager';

// 常量导出
export { MCP_PROTOCOL_VERSION, DEFAULT_REQUEST_TIMEOUT, MCP_CLIENT_INFO, MCP_CLIENT_CAPABILITIES } from './types';

// 枚举导出
export { ConnectionState as ConnectionStateEnum, McpClientEvent as McpClientEventEnum } from './types';
