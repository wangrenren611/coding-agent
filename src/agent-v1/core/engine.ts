/**
 * ReAct Engine - ReAct 循环引擎
 *
 * 实现 Think-Act-Observe-Reflect 循环，这是 Agent 的核心执行引擎
 */

import type { LLMProvider } from '../../providers';
import type { LLMRequestMessage } from '../../providers/types';
import type {
    ExecutionContext,
    TaskPlan,
    ToolCallRecord,
    ReActContext,
    ReActState,
    AgentResult,
} from '../types';
import { ToolRegistry } from '../tools/registry';
import { TaskManager } from '../tasks/manager';
import { MemoryManager } from '../memory/manager';
import { getDefaultSystemPrompt } from '../prompts/system';

/**
 * ReAct 引擎配置
 */
export interface ReActEngineConfig {
    /** LLM Provider */
    provider: LLMProvider;
    /** 工具注册表 */
    toolRegistry: ToolRegistry;
    /** 任务管理器 */
    taskManager: TaskManager;
    /** 记忆管理器 */
    memoryManager: MemoryManager;
    /** 最大循环次数 */
    maxLoops: number;
    /** 每任务最大工具调用次数 */
    maxToolsPerTask: number;
}

/**
 * 执行选项
 */
export interface ReActExecuteOptions {
    /** 执行上下文 */
    context: ExecutionContext;
    /** 任务计划 */
    plan: TaskPlan;
    /** 中止信号 */
    abortSignal?: AbortSignal;
    /** 进度回调 */
    onProgress?: (progress: {
        loop: number;
        state: ReActState;
        thought?: string;
        toolCall?: string;
    }) => void;
}

/**
 * ReActEngine - ReAct 循环执行引擎
 *
 * 核心逻辑：
 * 1. Think: 调用 LLM 分析当前状态，生成思考和下一步行动
 * 2. Act: 执行工具调用
 * 3. Observe: 观察工具执行结果
 * 4. Reflect: 反思结果，决定是否继续或结束
 */
export class ReActEngine {
    private config: ReActEngineConfig;

    constructor(config: ReActEngineConfig) {
        this.config = config;
    }

    /**
     * 执行 ReAct 循环
     */
    async execute(task: string, options: ReActExecuteOptions): Promise<AgentResult> {
        const { context, plan, abortSignal, onProgress } = options;

        const startTime = Date.now();
        const toolCalls: ToolCallRecord[] = [];

        // 初始化 ReAct 上下文
        const reactContext: ReActContext = {
            state: 'think' as ReActState,
            loopCount: 0,
        };

        let finalResponse: string | undefined;
        let shouldContinue = true;

        try {
            while (shouldContinue && reactContext.loopCount < this.config.maxLoops) {
                // 检查中止信号
                if (abortSignal?.aborted) {
                    throw new Error('Execution aborted by user');
                }

                reactContext.loopCount++;

                // === Think 阶段 ===
                reactContext.state = 'think' as ReActState;
                const thinkResult = await this.think(task, context, reactContext);
                reactContext.lastThought = thinkResult.thought;

                onProgress?.({
                    loop: reactContext.loopCount,
                    state: reactContext.state,
                    thought: thinkResult.thought,
                });

                // === Act 阶段 ===
                if (thinkResult.toolCall) {
                    reactContext.state = 'act' as ReActState;

                    const toolResult = await this.act(
                        thinkResult.toolCall.name,
                        thinkResult.toolCall.arguments,
                        context
                    );

                    toolCalls.push(toolResult);
                    reactContext.lastAction = toolResult;
                    reactContext.lastObservation = toolResult.result;

                    onProgress?.({
                        loop: reactContext.loopCount,
                        state: reactContext.state,
                        toolCall: toolResult.toolName,
                    });

                    // === Observe 阶段 ===
                    reactContext.state = 'observe' as ReActState;
                    const observation = this.observe(toolResult, context);
                    reactContext.lastObservation = observation;

                    // 更新上下文
                    context.toolCallHistory.push(toolResult);

                    // 添加工具结果到消息历史
                    context.userInputHistory.push(
                        `Tool ${toolResult.toolName} returned: ${
                            toolResult.result.success
                                ? JSON.stringify(toolResult.result.data)
                                : toolResult.result.error
                        }`
                    );

                    // === Reflect 阶段 ===
                    reactContext.state = 'reflect' as ReActState;
                    const reflection = await this.reflect(
                        task,
                        thinkResult.thought,
                        observation,
                        context
                    );

                    onProgress?.({
                        loop: reactContext.loopCount,
                        state: reactContext.state,
                        thought: reflection,
                    });

                    // 检查是否应该继续
                    shouldContinue = this.shouldContinue(
                        reflection,
                        toolResult,
                        reactContext.loopCount
                    );

                    if (!shouldContinue && reflection) {
                        finalResponse = reflection;
                    }
                } else {
                    // 没有工具调用，直接返回最终响应
                    finalResponse = thinkResult.thought;
                    shouldContinue = false;
                }
            }

            // 如果达到最大循环次数，请求最终总结
            if (reactContext.loopCount >= this.config.maxLoops) {
                finalResponse = await this.generateFinalResponse(task, context);
            }

            // 获取 token 使用情况
            const usage = await this.getTokenUsage(context);

            return {
                success: true,
                response: finalResponse,
                toolCalls,
                tasks: this.config.taskManager.getAllTasks(),
                usage,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                success: false,
                response: finalResponse,
                toolCalls,
                tasks: this.config.taskManager.getAllTasks(),
                error: error as Error,
                duration: Date.now() - startTime,
            };
        }
    }

