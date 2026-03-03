# Coding Agent vs OpenCode 深度对比报告

## 目录

1. [项目概述](#1-项目概述)
2. [架构对比](#2-架构对比)
3. [Agent 核心执行流程对比](#3-agent-核心执行流程对比)
4. [工具系统对比](#4-工具系统对比)
5. [存储与持久化对比](#5-存储与持久化对比)
6. [异常处理与重试机制对比](#6-异常处理与重试机制对比)
7. [会话管理对比](#7-会话管理对比)
8. [权限系统对比](#8-权限系统对比)
9. [扩展性对比](#9-扩展性对比)
10. [Coding Agent 不足与改进建议](#10-coding-agent-不足与改进建议)
11. [总结](#11-总结)

---

## 1. 项目概述

### 1.1 Coding Agent

| 特性 | 描述 |
|------|------|
| **语言** | TypeScript 5.3+ |
| **运行时** | Node.js 20+ |
| **架构模式** | 协调器模式（Coordinator Pattern） |
| **核心依赖** | Zod, uuid |
| **测试框架** | Vitest |

**核心模块：**
- `src/agent-v2/agent/` - Agent 核心逻辑
- `src/agent-v2/tool/` - 工具系统
- `src/agent-v2/session/` - 会话管理
- `src/agent-v2/memory/` - 持久化存储
- `src/agent-v2/providers/` - LLM Provider 层

### 1.2 OpenCode

| 特性 | 描述 |
|------|------|
| **语言** | TypeScript |
| **运行时** | Bun |
| **架构模式** | 命名空间模块化（Namespace Pattern） |
| **核心依赖** | Vercel AI SDK, Zod, Remeda |
| **测试框架** | Bun Test |

**核心模块：**
- `src/agent/agent.ts` - Agent 配置管理
- `src/tool/` - 工具系统
- `src/session/` - 会话管理
- `src/storage/` - 持久化存储
- `src/provider/` - LLM Provider 层
- `src/acp/` - ACP 协议实现

---

## 2. 架构对比

### 2.1 架构模式差异

#### Coding Agent - 协调器模式

```
┌─────────────────────────────────────────────────────────────┐
│                         Agent (协调器)                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │LLMCaller │  │ToolExec  │  │AgentState│  │ AgentEmit│    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│       │              │              │              │        │
│       └──────────────┴──────────────┴──────────────┘        │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    │   Session   │                          │
│                    └──────┬──────┘                          │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    │MemoryManager│                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

**特点：**
- 类级别封装，面向对象设计
- 依赖注入模式
- 组件间通过回调通信
- 状态集中在 AgentState 管理

#### OpenCode - 命名空间模块化

```
┌─────────────────────────────────────────────────────────────┐
│                     Namespace Modules                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Agent        │  │ Session      │  │ LLM          │      │
│  │ namespace    │  │ namespace    │  │ namespace    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                 │                 │               │
│         └─────────────────┴─────────────────┘               │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    │EventBus/Bus │                          │
│                    └──────┬──────┘                          │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    │  Storage    │                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

**特点：**
- 命名空间级别封装，函数式设计
- 事件驱动架构
- 模块间通过事件总线通信
- 状态分散在各模块

### 2.2 架构优劣势对比

| 维度 | Coding Agent | OpenCode |
|------|-------------|----------|
| **可测试性** | ⭐⭐⭐⭐ 依赖注入便于 mock | ⭐⭐⭐ 命名空间依赖需特殊处理 |
| **可扩展性** | ⭐⭐⭐ 需要修改类 | ⭐⭐⭐⭐ 插件系统完善 |
| **代码组织** | ⭐⭐⭐⭐ 职责清晰分离 | ⭐⭐⭐ 命名空间可能过大 |
| **类型安全** | ⭐⭐⭐⭐ 严格类型检查 | ⭐⭐⭐⭐ Zod 运行时验证 |
| **运行时性能** | ⭐⭐⭐ Node.js | ⭐⭐⭐⭐ Bun 更快 |

---

## 3. Agent 核心执行流程对比

### 3.1 Coding Agent 执行流程

```typescript
// src/agent-v2/agent/agent.ts

async execute(query: MessageContent, options?: LLMGenerateOptions): Promise<Message> {
    // 1. 验证输入
    this.validateInput(query);
    
    // 2. 等待初始化
    await this.initializePromise;
    
    // 3. 确保空闲状态
    this.ensureIdle();
    
    // 4. 启动任务
    this.agentState.startTask();
    
    try {
        // 5. 发送用户消息
        this.session.addMessage({ role: 'user', content: query });
        
        // 6. 运行主循环
        await this.runLoop(options);
        
        // 7. 完成任务
        this.completeTask();
        return this.getFinalMessage();
    } catch (error) {
        this.failTask(error);
        throw error;
    }
}

// 主循环
private async runLoop(options?: LLMGenerateOptions): Promise<void> {
    while (true) {
        // 检查中止
        if (this.agentState.isAborted()) break;
        
        // 检查完成条件
        const completion = await evaluateCompletion({...});
        if (completion.done) break;
        
        // 检查重试/循环限制
        if (this.agentState.isRetryExceeded()) throw ...;
        if (!this.agentState.canContinue()) throw ...;
        
        // 处理重试
        if (this.agentState.needsRetry()) {
            await this.handleRetry();
            continue;
        }
        
        // 执行 LLM 调用
        this.agentState.incrementLoop();
        await this.executeLLMCall(options);
    }
}
```

### 3.2 OpenCode 执行流程

```typescript
// src/session/processor.ts

async process(streamInput: LLM.StreamInput) {
    while (true) {
        try {
            // 1. 获取 LLM 流
            const stream = await LLM.stream(streamInput);
            
            // 2. 处理流事件
            for await (const value of stream.fullStream) {
                input.abort.throwIfAborted();
                
                switch (value.type) {
                    case "start":
                        SessionStatus.set(sessionID, { type: "busy" });
                        break;
                    
                    case "tool-call":
                        // 执行工具
                        await handleToolCall(value);
                        // 检测死循环
                        if (detectDoomLoop(value)) {
                            await PermissionNext.ask({...});
                        }
                        break;
                    
                    case "tool-result":
                        // 处理工具结果
                        await handleToolResult(value);
                        break;
                    
                    case "tool-error":
                        // 处理工具错误
                        await handleToolError(value);
                        break;
                    
                    case "finish-step":
                        // 记录使用量和快照
                        await recordUsageAndSnapshot(value);
                        break;
                    
                    // ... 其他事件
                }
            }
        } catch (e) {
            // 3. 错误处理和重试
            const retry = SessionRetry.retryable(error);
            if (retry !== undefined) {
                attempt++;
                const delay = SessionRetry.delay(attempt, error);
                await SessionRetry.sleep(delay, input.abort);
                continue;  // 重试
            }
            // 不可重试错误，发布事件并退出
            Bus.publish(Session.Event.Error, {...});
        }
        
        // 4. 返回状态
        if (needsCompaction) return "compact";
        if (blocked) return "stop";
        if (error) return "stop";
        return "continue";
    }
}
```

### 3.3 执行流程对比表

| 维度 | Coding Agent | OpenCode |
|------|-------------|----------|
| **循环控制** | `while(true)` + 显式状态检查 | `while(true)` + 流事件驱动 |
| **完成检测** | `evaluateCompletion()` 外部函数 | 流结束 + 返回状态判断 |
| **工具执行** | 批量执行 `Promise.all` | 流式逐个执行 |
| **死循环检测** | `ToolLoopDetector` 类 | 内联检测 `DOOM_LOOP_THRESHOLD` |
| **状态管理** | `AgentState` 类集中管理 | 分散在各模块 + `SessionStatus` |
| **重试控制** | `AgentState.needsRetry()` | `SessionRetry.retryable()` |

### 3.4 关键差异分析

#### Coding Agent 优势：
1. **状态管理更清晰** - `AgentState` 集中管理所有状态
2. **组件解耦更好** - LLMCaller、ToolExecutor 独立封装
3. **完成检测更完善** - 支持任务/子任务阻塞检测

#### OpenCode 优势：
1. **事件驱动更灵活** - 基于 Vercel AI SDK 的流式事件
2. **快照追踪更完善** - 每步自动追踪文件变更
3. **使用量统计更精确** - 实时计算成本和 token

---

## 4. 工具系统对比

### 4.1 Coding Agent 工具系统

```typescript
// src/agent-v2/tool/base.ts
export abstract class BaseTool<T extends z.ZodType> {
    abstract name: string;
    abstract description: string;
    abstract schema: T;
    abstract execute(args?: z.infer<T>, context?: ToolContext): Promise<ToolResult>;
}

// src/agent-v2/tool/registry.ts
export class ToolRegistry {
    private tools: Map<string, BaseTool<z.ZodType>> = new Map();
    
    register(tools: BaseTool<z.ZodType>[]): void { ... }
    
    async execute(toolCalls: ToolCall[], context?: ExecutionContext): Promise<ToolExecutionResult[]> {
        // 并行执行所有工具
        const results = await Promise.all(toolCalls.map(async (toolCall) => {
            const tool = this.tools.get(name);
            const result = await tool.execute(params, context);
            // 应用截断中间件
            if (this.truncationMiddleware && result.output) {
                result = await this.truncationMiddleware(name, result, context);
            }
            return result;
        }));
        return results;
    }
}
```

### 4.2 OpenCode 工具系统

```typescript
// src/tool/tool.ts
export namespace Tool {
    export interface Info<Parameters extends z.ZodType, M extends Metadata> {
        id: string;
        init: (ctx?: InitContext) => Promise<{
            description: string;
            parameters: Parameters;
            execute(args, ctx): Promise<{
                title: string;
                metadata: M;
                output: string;
                attachments?: MessageV2.FilePart[];
            }>;
        }>;
    }
    
    export function define<Parameters extends z.ZodType, Result>(
        id: string,
        init: Info<Parameters, Result>["init"]
    ): Info<Parameters, Result> {
        return {
            id,
            init: async (initCtx) => {
                const toolInfo = init instanceof Function ? await init(initCtx) : init;
                const execute = toolInfo.execute;
                
                // 包装 execute，添加验证和截断
                toolInfo.execute = async (args, ctx) => {
                    toolInfo.parameters.parse(args);  // 验证
                    const result = await execute(args, ctx);
                    
                    // 自动截断
                    if (result.metadata.truncated === undefined) {
                        const truncated = await Truncate.output(result.output, {}, initCtx?.agent);
                        return { ...result, output: truncated.content };
                    }
                    return result;
                };
                return toolInfo;
            }
        };
    }
}

// src/tool/registry.ts
export namespace ToolRegistry {
    export async function tools(providerID: string, agent?: Agent.Info) {
        const tools = await all();
        
        // 并行初始化所有工具
        const result = await Promise.all(
            tools
                .filter(t => filterByPermission(t, providerID))
                .map(async (t) => ({
                    id: t.id,
                    ...(await t.init({ agent }))
                }))
        );
        return result;
    }
}
```

### 4.3 工具系统对比表

| 维度 | Coding Agent | OpenCode |
|------|-------------|----------|
| **定义方式** | 抽象类继承 | 函数式 `Tool.define()` |
| **初始化** | 构造时注册 | 惰性初始化 `init()` |
| **执行方式** | 并行 `Promise.all` | 流式逐个执行 |
| **参数验证** | Zod `safeParse` | Zod `parse` |
| **输出截断** | 中间件模式 | 内置自动截断 |
| **超时控制** | `executeWithTimeout` | 无内置超时 |
| **权限过滤** | `PermissionEngine` | `PermissionNext` |
| **附件支持** | 无 | 支持 `attachments` |

### 4.4 工具定义示例对比

#### Coding Agent:
```typescript
export class ReadFileTool extends BaseTool<typeof ReadSchema> {
    name = 'read_file';
    description = 'Read file content';
    schema = z.object({
        filePath: z.string().describe('File path'),
    });
    
    async execute(args: { filePath: string }, context?: ToolContext): Promise<ToolResult> {
        const content = await fs.readFile(args.filePath, 'utf-8');
        return { success: true, output: content };
    }
}
```

#### OpenCode:
```typescript
export const ReadTool = Tool.define("read", {
    description: "Read file content",
    parameters: z.object({
        filePath: z.string().describe("File path"),
    }),
    async execute(args, ctx) {
        const content = await Bun.file(args.filePath).text();
        return {
            title: `Read ${args.filePath}`,
            output: content,
            metadata: {},
        };
    }
});
```

---

## 5. 存储与持久化对比

### 5.1 Coding Agent 存储系统

```typescript
// src/agent-v2/memory/memory-manager.ts
export class MemoryManager extends MemoryOrchestrator {
    constructor(options: MemoryManagerOptions) {
        super(createStoreBundle(options));
    }
}

// 支持多种存储后端
export interface StoreBundle {
    sessionStore: ISessionStore;
    contextStore: IContextStore;
    historyStore: IHistoryStore;
    taskStore: ITaskStore;
    compactionStore: ICompactionStore;
}

// 文件存储实现
export class FileStoreBundle implements StoreBundle {
    // 基于 JSON 文件的存储
    // 路径: {data}/sessions/{sessionId}/context.json
}
```

### 5.2 OpenCode 存储系统

```typescript
// src/storage/storage.ts
export namespace Storage {
    // 键值对存储
    export async function read<T>(key: string[]): Promise<T>;
    export async function write<T>(key: string[], content: T): Promise<void>;
    export async function update<T>(key: string[], fn: (draft: T) => void): Promise<T>;
    export async function remove(key: string[]): Promise<void>;
    export async function list(prefix: string[]): Promise<string[][]>;
}

// 存储结构
// {data}/storage/
//   session/{projectId}/{sessionId}.json
//   message/{sessionId}/{messageId}.json
//   part/{messageId}/{partId}.json
//   session_diff/{sessionId}.json
```

### 5.3 存储系统对比表

| 维度 | Coding Agent | OpenCode |
|------|-------------|----------|
| **架构模式** | 仓库模式 + 依赖注入 | 命名空间 + 键值对 |
| **存储后端** | 文件 / MongoDB | 文件 (Bun 优化) |
| **并发控制** | 无内置锁 | 读写锁 `Lock.read/write` |
| **数据迁移** | 无 | 内置迁移系统 |
| **消息存储** | Context + History 分离 | Message + Part 分离 |
| **事务支持** | 无 | 无 |

### 5.4 消息结构对比

#### Coding Agent:
```typescript
interface Message {
    messageId: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: MessageContent;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    finish_reason?: FinishReason;
    usage?: Usage;
}
```

#### OpenCode:
```typescript
interface MessageInfo {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    parentID?: string;
    agent?: string;
    error?: APIError;
}

type MessagePart = TextPart | ToolPart | ReasoningPart | FilePart | StepStartPart | StepFinishPart | PatchPart;
```

**关键差异：** OpenCode 采用消息+部分(Part)的分离设计，支持更细粒度的增量更新和流式处理。

---

## 6. 异常处理与重试机制对比

### 6.1 Coding Agent 异常处理

```typescript
// src/agent-v2/agent/errors.ts
export class AgentError extends Error {
    public readonly code?: string;
    public readonly cause?: unknown;
    public readonly context?: Record<string, unknown>;
}

// 专用错误子类
export class AgentAbortedError extends AgentError { ... }
export class AgentMaxRetriesExceededError extends AgentError { ... }
export class LLMRetryableError extends Error { ... }
export class LLMContextCompressionError extends LLMRetryableError { ... }

// src/agent-v2/agent/error-classifier.ts
export class ErrorClassifier {
    classifyFailureCode(error: unknown, status?: string): AgentFailureCode {
        // 1. 检查 Agent 状态
        // 2. 检查专用错误子类
        // 3. 检查 AgentError.code
        // 4. 检查 Provider 层错误
        // 5. 消息内容匹配
        // 6. 默认返回 RUNTIME_ERROR
    }
}
```

### 6.2 OpenCode 异常处理

```typescript
// src/session/retry.ts
export namespace SessionRetry {
    export const RETRY_INITIAL_DELAY = 2000;  // 2秒
    export const RETRY_BACKOFF_FACTOR = 2;    // 指数退避
    
    export function delay(attempt: number, error?: APIError): number {
        if (error) {
            // 优先使用响应头中的 retry-after
            const retryAfterMs = headers["retry-after-ms"];
            if (retryAfterMs) return parseFloat(retryAfterMs);
            
            const retryAfter = headers["retry-after"];
            // 解析秒数或 HTTP 日期
        }
        // 指数退避
        return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), MAX_DELAY);
    }
    
    export function retryable(error): string | undefined {
        if (APIError.isInstance(error)) {
            if (!error.data.isRetryable) return undefined;
            return error.data.message;
        }
        // 检查 JSON 错误格式
        // too_many_requests, exhausted, rate_limit, server_error
    }
}
```

### 6.3 异常处理对比表

| 维度 | Coding Agent | OpenCode |
|------|-------------|----------|
| **错误分类** | `ErrorClassifier` 类 | 命名空间函数 |
| **错误继承** | 完整的继承层次 | 简单继承 + Zod 错误 |
| **重试延迟** | 固定 + `retryAfterMs` 提取 | 指数退避 + HTTP 头解析 |
| **上下文压缩** | `LLMContextCompressionError` | 无特殊处理 |
| **错误上下文** | 支持 `context` 字段 | 支持 `data` 字段 |
| **类型守卫** | 完整的 `is*Error` 函数 | Zod `.isInstance()` |

### 6.4 重试策略对比

#### Coding Agent:
```typescript
// 重试延迟计算
private resolveRetryDelay(error: unknown): number {
    const retryAfterMs = this.extractRetryAfterMs(error);
    if (retryAfterMs) return retryAfterMs;
    return this.agentState.nextRetryDelayMs;  // 固定延迟
}

// 重试条件
if (!isRetryableError(error)) throw error;
this.agentState.recordRetryableError(delay);
```

#### OpenCode:
```typescript
// 指数退避
const delay = SessionRetry.delay(attempt, error);
// delay = 2000 * 2^(attempt-1), 最大 30秒

// 重试条件
const retry = SessionRetry.retryable(error);
if (retry !== undefined) {
    attempt++;
    await SessionRetry.sleep(delay, abort);
    continue;
}
```

**关键差异：** OpenCode 使用指数退避策略，更适合处理速率限制；Coding Agent 的固定延迟可能导致频繁重试失败。

---

## 7. 会话管理对比

### 7.1 Coding Agent 会话管理

```typescript
// src/agent-v2/session/index.ts
export class Session {
    private messages: Message[] = [];
    private readonly compaction?: Compaction;
    
    // 消息管理
    addMessage(message: Message): string;
    getMessages(): Message[];
    async removeMessageById(messageId: string, reason: ContextExclusionReason): Promise<Message>;
    
    // 压缩功能
    async compactBeforeLLMCall(): Promise<boolean>;
    getTokenInfo(): TokenInfo;
    
    // 持久化
    async sync(): Promise<void>;
    private schedulePersist(message: Message, operation: 'add' | 'update'): void;
    
    // 工具协议修复
    private async repairContextToolProtocol(): Promise<void>;
}
```

### 7.2 OpenCode 会话管理

```typescript
// src/session/index.ts
export namespace Session {
    // 会话生命周期
    export async function create(input?): Promise<Info>;
    export async function fork(input): Promise<Info>;
    export async function get(id): Promise<Info>;
    export async function remove(sessionID): Promise<void>;
    
    // 消息管理
    export async function messages(input): Promise<WithParts[]>;
    export async function updateMessage(msg): Promise<MessageInfo>;
    export async function removeMessage(input): Promise<string>;
    
    // 部分(Part)管理
    export async function updatePart(input): Promise<Part>;
    export async function removePart(input): Promise<string>;
    
    // 使用量计算
    export const getUsage = fn(schema, (input) => {
        // 精确计算成本和 token
        return { cost, tokens };
    });
}

// 会话事件
export const Event = {
    Created, Updated, Deleted, Diff, Error
};
```

### 7.3 会话管理对比表

| 维度 | Coding Agent | OpenCode |
|------|-------------|----------|
| **架构** | 类封装 | 命名空间函数 |
| **会话分叉** | 不支持 | 支持 `fork()` |
| **消息更新** | 增量更新 | 部分(Part)级别更新 |
| **使用量统计** | 简单累加 | 精确计算（Decimal.js） |
| **事件发布** | EventBus | Bus.publish |
| **压缩触发** | `compactBeforeLLMCall()` | `SessionCompaction.isOverflow()` |
| **共享/导出** | 不支持 | 支持 `share()` |

### 7.4 上下文压缩对比

#### Coding Agent:
```typescript
export class Compaction {
    async compact(messages: Message[], sessionId: string, memoryManager?: IMemoryManager): Promise<CompactionResult> {
        // 1. 计算 token
        const tokenInfo = this.getTokenInfo(messages);
        if (!this.shouldCompact(tokenInfo)) {
            return { isCompacted: false, messages };
        }
        
        // 2. 选择要压缩的消息
        const toCompact = this.selectMessagesForCompaction(messages);
        
        // 3. 调用 LLM 生成摘要
        const summary = await this.generateSummary(toCompact);
        
        // 4. 替换消息
        return { isCompacted: true, messages: [...keepMessages, summaryMessage] };
    }
}
```

#### OpenCode:
```typescript
export namespace SessionCompaction {
    export async function isOverflow(input: { tokens, model }): Promise<boolean> {
        // 检查是否超过模型限制的 90%
    }
    
    export async function compact(input: { sessionID, model }): Promise<void> {
        // 1. 获取消息
        // 2. 生成摘要
        // 3. 更新会话
    }
}
```

---

## 8. 权限系统对比

### 8.1 Coding Agent 权限系统

```typescript
// src/agent-v2/security/permission-engine.ts
export class PermissionEngine {
    evaluate(input: { toolCall, sessionId, messageId, planMode }): PermissionDecision {
        // 规则匹配
        for (const rule of this.rules) {
            if (this.matchesRule(toolCall, rule)) {
                return {
                    effect: rule.effect,  // 'allow' | 'deny' | 'ask'
                    reason: rule.reason,
                    ticket: rule.effect === 'ask' ? { id: generateTicketId() } : undefined,
                };
            }
        }
        return { effect: 'allow' };
    }
}

// 使用
if (decision.effect === 'ask') {
    const approved = await this.config.onPermissionAsk?.({...});
    if (!approved) throw new AgentAbortedError(...);
}
```

### 8.2 OpenCode 权限系统

```typescript
// src/permission/next.ts
export namespace PermissionNext {
    export type Ruleset = PermissionRule[];
    
    export function fromConfig(config): Ruleset {
        // 将配置转换为规则集
    }
    
    export function merge(...rulesets): Ruleset {
        // 合并多个规则集
    }
    
    export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
        // 返回被禁用的工具集合
    }
    
    export async function ask(input: {
        permission: string;
        patterns: string[];
        sessionID: string;
        metadata: any;
        always: string[];
        ruleset: Ruleset;
    }): Promise<void> {
        // 发布权限请求事件
        Bus.publish(Event.PermissionAsked, {...});
        // 等待用户响应
    }
}
```

### 8.3 权限系统对比表

| 维度 | Coding Agent | OpenCode |
|------|-------------|----------|
| **架构** | 类封装 `PermissionEngine` | 命名空间函数 |
| **规则合并** | 不支持 | `merge()` 支持多层合并 |
| **权限类型** | allow/deny/ask | allow/deny/ask |
| **规则来源** | 构造时传入 | 配置 + Agent + 用户 |
| **交互方式** | 回调函数 | 事件发布/订阅 |
| **模式匹配** | 工具名称匹配 | glob 模式匹配 |

---

## 9. 扩展性对比

### 9.1 Coding Agent 扩展性

```typescript
// 1. 自定义工具
class MyTool extends BaseTool<typeof Schema> {
    name = 'my_tool';
    description = '...';
    schema = z.object({...});
    async execute(args, context) { ... }
}

// 2. 自定义存储后端
class MyStoreBundle implements StoreBundle {
    sessionStore: ISessionStore;
    contextStore: IContextStore;
    // ...
}

// 3. 自定义 Provider
class MyProvider implements LLMProvider {
    async generate(messages, options) { ... }
}
```

### 9.2 OpenCode 扩展性

```typescript
// 1. 自定义工具
export const MyTool = Tool.define("my_tool", {
    description: "...",
    parameters: z.object({...}),
    async execute(args, ctx) { ... }
});

// 2. 插件系统
export namespace Plugin {
    export async function trigger(hook: string, context, input) {
        // 触发插件钩子
    }
}

// 钩子点:
// - experimental.chat.system.transform
// - chat.params
// - experimental.text.complete

// 3. MCP 服务器
// - 支持远程 HTTP/SSE
// - 支持本地命令

// 4. 自定义 Agent
// 通过配置文件定义
{
    "agent": {
        "my_agent": {
            "prompt": "...",
            "permission": {...},
            "model": "provider/model"
        }
    }
}
```

### 9.3 扩展性对比表

| 维度 | Coding Agent | OpenCode |
|------|-------------|----------|
| **工具扩展** | 继承 `BaseTool` | `Tool.define()` |
| **存储扩展** | 实现 `StoreBundle` | 无（固定文件存储） |
| **Provider 扩展** | 实现 `LLMProvider` | 配置 + 适配器 |
| **插件系统** | 无 | 完善的钩子系统 |
| **MCP 支持** | 有 | 有（更完善） |
| **配置化 Agent** | 不支持 | 支持配置文件 |

---

## 10. Coding Agent 不足与改进建议

### 10.1 架构层面

#### 问题 1: 缺少插件系统

**现状：** Coding Agent 没有插件扩展机制，所有功能都是硬编码的。

**影响：**
- 难以在不修改代码的情况下扩展功能
- 无法支持第三方扩展

**建议：**
```typescript
// 添加插件钩子系统
export interface PluginHook {
    name: string;
    handler: (context: unknown, input: unknown) => Promise<unknown>;
}

export class PluginManager {
    private hooks: Map<string, PluginHook[]> = new Map();
    
    register(hook: string, handler: PluginHook): void;
    async trigger<T>(hook: string, context: unknown, input: T): Promise<T>;
}

// 钩子点示例:
// - 'agent.beforeExecute'
// - 'agent.afterExecute'
// - 'tool.beforeExecute'
// - 'tool.afterExecute'
// - 'llm.beforeCall'
// - 'llm.afterCall'
// - 'session.beforeCompact'
```

#### 问题 2: 重试策略不够智能

**现状：** 使用固定延迟重试，可能导致速率限制时频繁失败。

**影响：**
- 速率限制场景下效率低
- 浪费 API 调用配额

**建议：**
```typescript
// 实现指数退避
export class RetryStrategy {
    private baseDelay: number = 2000;
    private maxDelay: number = 30000;
    private backoffFactor: number = 2;
    
    calculateDelay(attempt: number, error?: Error): number {
        // 1. 检查 HTTP 响应头
        const retryAfter = this.extractRetryAfter(error);
        if (retryAfter) return retryAfter;
        
        // 2. 指数退避
        const delay = this.baseDelay * Math.pow(this.backoffFactor, attempt - 1);
        return Math.min(delay, this.maxDelay);
    }
    
    private extractRetryAfter(error: unknown): number | undefined {
        // 从错误中提取 retry-after-ms 或 retry-after 头
    }
}
```

#### 问题 3: 缺少使用量精确统计

**现状：** 使用量统计简单累加，不支持精确成本计算。

**影响：**
- 成本估算不准确
- 无法支持不同模型的差异化定价

**建议：**
```typescript
// 添加精确成本计算
import { Decimal } from 'decimal.js';

export interface PricingInfo {
    input: number;       // 每百万 token 价格
    output: number;
    cacheRead?: number;  // 缓存读取价格
    cacheWrite?: number; // 缓存写入价格
}

export class UsageCalculator {
    calculate(usage: Usage, pricing: PricingInfo): { cost: number; tokens: TokenBreakdown } {
        const cost = new Decimal(0)
            .add(new Decimal(usage.inputTokens).mul(pricing.input).div(1_000_000))
            .add(new Decimal(usage.outputTokens).mul(pricing.output).div(1_000_000))
            .add(new Decimal(usage.cachedInputTokens ?? 0).mul(pricing.cacheRead ?? 0).div(1_000_000))
            .toNumber();
        
        return { cost, tokens: {...} };
    }
}
```

### 10.2 功能层面

#### 问题 4: 缺少会话分叉功能

**现状：** 不支持从历史消息分叉新会话。

**影响：**
- 无法进行实验性操作
- 回溯困难

**建议：**
```typescript
export class Session {
    async fork(options: { fromMessageId?: string }): Promise<Session> {
        const newSession = new Session({...});
        
        // 复制消息到指定点
        const messages = this.messages.slice(
            0, 
            options.fromMessageId 
                ? this.messages.findIndex(m => m.messageId === options.fromMessageId) + 1
                : undefined
        );
        
        for (const msg of messages) {
            await newSession.addMessage({...msg, messageId: uuid()});
        }
        
        return newSession;
    }
}
```

#### 问题 5: 缺少文件变更快照

**现状：** 不追踪文件变更历史。

**影响：**
- 无法查看代码修改历史
- 难以回滚变更

**建议：**
```typescript
export class SnapshotManager {
    async track(): Promise<string> {
        // 记录当前文件状态
    }
    
    async patch(snapshotId: string): Promise<FileDiff[]> {
        // 计算与快照的差异
    }
    
    async revert(snapshotId: string): Promise<void> {
        // 恢复到快照状态
    }
}

// 在工具执行前后调用
const beforeSnapshot = await snapshotManager.track();
await tool.execute(args);
const patch = await snapshotManager.patch(beforeSnapshot);
```

#### 问题 6: 消息存储粒度较粗

**现状：** 整条消息存储，不支持增量更新。

**影响：**
- 流式输出时频繁重写整条消息
- 存储效率低

**建议：**
```typescript
// 采用 Message + Part 分离设计
interface MessageInfo {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant';
    parentID?: string;
}

type MessagePart = 
    | { type: 'text'; id: string; text: string; }
    | { type: 'tool'; id: string; tool: string; state: ToolState; }
    | { type: 'reasoning'; id: string; text: string; };

// 增量更新
await session.updatePart({
    part: textPart,
    delta: newText,  // 只传输增量
});
```

### 10.3 用户体验层面

#### 问题 7: 缺少会话分享功能

**现状：** 不支持会话导出/分享。

**建议：**
```typescript
export class SessionSharer {
    async share(sessionId: string): Promise<{ url: string; secret: string }> {
        // 生成分享链接
    }
    
    async unshare(sessionId: string): Promise<void> {
        // 取消分享
    }
    
    async export(sessionId: string): Promise<string> {
        // 导出为 JSON/Markdown
    }
}
```

#### 问题 8: 错误消息用户友好性不足

**现状：** 错误消息偏向技术性描述。

**建议：**
```typescript
export class UserFriendlyErrors {
    static format(error: unknown): { userMessage: string; internalMessage: string } {
        if (error instanceof AgentMaxRetriesExceededError) {
            if (error.isRateLimit) {
                return {
                    userMessage: 'API 请求频率超限，请稍后重试。',
                    internalMessage: error.message,
                };
            }
        }
        // ...
    }
}
```

### 10.4 性能层面

#### 问题 9: 工具执行无并发限制

**现状：** 使用 `Promise.all` 并行执行所有工具，无限制。

**影响：**
- 资源竞争
- 可能导致系统过载

**建议：**
```typescript
export class ConcurrencyLimiter {
    private semaphore: Semaphore;
    
    constructor(maxConcurrency: number = 5) {
        this.semaphore = new Semaphore(maxConcurrency);
    }
    
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        await this.semaphore.acquire();
        try {
            return await fn();
        } finally {
            this.semaphore.release();
        }
    }
}
```

#### 问题 10: 存储缺少并发控制

**现状：** 文件存储无锁保护，可能并发写入冲突。

**建议：**
```typescript
export class ReadWriteLock {
    private readers: number = 0;
    private writer: boolean = false;
    private readQueue: (() => void)[] = [];
    private writeQueue: (() => void)[] = [];
    
    async read<T>(fn: () => Promise<T>): Promise<T>;
    async write<T>(fn: () => Promise<T>): Promise<T>;
}

// 使用
using _ = await lock.write(filePath);
await fs.writeFile(filePath, content);
```

---

## 11. 总结

### 11.1 整体评价

| 维度 | Coding Agent | OpenCode | 评价 |
|------|-------------|----------|------|
| **代码质量** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 两者都有良好的代码组织 |
| **架构设计** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 协调器 vs 命名空间，各有优势 |
| **功能完整性** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | OpenCode 功能更丰富 |
| **扩展性** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | OpenCode 插件系统更完善 |
| **错误处理** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 两者都有完善的错误分类 |
| **测试覆盖** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 两者都有较好的测试 |
| **文档完善度** | ⭐⭐⭐ | ⭐⭐⭐⭐ | OpenCode 代码注释更详细 |

### 11.2 Coding Agent 优势

1. **架构清晰** - 协调器模式职责分明，易于理解
2. **状态集中** - AgentState 统一管理，便于调试
3. **组件解耦** - LLMCaller、ToolExecutor 独立可测
4. **类型安全** - TypeScript 严格模式，Zod 运行时验证
5. **完成检测** - 支持任务/子任务阻塞检测

### 11.3 OpenCode 优势

1. **插件系统** - 完善的钩子机制，易于扩展
2. **会话分叉** - 支持实验性操作
3. **精确计费** - Decimal.js 精确成本计算
4. **文件快照** - 自动追踪代码变更
5. **消息分离** - Part 级别增量更新
6. **会话分享** - 支持导出和分享
7. **读写锁** - 并发写入保护
8. **数据迁移** - 内置迁移系统

### 11.4 优先改进建议

1. **高优先级：**
   - 实现指数退避重试策略
   - 添加精确成本计算
   - 添加文件变更快照

2. **中优先级：**
   - 实现插件系统
   - 支持会话分叉
   - 添加读写锁

3. **低优先级：**
   - 优化消息存储粒度
   - 添加会话分享功能
   - 改进错误消息友好性

---

## 附录

### A. 文件结构对比

#### Coding Agent:
```
src/agent-v2/
├── agent/
│   ├── agent.ts          # Agent 主类
│   ├── core/
│   │   ├── llm-caller.ts
│   │   ├── tool-executor.ts
│   │   └── agent-state.ts
│   └── errors.ts
├── tool/
│   ├── base.ts
│   ├── registry.ts
│   └── *.ts              # 各工具实现
├── session/
│   ├── index.ts
│   └── compaction.ts
├── memory/
│   ├── memory-manager.ts
│   └── adapters/
├── providers/
└── eventbus/
```

#### OpenCode:
```
src/
├── agent/
│   └── agent.ts          # Agent 配置
├── tool/
│   ├── tool.ts           # 工具定义
│   ├── registry.ts
│   └── *.ts
├── session/
│   ├── index.ts
│   ├── llm.ts
│   ├── processor.ts
│   ├── retry.ts
│   └── compaction.ts
├── storage/
│   └── storage.ts
├── provider/
│   └── provider.ts
├── acp/                  # ACP 协议实现
└── plugin/               # 插件系统
```

### B. 关键指标对比

| 指标 | Coding Agent | OpenCode |
|------|-------------|----------|
| 源文件数量 | ~200 | ~230 |
| 核心代码行数 | ~15,000 | ~20,000 |
| 测试文件数量 | ~50 | ~30 |
| 内置工具数量 | 12 | 18 |
| 支持 Provider | 3 | 10+ |
| Agent 类型 | 1 | 7 |

---

*报告生成时间: 2026-03-03*
*对比版本: Coding Agent main vs OpenCode latest*
