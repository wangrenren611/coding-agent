# Coding Agent 核心逻辑深度分析与 Claude Code 对比

> 文档版本：v1.0  
> 生成日期：2026-02-26  
> 作者：QPSCode

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [Agent 核心架构分析](#2-agent-核心架构分析)
3. [核心组件深度解析](#3-核心组件深度解析)
4. [关键算法与流程](#4-关键算法与流程)
5. [Claude Code 架构调研](#5-claude-code-架构调研)
6. [对比分析：优势与不足](#6-对比分析优势与不足)
7. [改进建议](#7-改进建议)
8. [附录：核心代码流程图](#8-附录核心代码流程图)

---

## 1. 执行摘要

### 1.1 分析范围

本文档对 `coding-agent` 项目的 Agent v2 核心模块进行了深度代码级分析，并与 Anthropic 官方的 **Claude Code** 进行架构对比。

**分析的核心文件**：
| 文件 | 行数 | 职责 |
|------|------|------|
| `src/agent-v2/agent/agent.ts` | ~900 行 | Agent 主协调器 |
| `src/agent-v2/agent/core/llm-caller.ts` | ~300 行 | LLM 调用封装 |
| `src/agent-v2/agent/core/tool-executor.ts` | ~250 行 | 工具执行器 |
| `src/agent-v2/agent/core/agent-state.ts` | ~200 行 | 状态管理 |
| `src/agent-v2/agent/stream-processor.ts` | ~350 行 | 流式处理 |
| `src/agent-v2/agent/error-classifier.ts` | ~180 行 | 错误分类 |
| `src/agent-v2/agent/core/idle-timeout-controller.ts` | ~100 行 | 空闲超时控制 |

### 1.2 核心发现

#### 架构设计
- **协调器模式 (Coordinator Pattern)**：Agent 作为核心协调器，委托专业组件处理具体职责
- **组件化设计**：LLMCaller、ToolExecutor、AgentState、AgentEmitter 各司其职
- **状态机驱动**：明确的状态转换（IDLE → RUNNING → THINKING → COMPLETED/FAILED）

#### 关键技术特性
- **流式处理**：支持增量文本/推理/工具调用处理
- **智能超时**：流式请求使用空闲超时，非流式使用固定超时
- **错误分类**：6 层错误分类机制，区分可重试/永久错误
- **协议强制**：Tool Call 协议验证，自动注入中断占位

### 1.3 对比结论概览

| 维度 | Coding Agent | Claude Code | 评价 |
|------|-------------|-------------|------|
| 架构模式 | 协调器模式 | 协调器 + ReAct | 相当 |
| 流式处理 | 完整支持 | 完整支持 | 相当 |
| 错误处理 | 6 层分类 | 类似 | 相当 |
| 工具系统 | 16+ 内置工具 | MCP 生态 | Claude Code 领先 |
| 会话管理 | 文件/MongoDB | 云端同步 | Claude Code 领先 |
| 扩展性 | 插件系统 | MCP 协议 | Claude Code 领先 |
| 本地化 | 完全本地 | 需联网 | Coding Agent 优势 |

---

## 2. Agent 核心架构分析

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Agent (协调器)                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        公共 API                                  │   │
│  │   execute() │ executeWithResult() │ abort() │ getStatus()      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │InputValidator│  │ErrorClassifier│ │ AgentState   │  │AgentEmitter│ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      主循环 (runLoop)                            │   │
│  │  while(true) { checkAbort(); checkComplete(); executeLLMCall(); }│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  LLMCaller   │  │ToolExecutor  │  │   Session    │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                 │                           │
│         ▼                 ▼                 ▼                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │StreamProcessor│ │ToolRegistry  │  │MemoryManager │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 组件职责矩阵

| 组件 | 职责 | 关键方法 | 依赖 |
|------|------|----------|------|
| **Agent** | 协调器，管理任务生命周期 | `execute()`, `runLoop()` | 所有组件 |
| **AgentState** | 状态管理，循环/重试计数 | `startTask()`, `recordSuccess()` | TimeProvider |
| **LLMCaller** | LLM 调用封装，超时管理 | `execute()`, `executeStream()` | Provider, StreamProcessor |
| **ToolExecutor** | 工具执行调度 | `execute()`, `captureFileSnapshots()` | ToolRegistry |
| **StreamProcessor** | 流式响应处理 | `processChunk()`, `buildResponse()` | ResponseValidator |
| **AgentEmitter** | 事件发射，流式回调 | `emitTextDelta()`, `emitStatus()` | StreamCallback |
| **ErrorClassifier** | 错误分类与清理 | `classifyFailureCode()`, `sanitizeError()` | - |
| **InputValidator** | 输入验证 | `validate()` | - |
| **Session** | 会话管理，消息存储 | `initialize()`, `sync()`, `compactBeforeLLMCall()` | MemoryManager |

### 2.3 设计模式应用

| 模式 | 应用位置 | 实现说明 |
|------|----------|----------|
| **协调器模式** | Agent 类 | 协调 LLMCaller、ToolExecutor、AgentState 等组件 |
| **委托模式** | Agent → 各组件 | 将具体职责委托给专业组件，保持单一职责 |
| **状态机模式** | AgentState + StreamProcessor | 管理执行状态和流式处理状态 |
| **策略模式** | ErrorClassifier | 根据错误类型选择不同的分类策略 |
| **观察者模式** | AgentEmitter + EventBus | 事件通知机制，组件解耦 |
| **超时控制策略** | IdleTimeoutController | 流式请求的空闲超时管理 |
| **责任链模式** | StreamProcessor 处理 chunk | 按顺序处理 reasoning → content → tool_calls |

---

## 3. 核心组件深度解析

### 3.1 Agent 主类 (agent.ts)

#### 3.1.1 核心属性

```typescript
export class Agent {
    // 外部依赖
    private readonly provider: LLMProvider;
    private readonly session: Session;
    private readonly toolRegistry: ToolRegistry;
    private readonly eventBus: EventBus;

    // 配置
    private readonly stream: boolean;
    private readonly streamCallback?: StreamCallback;
    private readonly thinking?: boolean;
    private readonly requestTimeoutMs?: number;
    private readonly idleTimeoutMs: number;

    // 内部组件（委托模式）
    private readonly agentState: AgentState;      // 状态管理
    private readonly llmCaller: LLMCaller;        // LLM 调用
    private readonly toolExecutor: ToolExecutor;  // 工具执行
    private readonly emitter: AgentEmitter;       // 事件发射
    private readonly inputValidator: InputValidator;
    private readonly errorClassifier: ErrorClassifier;
}
```

#### 3.1.2 执行流程

```typescript
async execute(query: MessageContent, options?: LLMGenerateOptions): Promise<Message> {
    // 1. 验证输入
    this.validateInput(query);
    
    // 2. 检查状态（确保 IDLE）
    this.ensureIdle();
    
    // 3. 启动任务
    this.agentState.startTask();
    this.pendingRetryReason = null;

    try {
        // 4. 初始化会话
        await this.session.initialize();
        
        // 5. 添加用户消息
        this.session.addMessage({ messageId: uuid(), role: 'user', content: query });

        // 6. 主循环
        await this.runLoop(options);
        
        // 7. 检查是否被中止
        if (this.agentState.isAborted()) {
            throw new AgentAbortedError();
        }
        
        // 8. 完成任务
        this.completeTask();
        return this.getFinalMessage();
    } catch (error) {
        // 9. 失败处理
        if (!this.agentState.isAborted()) {
            this.failTask(error);
        }
        throw error;
    } finally {
        // 10. 同步会话到存储
        await this.flushSession();
    }
}
```

#### 3.1.3 主循环逻辑

```typescript
private async runLoop(options?: LLMGenerateOptions): Promise<void> {
    this.emitter.emitStatus(AgentStatus.RUNNING, 'Agent is running...', undefined, {...});

    while (true) {
        // === 退出条件检查 ===
        if (this.agentState.isAborted()) break;                    // 用户中止
        if (this.checkComplete()) break;                           // 任务完成
        if (this.agentState.isRetryExceeded())                     // 重试超限
            throw new AgentMaxRetriesExceededError();
        if (!this.agentState.canContinue())                        // 循环超限
            throw new AgentLoopExceededError(this.agentState.loopCount);

        // === 重试处理 ===
        if (this.agentState.needsRetry()) {
            await this.handleRetry();
            if (this.agentState.isAborted()) break;
        }

        // === 执行循环 ===
        this.agentState.incrementLoop();
        this.agentState.setStatus(AgentStatus.RUNNING);
        
        try {
            this.agentState.setStatus(AgentStatus.THINKING);
            await this.executeLLMCall(options);  // 委托给 LLMCaller
            this.agentState.recordSuccess();     // 重置重试计数
        } catch (error) {
            this.handleLoopError(error);         // 错误分类处理
        }
    }
}
```

#### 3.1.4 错误处理机制

```typescript
private handleLoopError(error: unknown): never | void {
    // 可重试错误 - 记录并返回，由主循环处理重试
    if (isRetryableError(error)) {
        // 1. 解析重试延迟
        const delay = this.resolveRetryDelay(error);
        
        // 2. 记录重试状态
        this.agentState.recordRetryableError(delay);
        
        // 3. 格式化重试原因
        this.pendingRetryReason = this.formatRetryReason(error);
        
        // 4. 发射重试事件
        const stats = this.agentState.getStats();
        this.eventBus.emit(EventType.TASK_RETRY, {
            timestamp: this.timeProvider.getCurrentTime(),
            retryCount: stats.retries,
            maxRetries: stats.maxRetries,
            reason: this.pendingRetryReason,
        });
        return;  // 返回，由主循环处理实际重试
    }
    
    // 不可重试错误直接抛出
    throw error;
}
```

### 3.2 LLMCaller (llm-caller.ts)

#### 3.2.1 超时控制策略

```typescript
async execute(messages: Message[], tools: Tool[], abortSignal?: AbortSignal, options?: LLMGenerateOptions): Promise<LLMCallResult> {
    const messageId = uuid();
    this.abortController = new AbortController();
    this.streamProcessor.reset();
    this.streamProcessor.setMessageId(messageId);

    // 判断是否为流式请求
    const isStream = options?.stream ?? this.config.stream;
    const signals: AbortSignal[] = [this.abortController.signal];

    if (isStream) {
        // 流式请求：使用空闲超时（每次收到数据就重置）
        const idleTimeoutMs = this.config.idleTimeoutMs ?? 3 * 60 * 1000;
        idleTimeoutController = new IdleTimeoutController(idleTimeoutMs);
        signals.push(idleTimeoutController.signal);
    } else {
        // 非流式请求：使用固定超时
        const requestTimeout = this.config.requestTimeoutMs ?? this.config.provider.getTimeTimeout();
        signals.push(AbortSignal.timeout(requestTimeout));
    }

    // 合并所有信号
    const mergedAbortSignal = AbortSignal.any(signals);

    // 执行调用
    if (isStream) {
        response = await this.executeStream(messages, llmOptions, messageId);
    } else {
        response = await this.executeNormal(messages, llmOptions);
    }

    return { response, messageId };
}
```

#### 3.2.2 流式处理

```typescript
private async executeStream(messages: Message[], options: LLMGenerateOptions, messageId: string): Promise<LLMResponse> {
    this.config.onStatusChange?.(AgentStatus.THINKING, 'Agent is thinking...', messageId, {...});

    options.stream = true;
    const streamResult = await this.config.provider.generate(messages, options);

    // 检查是否为流式结果
    if (!isAsyncIterable(streamResult)) {
        return streamResult as LLMResponse;  // 非流式结果，直接返回
    }

    const stream = streamResult as AsyncIterable<Chunk>;

    for await (const chunk of stream) {
        // 1. 检查 chunk 错误
        const streamError = this.extractStreamChunkError(chunk);
        if (streamError) {
            throw this.createStreamChunkError(streamError, chunk.id);
        }

        // 2. 处理 chunk
        this.streamProcessor.processChunk(chunk);

        // 3. 检查是否中止
        if (this.streamProcessor.isAborted()) {
            const abortReason = this.streamProcessor.getAbortReason();
            if (abortReason === 'buffer_overflow') {
                throw new LLMPermanentError(..., 'STREAM_BUFFER_OVERFLOW');
            }
            if (abortReason === 'validation_violation') {
                throw new LLMPermanentError(..., 'STREAM_VALIDATION_VIOLATION');
            }
            throw new LLMRetryableError(..., 'STREAM_ABORTED');
        }
    }

    return this.streamProcessor.buildResponse();
}
```

#### 3.2.3 流错误分类

```typescript
private isPermanentStreamError(signature: string): boolean {
    const permanentIndicators = [
        'invalid_request', 'bad_request', 'authentication', 'auth',
        'permission', 'forbidden', 'not_found', 'unsupported',
        'context_length', 'content_filter', 'safety',
        'invalid_parameter_error',
    ];
    return permanentIndicators.some(indicator => signature.includes(indicator));
}
```

### 3.3 StreamProcessor (stream-processor.ts)

#### 3.3.1 状态机设计

```typescript
interface InternalProcessorState {
    aborted: boolean;
    abortReason?: 'manual' | 'buffer_overflow' | 'validation_violation';
    reasoningStarted: boolean;
    textStarted: boolean;
    toolCallsStarted: boolean;
    reasoningCompleted: boolean;
    textCompleted: boolean;
}
```

#### 3.3.2 处理顺序

典型的 LLM 响应处理顺序：
```
reasoning_content → content → tool_calls → finish_reason
```

#### 3.3.3 核心处理流程

```typescript
processChunk(chunk: Chunk): void {
    if (this.state.aborted) return;
    
    // 重置空闲超时
    this.resetIdleTimeoutCallback?.();
    
    const finishReason = getFinishReason(chunk);
    this.updateMetadata(chunk, finishReason);
    
    // 按顺序处理不同类型内容
    if (hasReasoningDelta(chunk)) {
        this.handleReasoningContent(content, chunkId, finishReason);
    }
    if (hasContentDelta(chunk)) {
        this.handleTextContent(content, chunkId, finishReason);
    }
    if (hasToolCalls(chunk)) {
        this.handleToolCalls(toolCalls, chunkId, finishReason);
    }
    if (finishReason && !hasContentDelta(chunk) && ...) {
        this.handleFinishReasonOnly(finishReason, chunkId);
    }
    
    if (chunk.usage) {
        this.options.onUsageUpdate?.(chunk.usage, this.currentMessageId);
    }
}
```

#### 3.3.4 缓冲区管理

```typescript
private appendToBuffer(type: 'reasoning' | 'content', content: string): boolean {
    const currentSize = this.buffers.reasoning.length + this.buffers.content.length;
    const projectedSize = currentSize + content.length;
    
    if (projectedSize > this.maxBufferSize) {
        this.state.aborted = true;
        this.state.abortReason = 'buffer_overflow';
        return false;
    }
    
    if (type === 'reasoning') {
        this.buffers.reasoning += content;
    } else {
        this.buffers.content += content;
    }
    return true;
}
```

#### 3.3.5 增量验证机制

```typescript
private validateAfterDelta(delta: string): boolean {
    const result = this.validator.validateIncremental(delta);
    if (result.valid) return true;
    
    this.options.onValidationViolation?.(result);
    if (result.action === 'abort') {
        this.state.aborted = true;
        this.state.abortReason = 'validation_violation';
        return false;
    }
    return true;
}
```

### 3.4 ToolExecutor (tool-executor.ts)

#### 3.4.1 执行流程

```typescript
async execute(toolCalls: ToolCall[], messageId: string, content: string): Promise<ToolExecutionOutput> {
    // 1. 验证 tool_calls
    this.config.toolRegistry.validateToolCalls(toolCalls);
    
    // 2. 触发创建回调
    this.config.onToolCallCreated?.(toolCalls, messageId, messageContent);
    
    // 3. 捕获文件快照（用于 diff 生成）
    const fileSnapshots = this.captureFileSnapshots(toolCalls);
    const streamedToolCallIds = new Set<string>();
    
    // 4. 构建工具上下文
    const toolContext = this.buildToolContext();
    
    // 5. 执行工具
    const results = await this.config.toolRegistry.execute(toolCalls, {
        ...toolContext,
        onToolStream: (toolCallId, _toolName, output) => {
            streamedToolCallIds.add(toolCallId);
            this.config.onToolCallStream?.(toolCallId, output, messageId);
        },
    });
    
    // 6. 记录结果到会话
    const resultMessages = this.recordResults(results, messageId, streamedToolCallIds);
    
    // 7. 生成代码补丁
    this.emitCodePatches(fileSnapshots, messageId);
    
    return {
        success: results.every(r => r.result?.success !== false),
        toolCount: results.length,
        resultMessages,
    };
}
```

#### 3.4.2 文件快照与 Diff 生成

```typescript
private captureFileSnapshots(toolCalls: ToolCall[]): Map<string, FileSnapshot> {
    const snapshots = new Map<string, FileSnapshot>();
    
    for (const toolCall of toolCalls) {
        const parsedArgs = safeParse(toolCall.function.arguments || '');
        const candidatePaths = this.extractCandidatePaths(parsedArgs);
        
        for (const candidatePath of candidatePaths) {
            const absolutePath = this.resolveCandidatePath(candidatePath);
            const snapshot = this.snapshotFile(absolutePath);
            if (snapshot) snapshots.set(absolutePath, snapshot);
        }
    }
    return snapshots;
}

private emitCodePatches(snapshots: Map<string, FileSnapshot>, messageId: string): void {
    for (const snapshot of snapshots.values()) {
        const afterContent = this.safeReadFile(snapshot.absolutePath);
        
        if (snapshot.existedBefore === existsAfter && 
            snapshot.beforeContent === afterContent) {
            continue;  // 无变化
        }
        
        const diff = this.buildUnifiedDiff(...);
        const language = this.detectLanguage(snapshot.displayPath);
        this.config.onCodePatch?.(snapshot.displayPath, diff, messageId, language);
    }
}
```

### 3.5 AgentState (agent-state.ts)

#### 3.5.1 状态属性

```typescript
export class AgentState {
    private _status: AgentStatus = AgentStatus.IDLE;
    private _loopCount: number = 0;
    private _retryCount: number = 0;
    private _totalRetryCount: number = 0;
    private _taskStartTime: number = 0;
    private _nextRetryDelayMs: number;
    private _lastFailure?: AgentFailure;
    private _abortController: AbortController | null = null;
}
```

#### 3.5.2 状态转换

```
IDLE → RUNNING → THINKING → [RUNNING | RETRYING] → COMPLETED/FAILED/ABORTED
              ↑              ↓
              └──── RETRY ───┘
```

#### 3.5.3 核心状态方法

```typescript
startTask(): void {
    this._taskStartTime = this.timeProvider.getCurrentTime();
    this._loopCount = 0;
    this._retryCount = 0;
    this._totalRetryCount = 0;
    this._abortController = new AbortController();
    this._status = AgentStatus.RUNNING;
}

recordSuccess(): void {
    this._retryCount = 0;
    this._nextRetryDelayMs = this.config.defaultRetryDelayMs;
}

recordRetryableError(retryDelayMs?: number): void {
    this._retryCount++;
    this._totalRetryCount++;
    this._nextRetryDelayMs = retryDelayMs ?? this.config.defaultRetryDelayMs;
}

abort(): void {
    this._abortController?.abort();
    this._status = AgentStatus.ABORTED;
}
```

### 3.6 ErrorClassifier (error-classifier.ts)

#### 3.6.1 错误分类优先级

```typescript
classifyFailureCode(error: unknown, status?: string): AgentFailureCode {
    // 1. 检查 Agent 状态
    if (status === AgentStatus.ABORTED) return 'AGENT_ABORTED';
    
    // 2. 检查专用错误子类（优先级最高）
    if (error instanceof AgentAbortedError) return 'AGENT_ABORTED';
    if (error instanceof AgentBusyError) return 'AGENT_BUSY';
    if (error instanceof AgentMaxRetriesExceededError) 
        return 'AGENT_MAX_RETRIES_EXCEEDED';
    
    // 3. 检查 AgentError.code 属性
    if (hasValidFailureCode(error)) return error.code;
    
    // 4. 检查 Provider 层错误类型
    if (isAbortedError(error)) return 'AGENT_ABORTED';
    if (this.isTimeoutLikeError(error)) return 'LLM_TIMEOUT';
    
    // 5. 消息内容匹配（后备方案）
    if (error instanceof AgentError && error.message) {
        const message = error.message.toLowerCase();
        if (message.includes('abort')) return 'AGENT_ABORTED';
    }
    
    // 6. 默认返回运行时错误
    return 'AGENT_RUNTIME_ERROR';
}
```

#### 3.6.2 错误清理 (Sanitization)

```typescript
sanitizeError(error: unknown): SafeError {
    if (error instanceof AgentError) {
        return {
            userMessage: error.message,
            internalMessage: error.stack,
        };
    }
    if (error instanceof ToolError) {
        return {
            userMessage: 'Tool execution failed. Please try again.',
            internalMessage: error.message,
        };
    }
    // 通用错误处理
    if (error instanceof Error) {
        return {
            userMessage: 'An unexpected error occurred. Please try again.',
            internalMessage: error.message,
        };
    }
    return {
        userMessage: 'An unexpected error occurred. Please try again.',
        internalMessage: String(error),
    };
}
```

### 3.7 IdleTimeoutController (idle-timeout-controller.ts)

#### 3.7.1 设计特点

与 `AbortSignal.timeout()` 不同：
- 每次调用 `reset()` 都重新开始计时
- 只有超过 idleMs 没有调用 reset() 才会触发超时
- 适用于流式请求场景（每次收到 chunk 就重置）

#### 3.7.2 核心实现

```typescript
export class IdleTimeoutController {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly abortController: AbortController;
    private readonly idleMs: number;
    private lastActivityTime: number;
    private resetCount: number = 0;
    private finished: boolean = false;
    
    constructor(options: IdleTimeoutControllerOptions | number) {
        this.abortController = new AbortController();
        this.startTime = Date.now();
        this.lastActivityTime = this.startTime;
        this.startTimer();
    }
    
    reset(): void {
        if (this.finished) return;
        
        this.clearTimer();
        this.lastActivityTime = Date.now();
        this.resetCount++;
        this.startTimer();
    }
    
    private startTimer(): void {
        this.timer = setTimeout(() => {
            this.triggerTimeout();
        }, this.idleMs);
    }
    
    private triggerTimeout(): void {
        if (this.finished) return;
        this.finish();
        const error = this.createTimeoutError();
        this.abortController.abort(error);
    }
}
```

---

## 4. 关键算法与流程

### 4.1 Tool Call 协议强制

这是 Coding Agent 的一个**关键创新点**，用于修复 LLM 可能产生的不完整 tool call 序列。

```typescript
/**
 * 发送前修复/约束 tool call 协议：
 * assistant(tool_calls) 后必须紧跟对应的 tool(result) 消息。
 * - 缺失的 tool 结果会注入中断占位，避免 provider 400
 * - 游离/不匹配的 tool 消息会被丢弃
 */
private enforceToolCallProtocol(messages: Message[]): Message[] {
    const fixed: Message[] = [];

    for (let index = 0; index < messages.length; ) {
        const message = messages[index];

        if (message.role === 'assistant' && hasToolCalls(message)) {
            fixed.push(message);
            
            // 收集预期的 tool_call_id
            const expectedIds = new Set(validToolCalls.map(call => call.id));
            const respondedIds = new Set<string>();
            let cursor = index + 1;
            
            // 收集后续的 tool 消息
            while (cursor < messages.length && messages[cursor].role === 'tool') {
                const toolMessage = messages[cursor];
                const toolCallId = toolMessage.tool_call_id?.trim();
                
                if (expectedIds.has(toolCallId) && !respondedIds.has(toolCallId)) {
                    fixed.push(toolMessage);
                    respondedIds.add(toolCallId);
                }
                cursor += 1;
            }
            
            // 为缺失的 tool 结果注入中断占位
            for (const call of validToolCalls) {
                if (!respondedIds.has(call.id)) {
                    fixed.push(this.createInterruptedToolResult(call.id));
                }
            }
            index = cursor;
            continue;
        }
        
        // 丢弃游离的 tool 消息
        if (message.role === 'tool') {
            index += 1;
            continue;
        }
        
        fixed.push(message);
        index += 1;
    }
    return fixed;
}

private createInterruptedToolResult(toolCallId: string): Message {
    return {
        messageId: uuid(),
        role: 'tool',
        type: 'tool-result',
        tool_call_id: toolCallId,
        content: JSON.stringify({
            success: false,
            error: 'TOOL_CALL_INTERRUPTED',
            interrupted: true,
            message: 'Tool execution was interrupted before a result was produced.',
        }),
    };
}
```

### 4.2 完成检测逻辑

```typescript
private checkComplete(): boolean {
    const lastMessage = this.session.getLastMessage();
    if (!lastMessage) return false;

    switch (lastMessage.role) {
        case 'user': return false;   // 用户消息后继续
        case 'tool': return false;   // 工具结果后继续
        case 'assistant':
            return this.checkAssistantComplete(lastMessage);
        default: return false;
    }
}

private checkAssistantComplete(message: Message): boolean {
    if (message.finish_reason) {
        switch (message.finish_reason) {
            case 'abort': return false;  // 中止需要重试
            case 'length': {
                // finish_reason=length 时，检查是否有未完成的内容或工具调用
                const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
                return this.hasAssistantOutput(message) && !hasTools;
            }
            case 'tool_calls': return false;  // 工具调用后继续执行
        }

        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            return false;  // 有工具调用，继续执行
        }

        if (this.isEmptyResponse(message)) {
            return false;  // 空响应需要重试
        }

        return true;  // 有文本输出，完成
    }

    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    return message.type === 'text' && this.hasAssistantOutput(message) && !hasToolCalls;
}
```

### 4.3 重试机制

```typescript
private async handleRetry(): Promise<void> {
    this.agentState.setStatus(AgentStatus.RETRYING);
    
    // 可被 abort 中断的睡眠
    await this.sleepWithAbort(this.agentState.nextRetryDelayMs);
    
    if (this.agentState.isAborted()) {
        return;
    }
    
    const stats = this.agentState.getStats();
    const retryDelay = this.agentState.nextRetryDelayMs;
    const reasonSuffix = this.pendingRetryReason ? ` - ${this.pendingRetryReason}` : '';
    
    this.emitter.emitStatus(
        AgentStatus.RETRYING,
        `Retrying... (${stats.retries}/${stats.maxRetries}) after ${retryDelay}ms${reasonSuffix}`,
        undefined,
        {
            source: 'agent',
            phase: 'retry',
            retry: {
                type: 'normal',
                attempt: stats.retries,
                max: stats.maxRetries,
                delayMs: retryDelay,
                nextRetryAt: this.timeProvider.getCurrentTime() + retryDelay,
                reason: this.pendingRetryReason ?? undefined,
            },
        }
    );
}

private sleepWithAbort(ms: number): Promise<void> {
    const controller = this.agentState.abortController;
    if (!controller) {
        return this.timeProvider.sleep(ms);
    }
    if (controller.signal.aborted) {
        return Promise.resolve();
    }

    return Promise.race([
        this.timeProvider.sleep(ms),
        new Promise<void>((resolve) => {
            controller.signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    ]);
}
```

---

## 5. Claude Code 架构调研

### 5.1 Claude Code 概述

**Claude Code** 是 Anthropic 官方推出的 agentic coding 工具，主要特性：

- **终端集成**：直接运行在终端中，理解代码库
- **多表面支持**：终端、VS Code、JetBrains、Web、Desktop App
- **MCP 协议**：Model Context Protocol，用于工具集成
- **多 Agent 协作**：支持子代理 (sub-agents) 并行工作
- **远程同步**：会话可在不同设备间同步

### 5.2 Claude Code 架构特点

根据官方文档和公开信息：

#### 5.2.1 架构模式

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Agent 引擎                             │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐           │   │
│  │  │  ReAct    │  │  Planner  │  │  Memory   │           │   │
│  │  │  Engine   │  │           │  │  Manager  │           │   │
│  │  └───────────┘  └───────────┘  └───────────┘           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   MCP 层                                │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐           │   │
│  │  │  MCP      │  │  Tool     │  │  Resource │           │   │
│  │  │  Server   │  │  Registry │  │  Manager  │           │   │
│  │  └───────────┘  └───────────┘  └───────────┘           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   会话管理                               │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐           │   │
│  │  │  Local    │  │  Cloud    │  │  Sync     │           │   │
│  │  │  Storage  │  │  Storage  │  │  Service  │           │   │
│  │  └───────────┘  └───────────┘  └───────────┘           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.2.2 MCP (Model Context Protocol)

MCP 是 Claude Code 的核心创新，用于标准化 AI 工具集成：

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP 架构                                │
│                                                                 │
│  ┌─────────────┐         ┌─────────────┐         ┌────────────┐│
│  │   Claude    │◀───────▶│   MCP Host  │◀───────▶│ MCP Server ││
│  │    Code     │         │  (CLI/IDE)  │         │  (Tools)   ││
│  └─────────────┘         └─────────────┘         └────────────┘│
│         │                     │                      │          │
│         │                     │                      │          │
│         ▼                     ▼                      ▼          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    MCP 协议层                                ││
│  │  - Tools: 标准化能力描述 (name, description, inputSchema)   ││
│  │  - Resources: 结构化数据访问 (URI-based)                    ││
│  │  - Prompts: 可复用提示模板                                   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### 5.2.3 多 Agent 协作

```typescript
// Claude Code 支持 spawn 多个子代理
claude "分析这个代码库，然后让一个子代理写测试，另一个子代理写文档"

// 内部实现（推测）
class AgentCoordinator {
    async execute(task: string) {
        const subAgents = await this.spawnSubAgents(task);
        const results = await Promise.all(
            subAgents.map(agent => agent.execute())
        );
        return this.mergeResults(results);
    }
}
```

### 5.3 Claude Code 技术栈

根据 GitHub 仓库信息：

| 技术 | 用途 |
|------|------|
| **Shell** (46.5%) | 安装脚本、CLI 封装 |
| **Python** (29.6%) | 核心逻辑、MCP 服务器 |
| **TypeScript** (17.9%) | CLI、扩展 |
| **PowerShell** (4.1%) | Windows 安装 |

---

## 6. 对比分析：优势与不足

### 6.1 架构对比

| 维度 | Coding Agent | Claude Code | 评价 |
|------|-------------|-------------|------|
| **架构模式** | 协调器模式 | 协调器 + ReAct | 相当 |
| **组件化** | 高度组件化 | 类似 | 相当 |
| **状态管理** | 显式状态机 | 类似 | 相当 |
| **流式处理** | 完整支持 | 完整支持 | 相当 |
| **错误处理** | 6 层分类 | 类似 | 相当 |

### 6.2 功能对比

| 功能 | Coding Agent | Claude Code | 评价 |
|------|-------------|-------------|------|
| **工具调用** | 16+ 内置工具 | MCP 生态 (数百) | Claude Code 领先 |
| **会话管理** | 文件/MongoDB | 云端同步 | Claude Code 领先 |
| **多 Agent** | 基础支持 (task) | 完整子代理系统 | Claude Code 领先 |
| **跨平台** | Node.js 跨平台 | 多表面 (终端/IDE/Web) | Claude Code 领先 |
| **本地化** | 完全本地 | 需联网 | **Coding Agent 优势** |
| **Provider** | 多 Provider | 仅 Claude | Coding Agent 灵活 |
| **成本** | 开源免费 | 需订阅 | **Coding Agent 优势** |

### 6.3 Coding Agent 优势

#### 6.3.1 架构优势

1. **清晰的组件职责**
   - Agent 作为协调器，各组件职责单一
   - 易于测试和维护
   - 代码可读性高

2. **智能超时控制**
   - 流式请求使用 `IdleTimeoutController`（每次收到数据重置）
   - 非流式使用固定超时
   - 比简单的 `AbortSignal.timeout()` 更灵活

3. **Tool Call 协议强制**
   - 自动修复不完整的 tool call 序列
   - 注入中断占位，避免 provider 400 错误
   - **这是 Coding Agent 的独特创新**

4. **增量验证机制**
   - 流式处理过程中进行增量验证
   - 可检测无意义输出、幻觉模式
   - 提前中止无效响应

5. **多 Provider 支持**
   - GLM、Kimi、MiniMax 等
   - OpenAI 兼容适配器
   - 不依赖单一厂商

#### 6.3.2 成本优势

| 项目 | Coding Agent | Claude Code |
|------|-------------|-------------|
| 软件成本 | 免费开源 | 需订阅 ($20-200/月) |
| API 成本 | 可选择低价 Provider | 仅 Claude API (较贵) |
| 部署成本 | 本地运行 | 云端依赖 |

### 6.4 Coding Agent 不足

#### 6.4.1 工具生态

| 方面 | Coding Agent | Claude Code |
|------|-------------|-------------|
| 内置工具 | 16+ | 基础工具 + MCP |
| 扩展机制 | 自定义工具类 | MCP 协议 (标准化) |
| 第三方工具 | 需手动实现 | MCP Server 生态 |
| 工具发现 | 注册表 | MCP 动态发现 |

**差距分析**：
- Claude Code 的 MCP 协议是**开放标准**，任何开发者都可以创建 MCP Server
- Coding Agent 需要手动实现工具类，扩展成本较高

#### 6.4.2 会话管理

| 方面 | Coding Agent | Claude Code |
|------|-------------|-------------|
| 存储后端 | 文件/MongoDB | 云端 + 本地 |
| 跨设备同步 | 不支持 | 支持 (Remote Control) |
| 会话恢复 | 本地 sessionId | 云端会话 ID |
| 历史管理 | 基础 | 完整历史 + 搜索 |

#### 6.4.3 多 Agent 协作

| 方面 | Coding Agent | Claude Code |
|------|-------------|-------------|
| 子任务 | `task` 工具 (基础) | Sub-agents (完整) |
| 并行执行 | 有限支持 | 完整并行 |
| 结果合并 | 手动 | 自动 |
| Agent 通信 | 无 | 支持 |

#### 6.4.4 用户体验

| 方面 | Coding Agent | Claude Code |
|------|-------------|-------------|
| CLI | 基础 | 完善 (ink 框架) |
| IDE 集成 | 无 | VS Code/JetBrains |
| Web UI | 无 | 支持 |
| 桌面应用 | 无 | 支持 |
| 移动端 | 无 | iOS App |

### 6.5 技术债务

#### Coding Agent

1. **测试数据积累**
   - `test-memory/` 包含大量测试会话文件
   - `data/truncation/` 积累截断数据
   - 需要定期清理策略

2. **文档不完整**
   - 部分文档内容被隐藏 (REDACTED)
   - 缺少 API 参考文档

3. **集成测试不足**
   - 主要是单元测试
   - 缺少端到端测试

#### Claude Code

1. **闭源**
   - 核心逻辑不公开
   - 无法审计和学习

2. **厂商锁定**
   - 仅支持 Claude API
   - 无法切换 Provider

3. **网络依赖**
   - 必须联网使用
   - 无法本地部署

---

## 7. 改进建议

### 7.1 短期改进 (1-2 周)

#### 7.1.1 工具系统扩展

```typescript
// 建议：实现 MCP 兼容层
interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: z.ZodSchema;
    execute: (params: unknown) => Promise<ToolResult>;
}

class MCPAdapter {
    async discoverMCPTools(serverUrl: string): Promise<MCPToolDefinition[]> {
        // 从 MCP Server 动态发现工具
    }
    
    async executeMCPTool(toolName: string, params: unknown): Promise<ToolResult> {
        // 执行 MCP 工具
    }
}
```

#### 7.1.2 会话同步

```typescript
// 建议：实现简单的云端同步
interface SessionSyncService {
    upload(sessionId: string, data: SessionData): Promise<void>;
    download(sessionId: string): Promise<SessionData>;
    list(): Promise<SessionSummary[]>;
}
```

#### 7.1.3 CLI 增强

```typescript
// 建议：使用 ink 框架改进 CLI UI
import { render, Box, Text } from 'ink';

function AgentUI({ agent }: { agent: Agent }) {
    return (
        <Box flexDirection="column">
            <Text bold>Status: {agent.getStatus()}</Text>
            <Text>Loop: {agent.getLoopCount()}</Text>
        </Box>
    );
}
```

### 7.2 中期改进 (1-2 月)

#### 7.2.1 多 Agent 协作

```typescript
// 建议：实现完整的子代理系统
class SubAgentManager {
    async spawnSubAgent(task: string, options: SubAgentOptions): Promise<SubAgent> {
        const subAgent = new Agent({
            ...options,
            parentAgent: this.currentAgent,
        });
        this.subAgents.push(subAgent);
        return subAgent;
    }
    
    async executeParallel(tasks: string[]): Promise<AgentResult[]> {
        return Promise.all(
            tasks.map(task => this.spawnSubAgent(task).then(a => a.execute()))
        );
    }
}
```

#### 7.2.2 IDE 扩展

```typescript
// 建议：实现 VS Code 扩展
// package.json
{
    "contributes": {
        "commands": [
            { "command": "coding-agent.execute", "title": "Execute with Agent" }
        ],
        "views": [
            { "id": "agent-session", "name": "Agent Session" }
        ]
    }
}
```

#### 7.2.3 性能优化

```typescript
// 建议：实现上下文缓存
class ContextCache {
    private cache: Map<string, CachedContext> = new Map();
    
    async getContext(sessionId: string): Promise<Context> {
        const cached = this.cache.get(sessionId);
        if (cached && !this.isExpired(cached)) {
            return cached.context;
        }
        const context = await this.buildContext(sessionId);
        this.cache.set(sessionId, { context, timestamp: Date.now() });
        return context;
    }
}
```

### 7.3 长期改进 (3-6 月)

#### 7.3.1 MCP 协议支持

```typescript
// 建议：实现完整的 MCP 客户端
class MCPClient {
    private servers: Map<string, MCPServer> = new Map();
    
    async connect(serverConfig: MCPServerConfig): Promise<void> {
        const server = new MCPServer(serverConfig);
        await server.initialize();
        this.servers.set(serverConfig.name, server);
    }
    
    async listTools(): Promise<MCPTool[]> {
        const tools: MCPTool[] = [];
        for (const server of this.servers.values()) {
            tools.push(...await server.listTools());
        }
        return tools;
    }
}
```

#### 7.3.2 云端同步服务

```typescript
// 建议：实现云端同步服务
class CloudSyncService {
    async syncSession(sessionId: string): Promise<void> {
        const local = await this.loadLocal(sessionId);
        const remote = await this.loadRemote(sessionId);
        
        if (this.isNewer(local, remote)) {
            await this.upload(local);
        } else {
            await this.download(remote);
        }
    }
}
```

#### 7.3.3 插件系统

```typescript
// 建议：实现完整的插件系统
interface AgentPlugin {
    name: string;
    version: string;
    onLoad(agent: Agent): Promise<void>;
    onUnload(agent: Agent): Promise<void>;
    tools?: ToolDefinition[];
    middleware?: MiddlewareFunction;
}

class PluginManager {
    async register(plugin: AgentPlugin): Promise<void> {
        await plugin.onLoad(this.agent);
        this.plugins.set(plugin.name, plugin);
        
        // 注册插件工具
        if (plugin.tools) {
            for (const tool of plugin.tools) {
                this.agent.registerTool(tool);
            }
        }
    }
}
```

---

## 8. 附录：核心代码流程图

### 8.1 完整执行流程

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Agent.execute(query)                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  1. InputValidator.validate(query)                                                  │
│     - 检查空字符串/空白字符                                                          │
│     - 检查最大长度 (100000)                                                          │
│     - 验证多模态内容部分                                                              │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  2. AgentState.startTask()                                                          │
│     - 重置 loopCount, retryCount                                                    │
│     - 创建 AbortController                                                           │
│     - 设置 status = RUNNING                                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  3. Session.initialize() + addMessage(user)                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  4. runLoop()  ─────────────────────────────────────────────────────────────────┐   │
│     ┌─────────────────────────────────────────────────────────────────────────┐ │   │
│     │ while(true) {                                                           │ │   │
│     │   ├─ isAborted()? → break                                               │ │   │
│     │   ├─ checkComplete()? → break                                           │ │   │
│     │   ├─ isRetryExceeded()? → throw AgentMaxRetriesExceededError            │ │   │
│     │   ├─ canContinue()? → throw AgentLoopExceededError                      │ │   │
│     │   ├─ needsRetry()? → handleRetry() → sleepWithAbort()                   │ │   │
│     │   │                                                                     │ │   │
│     │   └─ try {                                                              │ │   │
│     │        setStatus(THINKING)                                              │ │   │
│     │        executeLLMCall() ──────────────────────────────────────────────┐ │ │   │
│     │        recordSuccess()                                                │ │ │   │
│     │     } catch {                                                         │ │ │   │
│     │        handleLoopError()                                              │ │ │   │
│     │     }                                                                 │ │ │   │
│     │ }                                                                     │ │ │   │
│     └─────────────────────────────────────────────────────────────────────────┘ │   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  5. executeLLMCall(options)                                                         │
│     ├─ session.compactBeforeLLMCall()                                               │
│     ├─ AgentState.prepareLLMCall()  ← 创建新的 AbortController                       │
│     ├─ getMessagesForLLM() → enforceToolCallProtocol()                              │
│     └─ LLMCaller.execute(messages, tools, abortSignal, options)                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  6. LLMCaller.execute()                                                             │
│     ├─ 创建 AbortController                                                         │
│     ├─ StreamProcessor.reset()                                                      │
│     ├─ 构建合并的 AbortSignal:                                                      │
│     │   ├─ 流式：IdleTimeoutController.signal (每次收到 chunk 重置)                   │
│     │   └─ 非流式：AbortSignal.timeout(requestTimeout)                              │
│     │                                                                                │
│     └─ if (stream) {                                                                │
│          executeStream()                                                            │
│            ├─ provider.generate() → AsyncIterable<Chunk>                            │
│            ├─ for await (chunk of stream) {                                         │
│            │    ├─ StreamProcessor.processChunk(chunk)                              │
│            │    │    ├─ resetIdleTimeout()                                          │
│            │    │    ├─ handleReasoningContent()                                    │
│            │    │    ├─ handleTextContent()                                         │
│            │    │    ├─ handleToolCalls()                                           │
│            │    │    └─ validateAfterDelta() → ResponseValidator                    │
│            │    └─ isAborted()? → throw LLMPermanentError/LLMRetryableError         │
│            │                                                                         │
│            └─ StreamProcessor.buildResponse()                                       │
│        } else {                                                                     │
│          executeNormal() → provider.generate()                                      │
│        }                                                                            │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  7. Agent.handleResponse(response, messageId)                                       │
│     ├─ getResponseFinishReason()                                                    │
│     ├─ if (finishReason === 'abort') → throw LLMRetryableError                      │
│     │                                                                                │
│     └─ if (responseHasToolCalls(response)) {                                        │
│          handleToolCallResponse()                                                   │
│            ├─ updateMessageToolCalls() (流式) / addMessage() (非流式)               │
│            └─ ToolExecutor.execute(toolCalls, messageId, content)                   │
│                ├─ validateToolCalls()                                               │
│                ├─ captureFileSnapshots()                                            │
│                ├─ toolRegistry.execute()                                            │
│                ├─ recordResults() → addMessage(tool-result)                         │
│                └─ emitCodePatches() → 生成 unified diff                             │
│        } else {                                                                     │
│          handleTextResponse()                                                       │
│            ├─ 流式：更新现有消息 + emitTextComplete()                               │
│            └─ 非流式：addMessage(assistant)                                         │
│        }                                                                            │
│                                                                                     │
│     └─ isEmptyAssistantChoice(response)?                                            │
│          ├─ removeAssistantMessageFromContext()                                     │
│          └─ throw LLMRetryableError('EMPTY_RESPONSE')                               │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  8. checkComplete()                                                                 │
│     ├─ getLastMessage()                                                             │
│     └─ checkAssistantComplete():                                                    │
│         ├─ finish_reason === 'tool_calls' → false (继续执行工具)                     │
│         ├─ finish_reason === 'length' → 检查是否有未完成内容                         │
│         ├─ hasToolCalls? → false                                                    │
│         └─ hasAssistantOutput? && !hasToolCalls → true (完成)                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  9. completeTask() / failTask(error)                                                │
│     ├─ AgentState.completeTask() / failTask(failure)                                │
│     ├─ EventBus.emit(TASK_SUCCESS / TASK_FAILED)                                    │
│     └─ AgentEmitter.emitStatus(COMPLETED / FAILED)                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  10. flushSession() → session.sync()                                                │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 错误处理层次

```
┌─────────────────────────────────────────────────────────────┐
│                    错误处理层次结构                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: InputValidator                                    │
│    └─ AgentValidationError (输入无效)                        │
│                                                              │
│  Layer 2: AgentState                                        │
│    ├─ AgentBusyError (状态不对)                              │
│    ├─ AgentLoopExceededError (循环超限)                      │
│    └─ AgentMaxRetriesExceededError (重试超限)                │
│                                                              │
│  Layer 3: LLMCaller                                         │
│    ├─ LLMRequestError (请求失败)                             │
│    ├─ LLMResponseInvalidError (响应无效)                     │
│    ├─ LLMRetryableError (可重试)                             │
│    └─ LLMPermanentError (永久错误)                           │
│                                                              │
│  Layer 4: StreamProcessor                                   │
│    ├─ buffer_overflow                                        │
│    └─ validation_violation                                   │
│                                                              │
│  Layer 5: ToolExecutor                                      │
│    └─ ToolError (工具执行失败)                               │
│                                                              │
│  Layer 6: ErrorClassifier                                   │
│    └─ 统一分类为 AgentFailureCode                            │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 状态转换图

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Agent 状态机                                              │
│                                                                                     │
│     ┌─────────┐                                                                    │
│     │  IDLE   │ ◀─────────────────────────────────────────────────────────────┐   │
│     └────┬────┘                                                               │   │
│          │ execute()                                                          │   │
│          ▼                                                                    │   │
│     ┌─────────┐     abort()      ┌─────────┐                                 │   │
│     │ RUNNING │ ───────────────▶ │ ABORTED │                                 │   │
│     └────┬────┘                  └─────────┘                                 │   │
│          │                                                                   │   │
│          │ setStatus(THINKING)                                               │   │
│          ▼                                                                   │   │
│     ┌─────────┐                                                              │   │
│     │THINKING │                                                              │   │
│     └────┬────┘                                                              │   │
│          │                                                                   │   │
│          ├──────────────────────────────────────────────────────────────┐    │   │
│          │                                                              │    │   │
│          ▼                                                              ▼    │   │
│     ┌─────────┐    success    ┌─────────┐    error     ┌─────────┐      │    │   │
│     │ RUNNING │ ◀──────────── │ COMPLETED│            │ FAILED  │ ─────┘    │   │
│     └─────────┘               └─────────┘              └─────────┘           │   │
│          ▲                                                                   │   │
│          │ retry()                                                           │   │
│          │                                                                   │   │
│     ┌────┴────┐                                                              │   │
│     │ RETRYING│ ─────────────────────────────────────────────────────────────┘   │
│     └─────────┘     retry 后返回 RUNNING 或 ABORTED                               │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 参考文献

1. [Coding Agent 架构文档](./ARCHITECTURE.md)
2. [Claude Code 官方文档](https://code.claude.com/docs/en/overview)
3. [Claude Code GitHub 仓库](https://github.com/anthropics/claude-code)
4. [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
5. [Model Context Protocol (MCP) 规范](https://modelcontextprotocol.io/)

---

**文档版本**: v1.0  
**最后更新**: 2026-02-26  
**维护者**: QPSCode