    // ========================================================================
    // ReAct 阶段实现
    // ========================================================================

    /**
     * Think - 思考阶段
     * 分析当前状态，决定下一步行动
     */
    private async think(
        task: string,
        context: ExecutionContext,
        reactContext: ReActContext
    ): Promise<{ thought: string; toolCall?: { name: string; arguments: string } }> {
        // 构建消息
        const messages = this.buildMessages(task, context, reactContext);

        // 调用 LLM
        const response = await this.config.provider.generate(messages, {
            tools: this.config.toolRegistry.toLLMTools(),
        });

        if (!response) {
            return { thought: 'No response from LLM' };
        }

        const message = response.choices[0].message;

        // 检查是否有工具调用
        if (message.tool_calls && message.tool_calls.length > 0) {
            const toolCall = message.tool_calls[0];
            return {
                thought: message.content || '',
                toolCall: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments || '{}',
                },
            };
        }

        return { thought: message.content || '' };
    }

    /**
     * Act - 行动阶段
     * 执行工具调用
     */
    private async act(
        toolName: string,
        argsString: string,
        context: ExecutionContext
    ): Promise<ToolCallRecord> {
        const startTime = Date.now();

        try {
            // 解析参数
            const args = JSON.parse(argsString);

            // 执行工具
            const result = await this.config.toolRegistry.execute(
                toolName,
                args,
                context
            );

            return {
                id: `call-${Date.now()}`,
                toolName,
                parameters: args,
                result,
                startTime,
                endTime: Date.now(),
                duration: Date.now() - startTime,
                success: result.success,
            };
        } catch (error) {
            return {
                id: `call-${Date.now()}`,
                toolName,
                parameters: argsString,
                result: {
                    success: false,
                    error: (error as Error).message,
                },
                startTime,
                endTime: Date.now(),
                duration: Date.now() - startTime,
                success: false,
            };
        }
    }

    /**
     * Observe - 观察阶段
     * 解析并记录工具执行结果
     */
    private observe(
        toolCall: ToolCallRecord,
        context: ExecutionContext
    ): import('../types').ToolResult {
        // 添加思考记录
        context.thoughts.push({
            content: `Executed ${toolCall.toolName}: ${
                toolCall.result.success ? 'Success' : 'Failed'
            }`,
            timestamp: Date.now(),
            relatedToolCall: toolCall.id,
        });

        return toolCall.result;
    }

    /**
     * Reflect - 反思阶段
     * 评估结果，决定是否继续
     */
    private async reflect(
        task: string,
        thought: string,
        observation: import('../types').ToolResult,
        context: ExecutionContext
    ): Promise<string> {
        const messages: LLMRequestMessage[] = [
            {
                role: 'system',
                content: `You are reflecting on the progress of a task.
Analyze the current state and determine if the task is complete or needs more work.

Respond with:
1. If the task is complete: Provide a final summary
2. If more work is needed: Briefly describe what to do next`,
            },
            {
                role: 'user',
                content: `Task: ${task}

My thought: ${thought}

Observation: ${observation.success ? JSON.stringify(observation.data) : observation.error}

Should I continue? If yes, what should I do next? If no, provide a final summary.`,
            },
        ];

        const response = await this.config.provider.generate(messages);

        return response?.choices[0].message.content || '';
    }

    // ========================================================================
    // 辅助方法
    // ========================================================================

    /**
     * 判断是否应该继续执行
     */
    private shouldContinue(
        reflection: string,
        lastResult: ToolCallRecord,
        loopCount: number
    ): boolean {
        // 检查是否达到最大循环次数
        if (loopCount >= this.config.maxLoops) {
            return false;
        }

        // 检查是否达到工具调用限制
        const toolCallCount = this.config.toolRegistry.getCallHistory().length;
        if (toolCallCount >= this.config.maxToolsPerTask) {
            return false;
        }

        // 分析反思内容
        const completionIndicators = [
            'task is complete',
            'finished',
            'done',
            'no more work',
            'success',
        ];

        const lowerReflection = reflection.toLowerCase();
        for (const indicator of completionIndicators) {
            if (lowerReflection.includes(indicator)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 生成最终响应
     */
    private async generateFinalResponse(task: string, context: ExecutionContext): Promise<string> {
        const messages: LLMRequestMessage[] = [
            {
                role: 'system',
                content: 'Provide a final summary of the completed task.',
            },
            {
                role: 'user',
                content: `Task: ${task}\n\nProvide a summary of what was accomplished.`,
            },
        ];

        const response = await this.config.provider.generate(messages);
        return response?.choices[0].message.content || '';
    }

    /**
     * 构建消息列表
     */
    private buildMessages(
        task: string,
        context: ExecutionContext,
        reactContext: ReActContext
    ): LLMRequestMessage[] {
        // 获取系统提示词
        const systemPrompt = this.config.memoryManager.buildSystemPrompt(context);

        const messages: LLMRequestMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: task },
        ];

        // 添加历史对话
        for (const entry of context.userInputHistory.slice(-10)) {
            messages.push({ role: 'user', content: entry });
        }

        return messages;
    }

    /**
     * 获取 token 使用情况
     */
    private async getTokenUsage(context: ExecutionContext): Promise<{
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    } | undefined> {
        // 这里可以跟踪实际的 token 使用情况
        // 目前返回 undefined，因为 provider 层面可能需要添加统计功能
        return undefined;
    }
}
