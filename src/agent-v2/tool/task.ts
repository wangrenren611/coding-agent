/**
 * Task Tool - 启动专业代理
 *
 * 用于启动自主处理复杂任务的专业代理（子进程）。
 * 每种代理类型有特定的工具访问权限和能力。
 */

import { BaseTool, ToolResult } from './base';
import { z } from 'zod';
import { Agent } from '../agent/agent';
import { ToolRegistry } from './registry';
import { LLMProvider } from '../../providers';
import GlobTool from './glob';
import GrepTool from './grep';
import { ReadFileTool } from './file';
import type { ToolRegistryConfig } from './registry';
import { WebSearchTool } from './web-search';
import { WebFetchTool } from './web-fetch';

/**
 * 代理类型定义
 */
export enum SubagentType {
    /** 代码库搜索和理解专家，使用 Glob 和 Grep */
    Explore = 'explore',

}

/**
 * 子代理工具类构造函数类型
 */
type ToolClassConstructor = new () => BaseTool<z.ZodType>;

/**
 * 代理配置
 */
interface AgentConfig {
    /** 工具集（使用构造函数，避免实例化问题） */
    tools: ToolClassConstructor[];
    /** 系统提示词 */
    systemPrompt: string;
    /** 最大重试次数（对应 Agent 的 maxRetries） */
    maxRetries?: number;
}

/**
 * 子代理执行结果
 */
interface SubagentResult {
    /** 是否成功 */
    success: boolean;
    /** 执行轮次 */
    turns: number;
    /** 使用的工具列表 */
    toolsUsed: string[];
    /** 最终消息内容 */
    output: string;
}
//   Available agent types:
//   - Bash: Command execution specialist (git, terminal tasks)
//   - general-purpose: Researching complex questions, searching code, multi-step tasks
//   - Explore: Fast agent for exploring codebases (find files by patterns, search keywords, answer questions)
//   - Plan: Software architect agent for designing implementation plans
//   - claude-code-guide: Questions about Claude Code features, Agent SDK, Claude API
//   - ui-sketcher: Transforms requirements into visual ASCII interface designs
//   - bug-analyzer: Debugging specialist for execution flow analysis and root cause investigation
//   - code-reviewer: Elite code review expert for security, performance, production reliability
/**
 * 各类型代理的配置
 */
const AGENT_CONFIGS: Record<SubagentType, AgentConfig> = {
    [SubagentType.Explore]: {
        tools: [GlobTool, GrepTool, ReadFileTool, WebSearchTool,WebFetchTool],
        systemPrompt: `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use Bash for file operations like copying, moving, or listing directory contents
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.
`,
        maxRetries: 5,
    },

  
};

/**
 * Task 工具参数 Schema
 */
const schema = z.object({
    description: z.string().describe("A short (3-5 words) description of the task"),
    prompt: z.string().describe("The task for the agent to perform"),
    subagent_type: z.string().describe("The type of specialized agent to use for this task"),
    max_turns: z.number().int().min(1).max(100).optional().describe('Maximum number of agent turns (optional, defaults to agent type default)'),
});

/**
 * Task 工具描述
 */
const TASK_DESCRIPTION = ` The Task tool launches specialized agents (subprocesses) that autonomously handle complex
tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- Bash: Command execution specialist for running bash commands.
  Use this for git operations, command execution, and other terminal tasks.
  Tools: Bash



- Explore: Fast agent specialized for exploring codebases.
  Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"),
  search code for keywords (eg. "API endpoints"), or answer questions about the codebase
  (eg. "how do API endpoints work?").
  When calling this agent, specify the thoroughness level: "quick" for basic searches,
  "medium" for moderate exploration, or "very thorough" for comprehensive analysis
  across multiple locations and naming conventions.
  Tools: All tools except Task, ExitPlanMode, Edit, Write, NotebookEdit



Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do.
- Launch multiple agents concurrently for maximum performance.
- If you want to read a specific file path, use the Read or Glob tool instead.
- When NOT to use the Task tool: Direct file operations, single-file code searches.
- IMPORTANT: When searching for a keyword or file and you are not confident you will find
  the right match in the first few tries, use the Task tool.

IMPORTANT: Use the Task tool with subagent_type=Explore instead of running search commands
directly when exploring the codebase to gather context or answer questions that are not a
needle query for a specific file/class/function.

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Glob tool instead
- For direct file operations
- For single-file code searches`;

/**
 * TaskTool - 启动专业代理工具
 */
export class TaskTool extends BaseTool<typeof schema> {
    name = 'task';
    description = TASK_DESCRIPTION;
    schema = schema;

    /** LLM 提供者 */
    private provider: LLMProvider;
    /** 默认工作目录 */
    private defaultWorkingDir: string;

    constructor(provider: LLMProvider, workingDir: string = process.cwd()) {
        super();
        this.provider = provider;
        this.defaultWorkingDir = workingDir;
    }

    /**
     * 执行任务代理
     */
    async execute(args: z.infer<typeof this.schema>): Promise<ToolResult> {
        const { subagent_type, prompt, max_turns } = args;

        // 获取代理配置
        const agentType = subagent_type.toLowerCase() as SubagentType;
        const config = AGENT_CONFIGS[agentType];

        if (!config) {
            return this.result({
                success: false,
                metadata: { error: 'INVALID_AGENT_TYPE' } as any,
                output: `Invalid agent type: ${subagent_type}`,
            });
        }

        try {
            // 创建子代理的工具注册表
            const toolRegistry = this.createSubagentRegistry(agentType);

            // 创建子代理
            const subagent = new Agent({
                provider: this.provider,
                systemPrompt: config.systemPrompt,
                toolRegistry,
                maxRetries: max_turns || config.maxRetries || 10,
                stream: false,
            });

            // 执行任务
            const finalMessage = await subagent.execute(prompt);
            const loopCount = subagent.getLoopCount();

            // 收集使用的工具信息
            const toolsUsed = this.extractToolsUsed(finalMessage);

            // 构建结果
            const result: SubagentResult = {
                success: true,
                turns: loopCount,
                toolsUsed,
                output: finalMessage.content || 'Task completed with no output',
            };

            // 返回结果
            return this.result({
                success: true,
                metadata: {
                    agentType,
                    turns: result.turns,
                    toolsUsed: result.toolsUsed,
                } as any,
                output: result.output,
            });

        } catch (error) {
            const err = error as Error;
            return this.result({
                success: false,
                metadata: { error: 'AGENT_EXECUTION_FAILED' } as any,
                output: `Agent execution failed: ${err.message}`,
            });
        }
    }

    /**
     * 创建子代理的工具注册表
     */
    private createSubagentRegistry(agentType: SubagentType): ToolRegistry {
        const config = AGENT_CONFIGS[agentType];
        const registryConfig: ToolRegistryConfig = {
            workingDirectory: this.defaultWorkingDir,
        };

        const registry = new ToolRegistry(registryConfig);

        // 实例化并注册该代理类型允许的工具
        const tools = config.tools.map(ToolClass => new ToolClass());
        registry.register(tools);

        return registry;
    }

    /**
     * 从消息中提取使用的工具列表
     */
    private extractToolsUsed(message: any): string[] {
        const tools = new Set<string>();

        // 从会话消息中提取工具调用
        if (message && typeof message === 'object') {
            // 如果有 tool_calls 信息
            if (Array.isArray(message.tool_calls)) {
                for (const call of message.tool_calls) {
                    if (call.function?.name) {
                        tools.add(call.function.name);
                    }
                }
            }
        }

        return Array.from(tools);
    }
}

export default TaskTool;
