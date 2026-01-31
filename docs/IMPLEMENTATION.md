# Coding Agent 技术实现文档

> 版本：v1.0.0
> 更新时间：2026-01-31

---

## 目录

- [1. 代码结构](#1-代码结构)
- [2. 核心类实现](#2-核心类实现)
- [3. API 参考](#3-api-参考)
- [4. 配置详解](#4-配置详解)
- [5. 扩展开发](#5-扩展开发)
- [6. 测试指南](#6-测试指南)
- [7. 调试技巧](#7-调试技巧)
- [8. 常见问题](#8-常见问题)

---

## 1. 代码结构

### 1.1 项目目录

```
agent-v4/
├── src/
│   ├── agent/              # Agent 模块
│   │   ├── agent.ts        # 主 Agent 类
│   │   ├── types.ts        # 类型定义
│   │   ├── index.ts        # 模块导出
│   │   │
│   │   ├── core/           # 核心引擎
│   │   │   ├── engine.ts   # ReAct 循环引擎
│   │   │   └── planner.ts  # 任务规划器
│   │   │
│   │   ├── tools/          # 工具系统
│   │   │   ├── registry.ts # 工具注册表
│   │   │   ├── executor.ts # 工具执行器
│   │   │   ├── cache.ts    # 结果缓存
│   │   │   └── builtin/    # 内置工具
│   │   │       ├── file.ts # 文件操作
│   │   │       ├── search.ts # 搜索
│   │   │       └── execute.ts # 执行
│   │   │
│   │   ├── memory/         # 记忆管理
│   │   │   └── manager.ts  # 记忆管理器
│   │   │
│   │   ├── tasks/          # 任务管理
│   │   │   └── manager.ts  # 任务管理器
│   │   │
│   │   ├── utils/          # 工具函数
│   │   │   └── backup.ts   # 备份管理
│   │   │
│   │   └── prompts/        # 提示词
│   │       └── system.ts   # 系统提示词
│   │
│   ├── providers/          # Provider 模块
│   │   ├── registry.ts     # Provider 注册表
│   │   ├── openai-compatible.ts # OpenAI 兼容实现
│   │   ├── http/           # HTTP 客户端
│   │   │   ├── client.ts   # HTTP 客户端
│   │   │   └── stream-parser.ts # 流式解析
│   │   ├── adapters/       # 适配器
│   │   │   ├── base.ts     # 基础适配器
│   │   │   └── standard.ts # 标准适配器
│   │   └── types/          # 类型定义
│   │       ├── config.ts   # 配置类型
│   │       ├── provider.ts # Provider 类型
│   │       ├── api.ts      # API 类型
│   │       ├── errors.ts   # 错误类型
│   │       └── registry.ts # 注册表类型
│   │
│   └── index.ts            # 项目入口
│
├── docs/                   # 文档目录
│   ├── PRODUCT.md          # 产品文档
│   ├── ARCHITECTURE.md     # 技术方案文档
│   ├── IMPLEMENTATION.md   # 技术实现文档
│   └── EXECUTION_FLOW.md   # 执行流程文档
│
├── tests/                  # 测试目录
│   └── ...
│
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
├── vitest.config.ts       # 测试配置
└── .env.development       # 环境变量
```

### 1.2 模块依赖图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           模块依赖关系                                 │
│                                                                         │
│  index.ts (入口)                                                        │
│      │                                                                  │
│      ├── agent/ (Agent 模块)                                           │
│      │    │                                                            │
│      │    ├── agent.ts ─────────────────────────────┐                  │
│      │    │                                           │                  │
│      │    ├── types.ts ◀─────────────────────────────┼──────────┐      │
│      │    │                                           │          │      │
│      │    ├── core/                                   │          │      │
│      │    │    ├── engine.ts ─────────────────────────┼──────┐   │      │
│      │    │    └── planner.ts ────────────────────────┼──┐   │   │      │
│      │    │                                          │  │   │   │      │
│      │    ├── tools/                                  │  │   │   │      │
│      │    │    ├── registry.ts ───────────────────────┼──┼───┼───┼──┐   │
│      │    │    ├── executor.ts ───────────────────────┼──┼───┼──┼┐ │   │
│      │    │    ├── cache.ts ──────────────────────────┼──┼───┼┐││ │   │
│      │    │    └── builtin/                           │  │   ││││ │   │
│      │    │         ├── file.ts ───────────────────────┼──┼───┼│││ │   │
│      │    │         ├── search.ts ─────────────────────┼──┼───┼│││ │   │
│      │    │         └── execute.ts ────────────────────┼──┼───┼│││ │   │
│      │    │                                          │  │   ││││ │   │
│      │    ├── memory/                                 │  │   ││││ │   │
│      │    │    └── manager.ts ─────────────────────────┼──┼───┼│││ │   │
│      │    │                                          │  │   ││││ │   │
│      │    ├── tasks/                                  │  │   ││││ │   │
│      │    │    └── manager.ts ─────────────────────────┼──┼───┼│││ │   │
│      │    │                                          │  │   ││││ │   │
│      │    ├── utils/                                  │  │   ││││ │   │
│      │    │    └── backup.ts ─────────────────────────┼──┼───┼│││ │   │
│      │    │                                          │  │   ││││ │   │
│      │    └── prompts/                                │  │   ││││ │   │
│      │         └── system.ts ─────────────────────────┼──┼───┼│││ │   │
│      │                                                 │  │   ││││ │   │
│      └── providers/ (Provider 模块)                   │  │   ││││ │   │
│           │                                           │  │   ││││ │   │
│           ├── registry.ts ────────────────────────────┼──┼───┼│││ │   │
│           │                                           │  │   ││││ │   │
│           ├── openai-compatible.ts ───────────────────┼──┼───┼│││ │   │
│           │                                           │  │   ││││ │   │
│           ├── http/                                   │  │   ││││ │   │
│           │    ├── client.ts ─────────────────────────┼──┼───┼│││ │   │
│           │    └── stream-parser.ts ─────────────────┼──┼───┼│││ │   │
│           │                                           │  │   ││││ │   │
│           ├── adapters/                               │  │   ││││ │   │
│           │    ├── base.ts ───────────────────────────┼──┼───┼│││ │   │
│           │    └── standard.ts ───────────────────────┼──┼───┼│││ │   │
│           │                                           │  │   ││││ │   │
│           └── types/                                  │  │   ││││ │   │
│                ├── config.ts                          │  │   ││││ │   │
│                ├── provider.ts ───────────────────────┼──┼───┼│││ │   │
│                ├── api.ts ────────────────────────────┼──┼───┼│││ │   │
│                ├── errors.ts ─────────────────────────┼──┼───┼│││ │   │
│                └── registry.ts ───────────────────────┼──┼───┼│││ │   │
│                                                          │  │   ││││ │   │
└──────────────────────────────────────────────────────────┴──┴───┴┴┴┴┴───┘   │
                                                                        │
注：── 表示依赖关系                                                      │
     各模块通过 types.ts 共享类型定义                                     │
                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 文件组织原则

| 原则 | 说明 | 示例 |
|-----|------|------|
| **按功能分组** | 相关功能放在同一目录 | `tools/` 包含所有工具相关代码 |
| **接口与实现分离** | 抽象接口与具体实现分开 | `types/` 存放接口，具体类在各模块 |
| **单一职责** | 每个文件只负责一个主要功能 | `cache.ts` 只负责缓存逻辑 |
| **依赖方向** | 内层模块不依赖外层 | Agent 层依赖 Provider 层 |
| **测试跟随** | 测试文件与源文件同目录 | `agent.test.ts` 伴随 `agent.ts` |

---

## 2. 核心类实现

### 2.1 CodingAgent 类

#### 2.1.1 类定义

```typescript
/**
 * CodingAgent - 智能代码编写助手
 *
 * 基于 ReAct (Reasoning + Acting) 范式，结合 LLM 和工具调用能力
 */
export class CodingAgent {
    // ========================================================================
    // 私有属性
    // ========================================================================

    /** LLM Provider */
    private provider: LLMProvider;

    /** Agent 配置 */
    private config: AgentConfig;

    /** 工具注册表 */
    private toolRegistry: ToolRegistry;

    /** 任务管理器 */
    private taskManager: TaskManager;

    /** 记忆管理器 */
    private memoryManager: MemoryManager;

    /** 任务规划器 */
    private planner: Planner;

    /** 备份管理器 */
    private backupManager: BackupManager;

    /** ReAct 循环引擎 */
    private reactEngine: ReActEngine;

    /** 当前状态 */
    private status: AgentStatus = AgentStatus.IDLE;

    /** 中止控制器 */
    private abortController: AbortController | null = null;

    /** 当前执行上下文 */
    private currentContext: ExecutionContext | null = null;

    // 回调函数
    private onConfirmation?: (request: ConfirmationRequest) => Promise<ConfirmationResponse>;
    private onEvent?: (event: AgentEvent) => void;

    // ========================================================================
    // 构造函数
    // ========================================================================

    /**
     * 创建 Agent 实例
     * @param options Agent 配置选项
     */
    constructor(options: AgentOptions) {
        // ... 初始化逻辑
    }

    // ========================================================================
    // 公共方法
    // ========================================================================

    /**
     * 执行任务
     * @param task 任务描述
     * @param options 执行选项
     * @returns 执行结果
     */
    async execute(task: string, options?: ExecutionOptions): Promise<AgentResult>;

    /**
     * 流式执行任务
     * @param task 任务描述
     * @returns 异步事件生成器
     */
    async *executeStream(task: string): AsyncGenerator<AgentEvent, AgentResult>;

    /**
     * 中止当前执行
     */
    abort(): void;

    /**
     * 注册工具
     * @param tool 工具定义
     */
    registerTool(tool: ToolDefinition): void;

    /**
     * 获取当前状态
     * @returns Agent 状态
     */
    getStatus(): AgentStatus;

    /**
     * 获取当前上下文
     * @returns 执行上下文
     */
    getContext(): ExecutionContext | null;

    /**
     * 获取任务统计
     * @returns 任务统计信息
     */
    getTaskStats(): TaskStats;

    /**
     * 清理资源
     */
    dispose(): void;
}
```

#### 2.1.2 执行流程

```typescript
/**
 * 执行任务的完整流程
 */
async execute(task: string, options?: ExecutionOptions): Promise<AgentResult> {
    const startTime = Date.now();

    try {
        // 1. 初始化阶段
        this.abortController = new AbortController();
        this.setStatus(AgentStatus.PLANNING);

        // 2. 创建执行上下文
        const context = this.memoryManager.createContext(uuidv4());
        context.userInputHistory.push(task);
        this.currentContext = context;

        // 3. 规划阶段
        const plan = await this.planner.createPlan(task, context);
        this.taskManager.addTask(plan.mainTask);
        plan.subtasks.forEach(t => this.taskManager.addTask(t));

        // 4. 执行阶段
        this.setStatus(AgentStatus.RUNNING);
        const result = await this.reactEngine.execute(task, {
            context,
            plan,
            abortSignal: this.abortController.signal,
            onProgress: (progress) => this.emitEvent({ /* ... */ }),
        });

        // 5. 完成阶段
        this.setStatus(AgentStatus.COMPLETED);
        result.duration = Date.now() - startTime;
        return result;

    } catch (error) {
        // 错误处理
        this.setStatus(AgentStatus.FAILED);
        return {
            success: false,
            toolCalls: [],
            tasks: [],
            error: error as Error,
            duration: Date.now() - startTime,
        };
    } finally {
        this.abortController = null;
    }
}
```

### 2.2 ReActEngine 类

#### 2.2.1 类定义

```typescript
/**
 * ReAct 循环引擎
 *
 * 实现 Think-Act-Observe-Reflect 循环
 */
export class ReActEngine {
    private config: ReActEngineConfig;

    constructor(config: ReActEngineConfig) {
        this.config = config;
    }

    /**
     * 执行 ReAct 循环
     */
    async execute(
        task: string,
        options: ReActExecuteOptions
    ): Promise<AgentResult>;

    /**
     * 思考阶段
     */
    private async think(
        task: string,
        context: ExecutionContext,
        reactContext: ReActContext
    ): Promise<{ thought: string; toolCall?: ToolCallRequest }>;

    /**
     * 行动阶段
     */
    private async act(
        toolName: string,
        argsString: string,
        context: ExecutionContext
    ): Promise<ToolCallRecord>;

    /**
     * 观察阶段
     */
    private observe(
        toolCall: ToolCallRecord,
        context: ExecutionContext
    ): ToolResult;

    /**
     * 反思阶段
     */
    private async reflect(
        task: string,
        thought: string,
        observation: ToolResult,
        context: ExecutionContext
    ): Promise<string>;
}
```

#### 2.2.2 ReAct 循环实现

```typescript
/**
 * ReAct 循环主逻辑
 */
async execute(task: string, options: ReActExecuteOptions): Promise<AgentResult> {
    const { context, plan, abortSignal, onProgress } = options;
    const toolCalls: ToolCallRecord[] = [];

    // 初始化 ReAct 上下文
    const reactContext: ReActContext = {
        state: ReActState.THINK,
        loopCount: 0,
    };

    let finalResponse: string | undefined;
    let shouldContinue = true;

    // 主循环
    while (shouldContinue && reactContext.loopCount < this.config.maxLoops) {
        // 检查中止信号
        if (abortSignal?.aborted) {
            throw new Error('Execution aborted');
        }

        reactContext.loopCount++;

        // === Think 阶段 ===
        reactContext.state = ReActState.THINK;
        const thinkResult = await this.think(task, context, reactContext);
        reactContext.lastThought = thinkResult.thought;

        onProgress?.({ loop: reactContext.loopCount, state: reactContext.state });

        // === Act 阶段 ===
        if (thinkResult.toolCall) {
            reactContext.state = ReActState.ACT;

            const toolResult = await this.act(
                thinkResult.toolCall.name,
                thinkResult.toolCall.arguments,
                context
            );

            toolCalls.push(toolResult);
            reactContext.lastAction = toolResult;

            // === Observe 阶段 ===
            reactContext.state = ReActState.OBSERVE;
            const observation = this.observe(toolResult, context);
            reactContext.lastObservation = observation;

            // 更新上下文
            context.toolCallHistory.push(toolResult);
            context.userInputHistory.push(
                `Tool ${toolResult.toolName} returned: ${JSON.stringify(toolResult.result)}`
            );

            // === Reflect 阶段 ===
            reactContext.state = ReActState.REFLECT;
            const reflection = await this.reflect(
                task, thinkResult.thought, observation, context
            );

            // 决策是否继续
            shouldContinue = this.shouldContinue(
                reflection, toolResult, reactContext.loopCount
            );

            if (!shouldContinue) {
                finalResponse = reflection;
            }
        } else {
            // 没有工具调用，任务完成
            finalResponse = thinkResult.thought;
            shouldContinue = false;
        }
    }

    return {
        success: true,
        response: finalResponse,
        toolCalls,
        tasks: this.config.taskManager.getAllTasks(),
        duration: Date.now() - startTime,
    };
}
```

### 2.3 ToolRegistry 类

#### 2.3.1 类定义

```typescript
/**
 * 工具注册表
 *
 * 管理工具的注册、执行、缓存和权限控制
 */
export class ToolRegistry extends EventEmitter {
    private tools: Map<string, ToolDefinition> = new Map();
    private executor: ToolExecutor;
    private cache: ToolCache;
    private callHistory: ToolCallRecord[] = [];

    // ========================================================================
    // 工具注册
    // ========================================================================

    /**
     * 注册工具
     */
    register(tool: ToolDefinition): void;

    /**
     * 批量注册工具
     */
    registerBatch(tools: ToolDefinition[]): void;

    /**
     * 注销工具
     */
    unregister(name: string): boolean;

    /**
     * 检查工具是否存在
     */
    has(name: string): boolean;

    /**
     * 获取工具定义
     */
    get(name: string): ToolDefinition | undefined;

    /**
     * 按分类获取工具
     */
    getByCategory(category: ToolCategory): ToolDefinition[];

    // ========================================================================
    // 工具执行
    // ========================================================================

    /**
     * 执行工具
     */
    async execute(
        name: string,
        params: unknown,
        context: ExecutionContext
    ): Promise<ToolResult>;

    /**
     * 批量执行工具
     */
    async executeBatch(
        calls: Array<{ name: string; params: unknown }>,
        context: ExecutionContext
    ): Promise<ToolResult[]>;

    // ========================================================================
    // LLM 集成
    // ========================================================================

    /**
     * 转换为 LLM 工具格式
     */
    toLLMTools(): Tool[];

    /**
     * 获取工具描述
     */
    getToolDescriptions(): string;
}
```

#### 2.3.2 工具执行流程

```typescript
/**
 * 工具执行的完整流程
 */
async execute(
    name: string,
    params: unknown,
    context: ExecutionContext
): Promise<ToolResult> {
    // 1. 获取工具定义
    const tool = this.tools.get(name);
    if (!tool) {
        return { success: false, error: `Tool "${name}" not found` };
    }

    const callId = uuidv4();
    const startTime = Date.now();

    // 2. 发送开始事件
    this.emit('call:start', { toolName: name, id: callId });

    // 3. 检查缓存
    if (this.cache.isEnabled()) {
        const cached = this.cache.get(name, params);
        if (cached) return cached;
    }

    // 4. 权限检查
    const permission = tool.permission ?? PermissionLevel.SAFE;
    if (permission !== PermissionLevel.SAFE) {
        const approved = await this.requestConfirmation({
            id: callId,
            description: tool.description,
            toolName: name,
            parameters: params,
            permission,
        });

        if (!approved.approved) {
            return { success: false, error: 'Operation cancelled' };
        }
    }

    try {
        // 5. 参数验证
        const validatedParams = this.executor.validateParameters(tool, params);

        // 6. 执行工具（带超时）
        const result = await this.executor.execute(tool, validatedParams, context);

        // 7. 记录调用
        const record: ToolCallRecord = {
            id: callId,
            toolName: name,
            parameters: params,
            result,
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
            success: result.success,
        };
        this.callHistory.push(record);

        // 8. 缓存结果
        if (result.success && this.cache.isEnabled()) {
            this.cache.set(name, params, result);
        }

        // 9. 发送完成事件
        this.emit('call:complete', { toolName: name, id: callId, result });

        return result;

    } catch (error) {
        // 错误处理
        const result: ToolResult = {
            success: false,
            error: (error as Error).message,
            retryable: this.isRetryableError(error as Error),
        };

        this.emit('call:error', { toolName: name, id: callId, error });
        return result;
    }
}
```

### 2.4 TaskManager 类

#### 2.4.1 类定义

```typescript
/**
 * 任务管理器
 *
 * 管理任务的创建、更新、状态跟踪和依赖关系
 */
export class TaskManager extends EventEmitter {
    private tasks: Map<string, Task> = new Map();

    // ========================================================================
    // 任务管理
    // ========================================================================

    /**
     * 添加任务
     */
    addTask(task: Omit<Task, 'id' | 'createdAt'>): Task;

    /**
     * 获取任务
     */
    getTask(id: string): Task | undefined;

    /**
     * 获取所有任务
     */
    getAllTasks(): Task[];

    /**
     * 按状态获取任务
     */
    getTasksByStatus(status: TaskStatus): Task[];

    // ========================================================================
    // 状态更新
    // ========================================================================

    /**
     * 更新任务状态
     */
    updateTaskStatus(
        id: string,
        status: TaskStatus,
        result?: unknown,
        error?: Error
    ): void;

    /**
     * 标记任务为进行中
     */
    startTask(id: string): void;

    /**
     * 标记任务完成
     */
    completeTask(id: string, result?: unknown): void;

    /**
     * 标记任务失败
     */
    failTask(id: string, error: Error): void;

    // ========================================================================
    // 依赖管理
    // ========================================================================

    /**
     * 检查任务依赖是否满足
     */
    areDependenciesMet(taskId: string): boolean;

    /**
     * 获取阻塞的任务
     */
    getBlockingTasks(taskId: string): Task[];

    /**
     * 获取被阻塞的任务
     */
    getBlockedTasks(taskId: string): Task[];

    // ========================================================================
    // 统计
    // ========================================================================

    /**
     * 获取任务统计
     */
    getStats(): TaskStats;

    /**
     * 获取进度百分比
     */
    getProgress(): number;
}
```

---

## 3. API 参考

### 3.1 Agent API

#### 3.1.1 构造函数

```typescript
/**
 * 创建 Agent 实例
 * @param options Agent 配置选项
 */
constructor(options: {
    /** LLM Provider */
    provider: LLMProvider;

    /** Agent 配置 */
    config: Partial<AgentConfig>;

    /** 确认回调 */
    onConfirmation?: (
        request: ConfirmationRequest
    ) => Promise<ConfirmationResponse>;

    /** 事件回调 */
    onEvent?: (event: AgentEvent) => void;
})
```

#### 3.1.2 execute()

```typescript
/**
 * 执行任务
 * @param task 任务描述
 * @param options 执行选项
 * @returns 执行结果
 */
async execute(
    task: string,
    options?: {
        /** 是否启用流式输出 */
        stream?: boolean;

        /** 中止信号 */
        abortSignal?: AbortSignal;

        /** 初始上下文数据 */
        initialContext?: Record<string, unknown>;
    }
): Promise<AgentResult>;
```

**返回值：**

```typescript
interface AgentResult {
    /** 是否成功 */
    success: boolean;

    /** 最终响应内容 */
    response?: string;

    /** 执行的工具调用记录 */
    toolCalls: ToolCallRecord[];

    /** 执行的任务记录 */
    tasks: Task[];

    /** Token 使用情况 */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };

    /** 错误信息（如果失败） */
    error?: Error;

    /** 执行耗时（毫秒） */
    duration: number;
}
```

#### 3.1.3 executeStream()

```typescript
/**
 * 流式执行任务
 * @param task 任务描述
 * @returns 异步事件生成器
 */
async *executeStream(
    task: string
): AsyncGenerator<AgentEvent, AgentResult>;
```

**事件类型：**

```typescript
type AgentEvent =
    | { type: 'status_changed'; data: { status: AgentStatus } }
    | { type: 'thinking'; data: { thought: string } }
    | { type: 'tool_call_start'; data: { toolName: string; id: string } }
    | { type: 'tool_call_complete'; data: { toolName: string; id: string; result: unknown } }
    | { type: 'tool_call_error'; data: { toolName: string; id: string }; error: Error }
    | { type: 'progress'; data: { loop: number; state: ReActState } }
    | { type: 'completed'; data: { result: AgentResult } }
    | { type: 'error'; error: Error };
```

#### 3.1.4 registerTool()

```typescript
/**
 * 注册自定义工具
 * @param tool 工具定义
 */
registerTool(tool: {
    /** 工具名称 */
    name: string;

    /** 工具描述 */
    description: string;

    /** 参数 schema */
    parameters: JSONSchema7;

    /** 执行函数 */
    execute: (
        params: unknown,
        context: ExecutionContext
    ) => Promise<ToolResult>;

    /** 是否需要确认 */
    requireConfirmation?: boolean;

    /** 工具分类 */
    category?: ToolCategory;

    /** 权限级别 */
    permission?: PermissionLevel;
}): void;
```

### 3.2 Provider API

#### 3.2.1 ProviderRegistry

```typescript
/**
 * Provider 注册表
 */
class ProviderRegistry {
    /**
     * 注册模型配置
     */
    static register(config: ModelConfig): void;

    /**
     * 从环境变量创建 Provider
     */
    static createFromEnv(
        modelId: ModelId,
        options?: Partial<BaseProviderConfig>
    ): LLMProvider;

    /**
     * 获取所有模型
     */
    static listModels(): ModelInfo[];

    /**
     * 按提供商筛选模型
     */
    static listModelsByProvider(provider: ProviderType): ModelInfo[];
}
```

#### 3.2.2 LLMProvider

```typescript
/**
 * LLM Provider 基类
 */
abstract class LLMProvider {
    /**
     * 生成响应
     */
    abstract generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null>;
}
```

**请求消息：**

```typescript
interface LLMRequestMessage {
    /** 消息角色 */
    role: 'system' | 'assistant' | 'user' | 'tool';

    /** 消息内容 */
    content: string;

    /** 工具调用 ID (tool 角色时) */
    tool_call_id?: string;
}
```

**生成选项：**

```typescript
interface LLMGenerateOptions {
    /** 模型名称 */
    model?: string;

    /** 最大生成 token 数 */
    max_tokens?: number;

    /** 温度参数 */
    temperature?: number;

    /** 是否启用流式响应 */
    stream?: boolean;

    /** 流式回调函数 */
    streamCallback?: (chunk: Chunk) => void;

    /** 中止信号 */
    abortSignal?: AbortSignal;

    /** 工具列表 */
    tools?: Tool[];
}
```

### 3.3 Tool API

#### 3.3.1 ToolDefinition

```typescript
/**
 * 工具定义接口
 */
interface ToolDefinition {
    /** 工具名称 */
    name: string;

    /** 工具描述 */
    description: string;

    /** 参数 JSON Schema */
    parameters: JSONSchema7;

    /** 执行函数 */
    execute: (
        params: unknown,
        context: ExecutionContext
    ) => Promise<ToolResult>;

    /** 是否需要确认 */
    requireConfirmation?: boolean;

    /** 工具分类 */
    category?: ToolCategory;

    /** 权限级别 */
    permission?: PermissionLevel;
}
```

#### 3.3.2 ToolResult

```typescript
/**
 * 工具执行结果
 */
interface ToolResult {
    /** 是否成功 */
    success: boolean;

    /** 结果数据 */
    data?: unknown;

    /** 错误信息 */
    error?: string;

    /** 是否可重试 */
    retryable?: boolean;
}
```

---

## 4. 配置详解

### 4.1 Agent 配置

```typescript
interface AgentConfig {
    // ========== 模型配置 ==========
    /**
     * 模型标识符
     * @default 'glm-4.7'
     */
    modelId: ModelId;

    // ========== 循环控制 ==========
    /**
     * 最大循环次数（防止无限循环）
     * @default 30
     */
    maxLoops: number;

    /**
     * 每个任务最多调用工具次数
     * @default 50
     */
    maxToolsPerTask: number;

    // ========== 超时和备份 ==========
    /**
     * 执行超时时间（毫秒）
     * @default 300000 (5分钟)
     */
    timeout: number;

    /**
     * 是否启用文件备份
     * @default true
     */
    enableBackup: boolean;

    /**
     * 最大备份数量
     * @default 10
     */
    maxBackups: number;

    // ========== 工作环境 ==========
    /**
     * 工作目录（所有文件操作的根目录）
     * @default process.cwd()
     */
    workingDirectory: string;

    /**
     * 是否启用交互模式（危险操作需要确认）
     * @default true
     */
    interactiveMode: boolean;

    // ========== 自定义 ==========
    /**
     * 自定义系统提示词
     */
    systemPrompt?: string;
}
```

### 4.2 模型配置

```typescript
interface ModelConfig {
    /** 模型唯一标识 */
    id: ModelId;

    /** 所属厂商 */
    provider: ProviderType;

    /** 显示名称 */
    name: string;

    /** API 端点路径 */
    endpointPath: string;

    /** API Key 环境变量名 */
    envApiKey: string;

    /** Base URL 环境变量名 */
    envBaseURL: string;

    /** API 基础 URL */
    baseURL: string;

    /** API 模型名称 */
    model: string;

    /** 最大上下文 token 数 */
    max_tokens: number;

    /** 最大输出 token 数 */
    LLMMAX_TOKENS: number;

    /** 支持的特性 */
    features: string[];

    /** API 密钥（可选） */
    apiKey?: string;

    /** 温度（可选） */
    temperature?: number;
}
```

### 4.3 环境变量

```bash
# ========== GLM 配置 ==========
GLM_API_KEY=your_glm_api_key
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4

# ========== DeepSeek 配置 ==========
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# ========== MiniMax 配置 ==========
MINIMAX_API_KEY=your_minimax_api_key
MINIMAX_BASE_URL=https://api.minimax.chat/v1

# ========== Kimi 配置 ==========
KIMI_API_KEY=your_kimi_api_key
KIMI_BASE_URL=https://api.moonshot.cn/v1

# ========== 通用配置 ==========
AGENT_MAX_LOOPS=30
AGENT_TIMEOUT=300000
AGENT_ENABLE_BACKUP=true
AGENT_WORK_DIR=/path/to/work/dir
```

---

## 5. 扩展开发

### 5.1 自定义工具

#### 5.1.1 工具模板

```typescript
import type {
    ToolDefinition,
    ToolResult,
    ToolCategory,
    PermissionLevel,
    ExecutionContext,
} from 'agent-v4';

/**
 * 创建自定义工具
 */
export function createCustomTool(): ToolDefinition {
    return {
        name: 'custom_tool_name',
        description: '工具功能的详细描述，帮助 LLM 理解何时使用',
        category: ToolCategory.CODE,     // 选择合适的分类
        permission: PermissionLevel.SAFE, // 设置权限级别

        // 参数定义 (JSON Schema)
        parameters: {
            type: 'object',
            properties: {
                param1: {
                    type: 'string',
                    description: '参数1的说明',
                },
                param2: {
                    type: 'number',
                    description: '参数2的说明',
                },
            },
            required: ['param1'], // 必需参数
        },

        // 执行逻辑
        execute: async (params: unknown, context: ExecutionContext) => {
            try {
                // 1. 解析参数
                const { param1, param2 } = params as {
                    param1: string;
                    param2?: number;
                };

                // 2. 执行业务逻辑
                const result = await doSomething(param1, param2);

                // 3. 返回结果
                return {
                    success: true,
                    data: result,
                };
            } catch (error) {
                return {
                    success: false,
                    error: (error as Error).message,
                    retryable: false,
                };
            }
        },
    };
}

// 注册工具
agent.registerTool(createCustomTool());
```

#### 5.1.2 工具示例：Git 操作

```typescript
/**
 * Git 状态工具
 */
export const gitStatusTool: ToolDefinition = {
    name: 'git_status',
    description: 'Get the current git repository status',
    category: ToolCategory.GIT,
    permission: PermissionLevel.SAFE,

    parameters: {
        type: 'object',
        properties: {},
    },

    execute: async (params, context) => {
        const { spawn } = require('child_process');

        return new Promise((resolve) => {
            const child = spawn('git', ['status', '--porcelain'], {
                cwd: context.workingDirectory,
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    const files = stdout.split('\n')
                        .filter(Boolean)
                        .map(line => ({
                            status: line.slice(0, 2),
                            path: line.slice(3),
                        }));

                    resolve({
                        success: true,
                        data: { files },
                    });
                } else {
                    resolve({
                        success: false,
                        error: stderr || 'Git command failed',
                    });
                }
            });
        });
    },
};
```

### 5.2 自定义提示词

#### 5.2.1 系统提示词

```typescript
import { CodingAgent } from 'agent-v4';

const agent = new CodingAgent({
    provider,
    config: {
        // ... 其他配置
        systemPrompt: `
你是一个专注于 TypeScript 开发的 AI 助手。

# 核心能力
- 精通 TypeScript 类型系统
- 熟悉 Node.js 生态系统
- 了解前端框架（React、Vue等）

# 代码风格
- 使用 TypeScript 严格模式
- 遵循 Airbnb Style Guide
- 添加完整的 JSDoc 注释
- 编写可测试的代码

# 工作原则
1. 优先使用类型安全的做法
2. 避免使用 any 类型
3. 充分利用 TypeScript 的类型推断
4. 编写清晰的错误消息
        `,
    },
});
```

#### 5.2.2 规划提示词

```typescript
import { Planner } from 'agent-v4';

class CustomPlanner extends Planner {
    protected getPlanningPrompt(availableTools: string): string {
        return `
你是一个专业的技术规划助手。

${availableTools}

# 规划原则
1. 将复杂任务分解为可执行的步骤
2. 每个步骤应该有明确的验收标准
3. 考虑任务之间的依赖关系
4. 评估每个步骤的风险

# 输出格式
使用 Markdown 格式输出计划，包含：
- 任务概述
- 步骤列表（带编号）
- 每步的预期结果
- 潜在风险和缓解措施
        `;
    }
}
```

### 5.3 自定义中间件

```typescript
import { CodingAgent } from 'agent-v4';

// 创建自定义 Agent
class ExtendedAgent extends CodingAgent {
    private middleware: Array<
        (context: ExecutionContext, next: () => Promise<void>) => Promise<void>
    > = [];

    use(
        fn: (context: ExecutionContext, next: () => Promise<void>) => Promise<void>
    ): this {
        this.middleware.push(fn);
        return this;
    }

    async execute(task: string, options?: ExecutionOptions): Promise<AgentResult> {
        // 执行中间件链
        let index = 0;
        const context = this.memoryManager.createContext(uuidv4());

        const next = async () => {
            if (index < this.middleware.length) {
                const mw = this.middleware[index++];
                await mw(context, next);
            } else {
                // 执行原始逻辑
                return super.execute(task, options);
            }
        };

        return next() as Promise<AgentResult>;
    }
}

// 使用示例
const agent = new ExtendedAgent({ provider, config: {} });

// 日志中间件
agent.use(async (context, next) => {
    console.log('[Start]', context.currentTask);
    await next();
    console.log('[End]', context.currentTask);
});

// 性能监控中间件
agent.use(async (context, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(`[Duration] ${duration}ms`);
});
```

---

## 6. 测试指南

### 6.1 单元测试

#### 6.1.1 测试结构

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../tools/registry';

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry({
            workingDirectory: '/test',
        });
    });

    afterEach(() => {
        registry.dispose();
    });

    describe('register()', () => {
        it('should register a tool successfully', () => {
            const tool = {
                name: 'test_tool',
                description: 'Test tool',
                parameters: { type: 'object' },
                execute: async () => ({ success: true }),
            };

            registry.register(tool);

            expect(registry.has('test_tool')).toBe(true);
        });

        it('should throw error for duplicate tool name', () => {
            const tool = {
                name: 'test_tool',
                description: 'Test tool',
                parameters: { type: 'object' },
                execute: async () => ({ success: true }),
            };

            registry.register(tool);

            expect(() => registry.register(tool)).toThrow();
        });
    });
});
```

#### 6.1.2 Mock 工具

```typescript
import { vi } from 'vitest';

// Mock LLM Provider
const mockProvider = {
    generate: vi.fn().mockResolvedValue({
        choices: [{
            message: {
                content: 'Test response',
                tool_calls: [],
            },
        }],
    }),
};

// Mock 工具执行
const mockTool = {
    name: 'mock_tool',
    description: 'Mock tool',
    parameters: { type: 'object' },
    execute: vi.fn().mockResolvedValue({
        success: true,
        data: { result: 'mocked' },
    }),
};
```

### 6.2 集成测试

```typescript
describe('Agent Integration', () => {
    it('should complete a simple task', async () => {
        const agent = new CodingAgent({
            provider: mockProvider,
            config: {
                modelId: 'glm-4.7',
                workingDirectory: '/test',
                maxLoops: 10,
            },
        });

        // 注册测试工具
        agent.registerTool({
            name: 'test_search',
            description: 'Search for test',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                },
            },
            execute: async () => ({
                success: true,
                data: { found: true },
            }),
        });

        const result = await agent.execute('Search for test files');

        expect(result.success).toBe(true);
        expect(result.toolCalls.length).toBeGreaterThan(0);
    });
});
```

### 6.3 端到端测试

```typescript
describe('Agent E2E', () => {
    it('should handle a complete workflow', async () => {
        // 1. 创建真实 Provider
        const provider = ProviderRegistry.createFromEnv('glm-4.7');

        // 2. 创建 Agent
        const agent = new CodingAgent({
            provider,
            config: {
                modelId: 'glm-4.7',
                workingDirectory: process.cwd(),
                maxLoops: 20,
            },
        });

        // 3. 执行实际任务
        const result = await agent.execute(`
            分析当前目录的文件结构，
            找出所有 TypeScript 文件，
            生成一个简要报告
        `);

        // 4. 验证结果
        expect(result.success).toBe(true);
        expect(result.response).toBeDefined();
        expect(result.toolCalls.length).toBeGreaterThan(0);
    });
});
```

---

## 7. 调试技巧

### 7.1 启用调试模式

```typescript
// Provider 调试模式
const provider = ProviderRegistry.createFromEnv('glm-4.7', {
    debug: true,  // 输出详细的 HTTP 请求日志
});

// Agent 调试模式
const agent = new CodingAgent({
    provider,
    config: {
        // ... 配置
    },
    onEvent: (event) => {
        console.log('[Event]', event.type, event.data);
    },
});
```

### 7.2 断点调试

在 VS Code 中配置 `.vscode/launch.json`：

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "node",
            "request": "launch",
            "name": "Debug Agent",
            "runtimeExecutable": "npm",
            "runtimeArgs": ["run", "dev"],
            "cwd": "${workspaceFolder}",
            "skipFiles": ["<node_internals>/**"],
            "sourceMaps": true
        }
    ]
}
```

### 7.3 日志追踪

```typescript
import { createLogger } from './utils/logger';

const logger = createLogger('Agent');

class LoggingAgent extends CodingAgent {
    async execute(task: string, options?: ExecutionOptions): Promise<AgentResult> {
        logger.info('Starting task', { task });

        const result = await super.execute(task, options);

        logger.info('Task completed', {
            success: result.success,
            toolCalls: result.toolCalls.length,
            duration: result.duration,
        });

        return result;
    }
}
```

---

## 8. 常见问题

### 8.1 类型问题

**Q: 如何处理工具参数的类型推断？**

A: 使用泛型和类型守卫：

```typescript
function defineTool<TParams>(
    definition: Omit<ToolDefinition, 'execute'> & {
        execute: (params: TParams, context: ExecutionContext) => Promise<ToolResult>;
    }
): ToolDefinition {
    return definition as ToolDefinition;
}

// 使用
const fileTool = defineTool<{ path: string; encoding?: string }>({
    name: 'read_file',
    description: 'Read file content',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            encoding: { type: 'string' },
        },
        required: ['path'],
    },
    execute: async (params) => {
        // params 有正确的类型
        const content = await fs.readFile(params.path, params.encoding);
        return { success: true, data: content };
    },
});
```

### 8.2 性能问题

**Q: 如何优化长时间运行的任务？**

A: 使用流式执行和定期检查点：

```typescript
async function executeLongTask(agent: CodingAgent, task: string) {
    let lastCheckpoint = Date.now();
    const checkpointInterval = 60000; // 每分钟

    for await (const event of agent.executeStream(task)) {
        // 检查是否需要保存检查点
        if (Date.now() - lastCheckpoint > checkpointInterval) {
            await saveCheckpoint(agent.getContext());
            lastCheckpoint = Date.now();
        }

        // 处理事件
        handleEvent(event);
    }
}
```

### 8.3 错误处理

**Q: 如何优雅地处理工具执行错误？**

A: 使用重试和降级策略：

```typescript
class ResilientToolRegistry extends ToolRegistry {
    async execute(
        name: string,
        params: unknown,
        context: ExecutionContext
    ): Promise<ToolResult> {
        const maxRetries = 3;
        let lastError: Error | undefined;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const result = await super.execute(name, params, context);

            if (result.success || !result.retryable) {
                return result;
            }

            lastError = new Error(result.error);
            await this.backoff(attempt);
        }

        // 尝试降级方案
        const fallback = await this.tryFallback(name, params, context);
        if (fallback) {
            return fallback;
        }

        throw lastError;
    }

    private async backoff(attempt: number): Promise<void> {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    private async tryFallback(
        name: string,
        params: unknown,
        context: ExecutionContext
    ): Promise<ToolResult | null> {
        // 实现降级逻辑
        return null;
    }
}
```

---

## 附录

### A. 类型速查表

| 类型 | 说明 | 定义位置 |
|-----|------|---------|
| `AgentConfig` | Agent 配置 | `agent/types.ts` |
| `AgentResult` | 执行结果 | `agent/types.ts` |
| `ToolDefinition` | 工具定义 | `agent/types.ts` |
| `ToolResult` | 工具结果 | `agent/types.ts` |
| `Task` | 任务 | `agent/types.ts` |
| `ExecutionContext` | 执行上下文 | `agent/types.ts` |
| `LLMProvider` | LLM Provider | `providers/types/provider.ts` |
| `LLMRequestMessage` | 请求消息 | `providers/types/api.ts` |
| `LLMResponse` | LLM 响应 | `providers/types/api.ts` |

### B. 相关文档

- [产品文档](./PRODUCT.md)
- [技术方案](./ARCHITECTURE.md)
- [执行流程](./EXECUTION_FLOW.md)

---

**文档版本：** v1.0.0
**最后更新：** 2026-01-31
**维护团队：** Agent-V4 开发组
