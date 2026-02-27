import BashTool from './bash';
import GlobTool from './glob';
import { ReadFileTool, WriteFileTool } from './file';
import GrepTool from './grep';
import { SurgicalEditTool } from './surgical';
import { WebSearchTool } from './web-search';
import { WebFetchTool } from './web-fetch';
import { BatchReplaceTool } from './batch-replace';
import { LspTool } from './lsp';
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskOutputTool, TaskStopTool, TaskTool, TaskUpdateTool } from './task';
import { ToolRegistry } from './registry';
import { SkillTool } from '../skill';
import { PlanCreateTool } from '../plan/tools';
import type { ToolRegistryConfig } from './registry';
import type { BaseTool } from './base';
import type { ToolResult } from './base';
import type { LLMProvider } from '../../providers';
import { z } from 'zod';
import { TruncationService, createTruncationMiddleware, type TruncationServiceConfig } from '../truncation';

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
        new TaskOutputTool(),
        new BatchReplaceTool(),
        new LspTool(),
        new SkillTool(),
    ];

    // 添加 Plan 工具
    tools.push(new PlanCreateTool());

    // TaskTool 需要 provider，只有在有 provider 时才添加
    if (provider) {
        tools.push(new TaskTool(provider, workingDir));
    }

    return tools;
}

/**
 * 创建默认工具注册表配置
 */
export interface CreateDefaultToolRegistryConfig extends ToolRegistryConfig {
    /** LLM 提供者（用于 TaskTool） */
    provider?: LLMProvider;
    /** 截断服务配置（可选，传入则启用截断） */
    truncation?: TruncationServiceConfig | boolean;
}

/**
 * 获取 Plan 模式下的只读工具实例
 * Plan 模式只允许使用只读工具和 Plan 相关工具
 * @param workingDir 工作目录
 * @returns Plan 模式允许的工具数组
 */
export function getPlanModeTools(
    workingDir: string = process.cwd(),
    provider?: LLMProvider
): Array<BaseTool<z.ZodType>> {
    const tools: Array<BaseTool<z.ZodType>> = [
        // 文件读取（只读）
        new GlobTool(),
        new ReadFileTool(),
        new GrepTool(),
        new LspTool(),
        // 网络（只读）
        new WebSearchTool(),
        new WebFetchTool(),
        // Task 工具 - 用于探索和分析
        new TaskCreateTool(),
        new TaskGetTool(),
        new TaskListTool(),
        new TaskUpdateTool(),
        new TaskStopTool(),
        new TaskOutputTool(),
        // Skill
        new SkillTool(),
    ];

    // 添加 Plan 工具
    tools.push(new PlanCreateTool());

    // TaskTool 需要 provider
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
    config: ToolRegistryConfig | CreateDefaultToolRegistryConfig,
    provider?: LLMProvider
) => {
    // 兼容旧参数格式
    const registryConfig: ToolRegistryConfig = {
        workingDirectory: config.workingDirectory,
        planBaseDir: config.planBaseDir,
        toolTimeout: config.toolTimeout,
    };
    const actualProvider = 'provider' in config ? config.provider : provider;
    const truncationConfig = 'truncation' in config ? config.truncation : undefined;

    const toolRegistry = new ToolRegistry(registryConfig);
    toolRegistry.register(getDefaultTools(registryConfig.workingDirectory, actualProvider));

    // 如果配置了截断，设置截断中间件
    if (truncationConfig) {
        const truncationService =
            truncationConfig === true
                ? new TruncationService() // 使用默认配置
                : new TruncationService(truncationConfig);

        const middleware = createTruncationMiddleware({ service: truncationService });
        toolRegistry.setTruncationMiddleware(middleware);
    }

    return toolRegistry;
};

/**
 * 创建 Plan 模式专用的工具注册表
 * 只包含只读工具和 Plan 相关工具
 * @param config 工具注册表配置
 * @returns 配置好的 Plan 模式工具注册表
 */
export const createPlanModeToolRegistry = (
    config: ToolRegistryConfig | CreateDefaultToolRegistryConfig,
    provider?: LLMProvider
) => {
    const registryConfig: ToolRegistryConfig = {
        workingDirectory: config.workingDirectory,
        planBaseDir: config.planBaseDir,
        toolTimeout: config.toolTimeout,
    };

    const truncationConfig = 'truncation' in config ? config.truncation : undefined;

    const toolRegistry = new ToolRegistry(registryConfig);
    // 只注册 Plan 模式允许的工具
    toolRegistry.register(getPlanModeTools(registryConfig.workingDirectory, provider));

    // 如果配置了截断，设置截断中间件
    if (truncationConfig) {
        const truncationService =
            truncationConfig === true
                ? new TruncationService() // 使用默认配置
                : new TruncationService(truncationConfig);

        const middleware = createTruncationMiddleware({ service: truncationService });
        toolRegistry.setTruncationMiddleware(middleware);
    }

    return toolRegistry;
};

// 导出所有工具类，方便单独使用
export { default as BashTool } from './bash';
export { default as GlobTool } from './glob';
export { ReadFileTool, WriteFileTool } from './file';
export { default as GrepTool } from './grep';
export { SurgicalEditTool } from './surgical';
export { WebSearchTool } from './web-search';
export { WebFetchTool } from './web-fetch';
export { BatchReplaceTool } from './batch-replace';
export { LspTool } from './lsp';
export {
    TaskTool,
    TaskCreateTool,
    TaskGetTool,
    TaskListTool,
    TaskOutputTool,
    TaskUpdateTool,
    TaskStopTool,
    SubagentType,
} from './task';
export { ToolRegistry } from './registry';
export type { ToolRegistryConfig } from './registry';
export type { BaseTool, ToolResult };

// 导出 Skill 相关
export { SkillTool, createSkillTool, defaultSkillTool } from '../skill';
export type { Skill, SkillMetadata, SkillLoaderOptions, SkillToolResult } from '../skill';

// 导出截断相关
export {
    TruncationService,
    createTruncationMiddleware,
    DEFAULT_TRUNCATION_CONFIG,
    TOOL_TRUNCATION_CONFIGS,
    DefaultTruncationStrategy,
    TruncationStorage,
} from '../truncation';
export type {
    TruncationServiceConfig,
    TruncationMiddleware,
    TruncationMiddlewareConfig,
    TruncationConfig,
    TruncationOptions,
    TruncationContext,
    TruncationResult,
    TruncationEvent,
    TruncationEventCallback,
    ITruncationStorage,
    TruncationStrategy,
} from '../truncation';
