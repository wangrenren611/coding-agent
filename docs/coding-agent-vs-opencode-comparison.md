# Coding Agent vs OpenCode 深度对比分析报告

> 对比版本：2026-03-03
> 分析范围：Agent 核心逻辑、工具系统、存储系统、异常处理、执行流程

---

## 目录

1. [执行摘要](#执行摘要)
2. [架构对比](#架构对比)
3. [Agent 核心逻辑对比](#agent-核心逻辑对比)
4. [工具系统对比](#工具系统对比)
5. [存储系统对比](#存储系统对比)
6. [异常处理对比](#异常处理对比)
7. [权限系统对比](#权限系统对比)
8. [上下文压缩对比](#上下文压缩对比)
9. [Coding Agent 不足与改进建议](#coding-agent-不足与改进建议)
10. [总结](#总结)

---

## 执行摘要

### 项目概述

| 维度 | Coding Agent | OpenCode |
|------|--------------|----------|
| **语言** | TypeScript (Node.js) | TypeScript (Bun) |
| **架构模式** | 协调器模式 | 命名空间 + 函数式 |
| **运行时** | Node.js 20+ | Bun (原生) |
| **Provider 支持** | GLM, Kimi, MiniMax 等 | 20+ Provider (含 OpenAI, Anthropic, Bedrock) |
| **持久化** | 抽象接口 (可插拔) | 文件系统 Storage |
| **权限系统** | Plan Mode 黑白名单 | 完整的三层权限合并系统 |

### 关键差异总结

1. **OpenCode 更成熟**：权限系统、死循环检测、数据迁移、Provider 生态更完善
2. **Coding Agent 更简洁**：协调器模式更清晰，代码结构更易理解
3. **OpenCode 功能更丰富**：插件系统、会话分享、回滚功能、会话分叉
4. **Coding Agent 需改进**：权限系统、Provider 生态、数据迁移、死循环检测

---

## 架构对比

### Coding Agent 架构

```
┌─────────────────────────────────────────────────────┐
│                     Agent (协调器)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ AgentState  │  │ LLMCaller   │  │ToolExecutor │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Session    │  │AgentEmitter │  │EventBus     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │Provider  │  │ToolRegistry│ │MemoryMgr │
    └──────────┘  └──────────┘  └──────────┘
```

**特点**：
- 使用类和依赖注入
- 协调器模式，职责分离清晰
- 组件间通过回调和事件总线通信

### OpenCode 架构

```
┌─────────────────────────────────────────────────────┐
│                   Namespace 模块                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ Session (namespace)                              ││
│  │   ├── SessionProcessor.create()                  ││
│  │   ├── SessionCompaction.process()               ││
│  │   └── SessionRetry.retryable()                  ││
│  ├─────────────────────────────────────────────────┤│
│  │ Agent (namespace)                                ││
│  │   ├── Agent.get()                               ││
│  │   └── PermissionNext.merge()                    ││
│  ├─────────────────────────────────────────────────┤│
│  │ Storage (namespace)                              ││
│  │   ├── read/write/update/remove/list             ││
│  │   └── MIGRATIONS (数据迁移)                       ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

**特点**：
- 命名空间 + 函数式设计
- 使用 `Instance.state()` 实现惰性初始化和缓存
- Zod Schema 驱动的类型验证

---

## Agent 核心逻辑对比

### 执行流程对比

#### Coding Agent 主循环

```typescript
// coding-agent/src/agent-v2/agent/agent.ts
private async runLoop(options?: LLMGenerateOptions): Promise<void> {
    while (true) {
        // 1. 完成度检测
        const completion = await evaluateCompletion({...});

        // 2. 任务阻塞处理
        if (completion.blockedByTasks) { ... }

        // 3. 重试检查
        if (this.agentState.needsRetry()) {
            await this.handleRetry();
        }

        // 4. 循环次数限制
        if (!this.agentState.canContinue()) {
            throw new AgentLoopExceededError();
        }

        // 5. 执行 LLM 调用
        await this.executeLLMCall(options);
    }
}
```

#### OpenCode 主循环

```typescript
// opencode/src/session/processor.ts
async process(streamInput: LLM.StreamInput) {
    while (true) {
        try {
            const stream = await LLM.stream(streamInput)

            for await (const value of stream.fullStream) {
                switch (value.type) {
                    case "tool-call": {
                        // 死循环检测
                        const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)
                        if (lastThree.every(p =>
                            p.tool === value.toolName &&
                            JSON.stringify(p.state.input) === JSON.stringify(value.input)
                        )) {
                            await PermissionNext.ask({
                                permission: "doom_loop",
                                ...
                            })
                        }
                    }
                }
            }
        } catch (e) {
            // 重试逻辑
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
                await SessionRetry.sleep(delay, input.abort)
                continue
            }
        }
    }
}
```

### 关键差异

| 特性 | Coding Agent | OpenCode |
|------|--------------|----------|
| **死循环检测** | ToolLoopDetector（基于工具调用签名） | DOOM_LOOP_THRESHOLD（3次相同调用触发权限询问） |
| **重试机制** | 指数退避，可配置延迟 | 支持响应头 retry-after，指数退避 |
| **状态管理** | AgentState 类 | 变量 + AbortSignal |
| **流式处理** | LLMCaller + StreamProcessor | Vercel AI SDK fullStream |
| **完成检测** | evaluateCompletion 函数 | finish-step 事件 |

### OpenCode 独有特性

1. **死循环检测更智能**：检测连续 3 次相同工具调用，触发权限询问而非直接报错
2. **响应头重试**：解析 `retry-after-ms` 和 `retry-after` 响应头，精确控制重试时间
3. **步骤追踪**：`start-step` / `finish-step` 事件，配合 Snapshot 追踪文件变化

---

## 工具系统对比

### Coding Agent 工具基类

```typescript
// coding-agent/src/agent-v2/tool/base.ts
export abstract class BaseTool<T extends z.ZodType> {
    abstract name: string;
    abstract description: string;
    abstract schema: T;

    executionTimeoutMs?: number | null;

    abstract execute(args?: z.infer<T>, context?: ToolContext): Promise<ToolResult>;

    protected result<T>({success, metadata, output}): ToolResult<T> {
        return { success, metadata, output };
    }
}
```

### OpenCode 工具定义

```typescript
// opencode/src/tool/tool.ts
export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: Info<Parameters, Result>["init"] | Awaited<ReturnType<...>>
): Info<Parameters, Result> {
    return {
        id,
        init: async (initCtx) => {
            const toolInfo = init instanceof Function ? await init(initCtx) : init

            // 包装 execute：自动参数验证 + 输出截断
            toolInfo.execute = async (args, ctx) => {
                // 1. 参数验证
                toolInfo.parameters.parse(args)

                // 2. 执行工具
                const result = await execute(args, ctx)

                // 3. 自动输出截断
                const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
                return {
                    ...result,
                    output: truncated.content,
                    metadata: {
                        ...result.metadata,
                        truncated: truncated.truncated,
                    }
                }
            }
            return toolInfo
        }
    }
}
```

### 关键差异

| 特性 | Coding Agent | OpenCode |
|------|--------------|----------|
| **定义方式** | 抽象类继承 | 函数式 define() |
| **参数验证** | ToolRegistry 中执行 | define() 自动包装 |
| **输出截断** | ToolRegistry 中间件 | define() 自动处理 |
| **工具上下文** | ToolContext 接口 | Context 类型（含权限请求） |
| **动态加载** | 不支持 | 支持配置目录 + 插件加载 |

### OpenCode 工具上下文更丰富

```typescript
// OpenCode 工具上下文
export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    metadata(input: { title?: string; metadata?: M }): void
    // 内置权限请求能力
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
}
```

**优势**：工具内部可以直接请求权限，无需外部协调

---

## 存储系统对比

### Coding Agent 存储抽象

```typescript
// coding-agent/src/agent-v2/memory/types.ts
export interface IMemoryManager {
    createSession(sessionId: string, systemPrompt: string): Promise<void>;
    addMessageToContext(sessionId: string, message: Message): Promise<void>;
    updateMessageInContext(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void>;
    removeMessageFromContext(sessionId: string, messageId: string, reason: ContextExclusionReason): Promise<void>;
    getCurrentContext(sessionId: string): Promise<SessionContext | null>;
    // ...
}
```

**特点**：
- 接口抽象，可插拔实现
- 内存中维护消息列表
- 持久化通过 MemoryManager 委托

### OpenCode 存储系统

```typescript
// opencode/src/storage/storage.ts
export namespace Storage {
    // 键值对存储 API
    export async function read<T>(key: string[]): Promise<T>
    export async function write<T>(key: string[], content: T): Promise<void>
    export async function update<T>(key: string[], fn: (draft: T) => void): Promise<T>
    export async function remove(key: string[]): Promise<void>
    export async function list(prefix: string[]): Promise<string[][]>

    // 数据迁移系统
    const MIGRATIONS: Migration[] = [
        async (dir) => { /* 迁移 #0：项目结构迁移 */ },
        async (dir) => { /* 迁移 #1：会话差异摘要迁移 */ },
    ]
}
```

**特点**：
- 文件系统直接存储
- 键路径组织（如 `["session", projectID, sessionID]`）
- 内置数据迁移系统
- 读写锁保护并发访问

### 关键差异

| 特性 | Coding Agent | OpenCode |
|------|--------------|----------|
| **存储介质** | 抽象接口（可扩展） | 文件系统 JSON |
| **数据迁移** | 无 | 完整迁移系统 |
| **并发控制** | 无内置 | 读写锁保护 |
| **存储结构** | 内存 + 持久化 | 纯文件系统 |
| **版本控制** | 无 | 有（迁移版本号） |

### OpenCode 存储优势

1. **数据迁移**：支持增量迁移，保持数据兼容性
2. **并发安全**：读写锁保护，防止并发写入冲突
3. **简单直接**：键值对 API，易于理解和使用
4. **可观测性**：文件系统存储便于调试和备份

---

## 异常处理对比

### Coding Agent 异常处理

```typescript
// coding-agent/src/agent-v2/agent/agent.ts
private async handleLoopError(error: unknown): Promise<void> {
    // 检查是否为可重试错误
    if (!isRetryableError(error)) {
        throw error;  // 不可重试，直接抛出
    }

    // 特殊处理：上下文压缩错误
    if (isLLMContextCompressionError(error)) {
        await this.session.compactBeforeLLMCall();
    }

    // 记录重试
    const delay = this.resolveRetryDelay(error);
    this.agentState.recordRetryableError(delay);
    this.pendingRetryReason = this.formatRetryReason(error);
}
```

### OpenCode 异常处理

```typescript
// opencode/src/session/retry.ts
export namespace SessionRetry {
    export const RETRY_INITIAL_DELAY = 2000      // 2秒
    export const RETRY_BACKOFF_FACTOR = 2        // 指数退避因子
    export const RETRY_MAX_DELAY_NO_HEADERS = 30000  // 30秒

    export function delay(attempt: number, error?: MessageV2.APIError) {
        if (error) {
            const headers = error.data.responseHeaders
            // 优先使用 retry-after-ms 头部
            if (headers["retry-after-ms"]) {
                return parseFloat(headers["retry-after-ms"])
            }
            // 其次使用 retry-after 头部（秒或日期）
            if (headers["retry-after"]) {
                return parseFloat(headers["retry-after"]) * 1000
            }
        }
        // 指数退避
        return Math.min(
            RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
            RETRY_MAX_DELAY_NO_HEADERS
        )
    }

    export function retryable(error) {
        // 分类处理各种错误
        if (MessageV2.APIError.isInstance(error)) {
            if (!error.data.isRetryable) return undefined
            return error.data.message.includes("Overloaded")
                ? "Provider is overloaded"
                : error.data.message
        }
        // JSON 错误解析
        // ...
    }
}
```

### 关键差异

| 特性 | Coding Agent | OpenCode |
|------|--------------|----------|
| **错误分类** | isRetryableError() | SessionRetry.retryable() |
| **重试延迟** | 固定/指数退避 | 响应头优先 + 指数退避 |
| **最大重试** | 20 次 | 无上限（由调用方控制） |
| **错误恢复** | 上下文压缩 | 自动重试 + 状态恢复 |

### OpenCode 重试优势

1. **响应头感知**：解析 HTTP 响应头精确控制重试时间
2. **可中断延迟**：`sleep(ms, signal)` 支持用户中断
3. **错误分类更细**：区分 Overloaded、Rate Limited、Server Error 等

---

## 权限系统对比

### Coding Agent 权限系统

```typescript
// coding-agent/src/agent-v2/plan/plan-mode.ts
export const READ_ONLY_TOOLS = new Set([
    'read_file', 'glob', 'grep', 'lsp', 'web_fetch', 'web_search', 'task', ...
]);

export const BLOCKED_TOOL_PATTERNS = [
    /^write_file$/, /^precise_replace$/, /^batch_replace$/, /^bash$/, ...
];

// Plan 模式下检查
private getPlanModeBlockedTools(toolCalls: ToolCall[]): string[] {
    const blocked: string[] = [];
    for (const toolCall of toolCalls) {
        if (!READ_ONLY_TOOLS.has(toolName) || BLOCKED_TOOL_PATTERNS.test(toolName)) {
            blocked.push(toolName);
        }
    }
    return blocked;
}
```

### OpenCode 权限系统

```typescript
// opencode/src/permission/next.ts
export namespace PermissionNext {
    export const Action = z.enum(["allow", "deny", "ask"])

    export const Rule = z.object({
        permission: z.string(),
        pattern: z.string(),
        action: Action,
    })

    // 三层权限合并
    export function merge(...rulesets: Ruleset[]): Ruleset {
        return rulesets.flat()
    }

    // 权限请求
    export const ask = fn(Request, async (input) => {
        for (const pattern of request.patterns ?? []) {
            const rule = evaluate(request.permission, pattern, ruleset, s.approved)
            if (rule.action === "deny") throw new DeniedError(ruleset)
            if (rule.action === "ask") {
                // 发布权限请求事件，等待用户响应
                return new Promise<void>((resolve, reject) => {
                    s.pending[id] = { info, resolve, reject }
                    Bus.publish(Event.Asked, info)
                })
            }
        }
    })

    // 权限回复处理
    export const reply = fn(ReplySchema, async (input) => {
        if (input.reply === "reject") {
            existing.reject(new RejectedError())
            // 拒绝该会话的所有待处理权限
            for (const [id, pending] of Object.entries(s.pending)) {
                if (pending.info.sessionID === sessionID) {
                    pending.reject(new RejectedError())
                }
            }
        }
        if (input.reply === "always") {
            // 添加到已批准列表
            s.approved.push({ permission, pattern, action: "allow" })
            // 自动批准同一会话的其他兼容权限
        }
    })
}
```

### 关键差异

| 特性 | Coding Agent | OpenCode |
|------|--------------|----------|
| **权限模型** | 黑白名单 | 三层规则合并 (allow/deny/ask) |
| **运行时控制** | 仅 Plan Mode | 完整的请求-响应机制 |
| **用户交互** | 无 | 支持 ask -> reply 流程 |
| **权限持久化** | 无 | 支持（可选） |
| **批量处理** | 无 | 拒绝/批准会话所有权限 |

### OpenCode 权限系统优势

1. **三层权限合并**：默认权限 + Agent 特定权限 + 用户配置
2. **运行时交互**：支持 ask -> 用户回复 -> allow/deny/reject
3. **通配符匹配**：支持 `*` 通配符匹配权限和模式
4. **批量处理**：一次拒绝/批准可处理整个会话的权限

---

## 上下文压缩对比

### Coding Agent 压缩

```typescript
// coding-agent/src/agent-v2/session/compaction.ts
export class Compaction {
    async compact(messages: Message[], sessionId?: string, memoryManager?: IMemoryManager): Promise<CompactionResult> {
        // 1. 检查是否需要压缩
        const tokenInfo = this.getTokenInfo(messages);
        if (!tokenInfo.shouldCompact) {
            return { isCompacted: false, summaryMessage: null, messages };
        }

        // 2. 分离消息区域
        const { systemMessage, pending, active } = this.splitMessages(messages);

        // 3. 处理工具调用配对
        const { pending: finalPending, active: finalActive } = this.processToolCallPairs(pending, active);

        // 4. 生成摘要
        const summaryContent = await this.generateSummary(finalPending);

        // 5. 重组消息
        const newMessages = this.rebuildMessages(systemMessage, summaryMessage, finalActive);

        return { isCompacted: true, summaryMessage, messages: newMessages };
    }
}
```

### OpenCode 压缩

```typescript
// opencode/src/session/compaction.ts
export namespace SessionCompaction {
    export const PRUNE_MINIMUM = 20_000   // 最小剪枝 token 数
    export const PRUNE_PROTECT = 40_000   // 保护最近 token 数

    // 检测是否溢出
    export async function isOverflow(input: { tokens, model }) {
        const count = tokens.input + tokens.cache.read + tokens.output
        const usable = model.limit.context - model.limit.output
        return count > usable
    }

    // 剪枝工具调用输出
    export async function prune(input: { sessionID: string }) {
        // 从后向前遍历，保留最近 40,000 tokens
        // 只剪枝已完成的工具调用
        // 跳过受保护工具（如 skill）
    }

    // 执行压缩
    export async function process(input: { messages, sessionID, abort, auto }) {
        // 使用 compaction Agent 生成摘要
        // 支持插件钩子注入上下文
    }
}
```

### 关键差异

| 特性 | Coding Agent | OpenCode |
|------|--------------|----------|
| **触发检测** | 基于估算 token + 阈值比例 | 基于实际 usage + 模型限制 |
| **压缩策略** | 一次性摘要 | 剪枝 + 摘要两阶段 |
| **保护机制** | 保留最近 N 条消息 | 保留最近 40,000 tokens + 2 轮对话 |
| **插件扩展** | 无 | 支持插件钩子 |
| **受保护工具** | 无 | skill 工具输出不被剪枝 |

---

## Coding Agent 不足与改进建议

### 1. 权限系统不完善 ⚠️ 严重

**问题**：
- 仅支持 Plan Mode 的黑白名单，无法在运行时动态请求权限
- 缺少用户交互式的权限确认机制

**建议**：
```typescript
// 建议实现
export interface PermissionManager {
    // 请求权限
    ask(request: PermissionRequest): Promise<PermissionReply>;
    // 三层权限合并
    mergeRules(defaults: Ruleset, agent: Ruleset, user: Ruleset): Ruleset;
    // 评估权限
    evaluate(permission: string, pattern: string, ruleset: Ruleset): PermissionAction;
}
```

### 2. 缺少数据迁移系统 ⚠️ 中等

**问题**：
- 存储接口抽象但无版本控制
- 数据结构变更时无迁移机制

**建议**：
```typescript
// 建议实现
export interface Migration {
    version: number;
    description: string;
    migrate(data: any): Promise<any>;
}

export class StorageMigration {
    private migrations: Migration[] = [];

    async runMigrations(currentVersion: number): Promise<void> {
        for (const migration of this.migrations) {
            if (migration.version > currentVersion) {
                await migration.migrate(data);
            }
        }
    }
}
```

### 3. 死循环检测过于简单 ⚠️ 严重

**问题**：
- 仅检测工具调用签名，无法处理复杂循环
- 检测到后直接报错，无法让用户选择继续

**建议**：
```typescript
// 建议实现
export class DoomLoopDetector {
    private threshold = 3;

    detect(toolCalls: ToolCall[]): DoomLoopResult {
        // 检测连续相同调用
        if (this.isRepeatedCall(toolCalls)) {
            return {
                detected: true,
                action: 'ask',  // 而非直接报错
                message: 'Detected repeated tool calls. Continue?'
            };
        }
        return { detected: false };
    }
}
```

### 4. 重试机制缺少响应头感知 ⚠️ 中等

**问题**：
- 无法解析 `retry-after` 响应头
- 重试延迟不够精确

**建议**：
```typescript
// 建议实现
export function resolveRetryDelay(error: unknown, attempt: number): number {
    if (error instanceof LLMRetryableError) {
        // 优先使用响应头
        if (error.responseHeaders?.['retry-after-ms']) {
            return parseFloat(error.responseHeaders['retry-after-ms']);
        }
        if (error.responseHeaders?.['retry-after']) {
            return parseFloat(error.responseHeaders['retry-after']) * 1000;
        }
    }
    // 回退到指数退避
    return Math.min(
        INITIAL_DELAY * Math.pow(BACKOFF_FACTOR, attempt - 1),
        MAX_DELAY
    );
}
```

### 5. 缺少插件系统 ⚠️ 低

**问题**：
- 无法动态扩展功能
- 工具、Provider、提示词都是静态注册

**建议**：
```typescript
// 建议实现
export interface Plugin {
    name: string;
    version: string;
    hooks: {
        'experimental.chat.system.transform'?: (ctx: Context) => Context;
        'experimental.session.compacting'?: (ctx: Context) => CompactionContext;
        'tool.beforeExecute'?: (tool: Tool, args: any) => Promise<any>;
    };
}

export class PluginManager {
    async loadPlugin(path: string): Promise<void>;
    async trigger<T>(hook: string, context: T): Promise<T>;
}
```

### 6. 工具上下文缺少权限请求能力 ⚠️ 中等

**问题**：
- 工具执行时无法直接请求权限
- 需要通过外部协调

**建议**：
```typescript
// 建议扩展 ToolContext
export type ToolContext = {
    // 现有字段...
    sessionId?: string;
    workingDirectory: string;

    // 新增权限请求能力
    askPermission?(request: {
        permission: string;
        patterns: string[];
        metadata?: Record<string, unknown>;
    }): Promise<void>;
}
```

### 7. 缺少会话分享和分叉功能 ⚠️ 低

**问题**：
- 无法分享会话
- 无法从历史消息分叉新会话

**建议**：
```typescript
// 建议实现
export interface SessionShare {
    share(sessionId: string): Promise<{ url: string; secret: string }>;
    unshare(sessionId: string): Promise<void>;
}

export interface SessionFork {
    fork(sessionId: string, options?: { messageID?: string }): Promise<Session>;
}
```

### 8. 缺少 Snapshot 和回滚功能 ⚠️ 低

**问题**：
- 无法追踪文件变化
- 无法回滚到之前状态

**建议**：
```typescript
// 建议实现
export interface Snapshot {
    track(): Promise<string>;
    patch(snapshotId: string): Promise<FilePatch>;
}

export interface SessionRevert {
    revert(sessionId: string, options: { messageID: string; partID?: string }): Promise<void>;
}
```

---

## 总结

### OpenCode 的优势

1. **更完善的权限系统**：三层权限合并、运行时交互、通配符匹配
2. **更智能的死循环检测**：3 次相同调用触发询问而非报错
3. **更精细的重试控制**：响应头感知、可中断延迟
4. **更丰富的功能**：插件系统、会话分享、分叉、回滚
5. **更健壮的存储**：数据迁移、读写锁保护

### Coding Agent 的优势

1. **更清晰的架构**：协调器模式，职责分离明确
2. **更易理解**：类和依赖注入，面向对象风格
3. **更灵活的存储**：抽象接口，可插拔实现

### 改进优先级

| 优先级 | 改进项 | 预期收益 |
|--------|--------|----------|
| P0 | 权限系统完善 | 用户体验大幅提升 |
| P0 | 死循环检测优化 | 减少误报，提高容错 |
| P1 | 重试响应头感知 | 更精确的重试控制 |
| P1 | 数据迁移系统 | 保证数据兼容性 |
| P2 | 插件系统 | 提高扩展性 |
| P2 | 会话分享/分叉 | 增强协作能力 |
| P3 | Snapshot/回滚 | 增强安全性和可恢复性 |

---

## 附录：关键文件索引

### Coding Agent

| 模块 | 文件路径 |
|------|----------|
| Agent 核心 | `src/agent-v2/agent/agent.ts` |
| LLM 调用 | `src/agent-v2/agent/core/llm-caller.ts` |
| 工具执行 | `src/agent-v2/agent/core/tool-executor.ts` |
| 状态管理 | `src/agent-v2/agent/core/agent-state.ts` |
| 工具注册 | `src/agent-v2/tool/registry.ts` |
| 工具基类 | `src/agent-v2/tool/base.ts` |
| 会话管理 | `src/agent-v2/session/index.ts` |
| 上下文压缩 | `src/agent-v2/session/compaction.ts` |

### OpenCode

| 模块 | 文件路径 |
|------|----------|
| 会话处理器 | `src/session/processor.ts` |
| 重试逻辑 | `src/session/retry.ts` |
| 消息模型 | `src/session/message-v2.ts` |
| 上下文压缩 | `src/session/compaction.ts` |
| 权限系统 | `src/permission/next.ts` |
| 工具定义 | `src/tool/tool.ts` |
| Agent 配置 | `src/agent/agent.ts` |
| 存储系统 | `src/storage/storage.ts` |

---

*报告完成于 2026-03-03*
