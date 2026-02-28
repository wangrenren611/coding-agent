import { z } from 'zod';
import BashTool from '../bash';
import GlobTool from '../glob';
import GrepTool from '../grep';
import { ReadFileTool, WriteFileTool } from '../file';
import { SurgicalEditTool } from '../surgical';
import { BatchReplaceTool } from '../batch-replace';
import { LspTool } from '../lsp';
import { WebSearchTool } from '../web-search';
import { WebFetchTool } from '../web-fetch';
import { AgentConfig, SubagentType } from './shared';

export const SubagentTypeSchema = z.enum([
    SubagentType.Bash,
    SubagentType.GeneralPurpose,
    SubagentType.Explore,
    SubagentType.Plan,
    SubagentType.UiSketcher,
    SubagentType.BugAnalyzer,
    SubagentType.CodeReviewer,
]);

/** 默认空闲超时：3 分钟 */
const DEFAULT_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
/** 长时间任务空闲超时：10 分钟 */
const LONG_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** 中等任务空闲超时：5 分钟 */
const MEDIUM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export const AGENT_CONFIGS: Record<SubagentType, AgentConfig> = {
    [SubagentType.Bash]: {
        tools: [BashTool],
        systemPrompt: `You are a shell execution specialist.
Run commands safely and explain outcomes clearly.
Prefer concise outputs and avoid unrelated work.`,
        maxRetries: 5,
        // Bash 命令通常执行较快
        idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    },
    [SubagentType.GeneralPurpose]: {
        tools: [
            BashTool,
            GlobTool,
            GrepTool,
            ReadFileTool,
            WriteFileTool,
            SurgicalEditTool,
            BatchReplaceTool,
            LspTool,
            WebSearchTool,
            WebFetchTool,
        ],
        systemPrompt: `You are a general software engineering sub-agent.
Handle multi-step tasks pragmatically, verify your work, and keep responses concise.`,
        maxRetries: 10,
        // 通用任务可能需要较长时间
        idleTimeoutMs: MEDIUM_IDLE_TIMEOUT_MS,
    },
    [SubagentType.Explore]: {
        tools: [GlobTool, GrepTool, ReadFileTool, WebSearchTool, WebFetchTool],
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

Your responses should be:
- Comprehensive yet concise, focusing on the most relevant information
- Well-structured with clear headings and bullet points when appropriate
- Transparent about sources and the recency of information


Complete the user's search request efficiently and report your findings clearly.
`,
        maxRetries: 20,
        // 探索任务需要遍历大量文件，使用更长的超时
        idleTimeoutMs: LONG_IDLE_TIMEOUT_MS,
    },
    [SubagentType.Plan]: {
        tools: [GlobTool, GrepTool, ReadFileTool, LspTool, WebSearchTool, WebFetchTool],
        systemPrompt: `You are a software architecture planner.
Produce concrete implementation plans with tradeoffs, risks, and sequencing.`,
        maxRetries: 8,
        // 规划任务需要读取和分析
        idleTimeoutMs: MEDIUM_IDLE_TIMEOUT_MS,
    },
    [SubagentType.UiSketcher]: {
        tools: [BashTool, GlobTool, GrepTool, ReadFileTool, WebSearchTool, WebFetchTool],
        systemPrompt: `You are a UI sketching specialist.
Translate requirements into clear, textual interface concepts and layout structures.`,
        maxRetries: 6,
        // UI 规划任务
        idleTimeoutMs: MEDIUM_IDLE_TIMEOUT_MS,
    },
    [SubagentType.BugAnalyzer]: {
        tools: [BashTool, GlobTool, GrepTool, ReadFileTool, WriteFileTool, LspTool],
        systemPrompt: `You are a debugging specialist.
Trace execution paths, identify root causes, and propose minimal-risk fixes.`,
        maxRetries: 10,
        // 调试分析需要深度分析执行路径，使用更长的超时
        idleTimeoutMs: LONG_IDLE_TIMEOUT_MS,
    },
    [SubagentType.CodeReviewer]: {
        tools: [BashTool, GlobTool, GrepTool, ReadFileTool, LspTool, WebSearchTool, WebFetchTool],
        systemPrompt: `You are an elite code reviewer.
Prioritize correctness, security, performance, and reliability findings.`,
        maxRetries: 8,
        // 代码审查需要全面审查，使用更长的超时
        idleTimeoutMs: LONG_IDLE_TIMEOUT_MS,
    },
};
