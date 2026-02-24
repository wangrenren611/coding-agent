import BashTool from "./bash";
import GlobTool from "./glob";
import { ReadFileTool, WriteFileTool } from "./file";
import GrepTool from "./grep";
import { SurgicalEditTool } from "./surgical";
import { WebSearchTool } from "./web-search";
import { WebFetchTool } from "./web-fetch";
import { BatchReplaceTool } from "./batch-replace";
import { LspTool } from "./lsp";
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskStopTool, TaskTool, TaskUpdateTool } from "./task";
import { ToolRegistry } from "./registry";
import type { ToolRegistryConfig } from "./registry";
import type { BaseTool } from "./base";
import type { ToolResult } from "./base";
import type { LLMProvider } from "../../providers";
import { z } from "zod";

/**
 * 获取所有默认工具实例
 * @param workingDir 工作目录
 * @param provider LLM 提供者（用于 TaskTool）
 * @returns 所有默认工具的数组
 */
export function getDefaultTools(
    workingDir: string = process.cwd(),
    provider?: LLMProvider
): Array<BaseTool<z.ZodType>> {
    const tools: Array<BaseTool<z.ZodType>> = [
        new BashTool(),
        new GlobTool(),
        new ReadFileTool(),
        new WriteFileTool(),
        new GrepTool(),
        new SurgicalEditTool(),
        new WebSearchTool(),
        new WebFetchTool(),
        new TaskCreateTool(),
        new TaskGetTool(),
        new TaskListTool(),
        new TaskUpdateTool(),
        new TaskStopTool(),
        new BatchReplaceTool(),
        new LspTool(),
    ];

    // TaskTool 需要 provider，只有在有 provider 时才添加
    if (provider) {
        tools.push(new TaskTool(provider, workingDir));
    }

    return tools;
}

/**
 * 创建默认工具注册表
 * @param config 工具注册表配置
 * @param provider LLM 提供者（用于 TaskTool）
 * @returns 配置好的工具注册表
 */
export const createDefaultToolRegistry = (
    config: ToolRegistryConfig,
    provider?: LLMProvider
) => {
    const toolRegistry = new ToolRegistry(config);
    toolRegistry.register(getDefaultTools(config.workingDirectory, provider));
    return toolRegistry;
}

// 导出所有工具类，方便单独使用
export { default as BashTool } from "./bash";
export { default as GlobTool } from "./glob";
export { ReadFileTool, WriteFileTool } from "./file";
export { default as GrepTool } from "./grep";
export { SurgicalEditTool } from "./surgical";
export { WebSearchTool } from "./web-search";
export { WebFetchTool } from "./web-fetch";
export { BatchReplaceTool } from "./batch-replace";
export { LspTool } from "./lsp";
export {
    TaskTool,
    TaskCreateTool,
    TaskGetTool,
    TaskListTool,
    TaskUpdateTool,
    TaskStopTool,
    SubagentType,
} from "./task";
export { ToolRegistry } from "./registry";
export type { ToolRegistryConfig } from "./registry";
export type { BaseTool, ToolResult };
