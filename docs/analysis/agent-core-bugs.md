# Agent 核心逻辑 Bug 详细分析

> 文档位置: docs/analysis/agent-core-bugs.md
> 生成日期: 2026-03-04

---

## 1. 状态管理问题

### 1.1 AbortController 竞态条件

**文件**: `src/agent-v2/agent/core/agent-state.ts`, `src/agent-v2/agent/agent.ts`

#### 问题代码

```typescript
// agent.ts - execute() 方法
async execute(options: AgentExecuteOptions): Promise<void> {
    this.agentState.startTask();  // 第一次创建 AbortController
    
    try {
        // ... 中间可能有很多逻辑
        
        await this.executeLLMCall(options);  // 内部调用 prepareLLMCall() 又创建新的
    }
}
```

```typescript
// agent-state.ts - startTask()
startTask(): void {
    this.abortController = new AbortController();  // 创建新的
    this.startTime = Date.now();
}

// agent.ts - prepareLLMCall()
private prepareLLMCall(options: LLMCallOptions): LLMCallPrepareResult {
    const controller = new AbortController();  // 再次创建新的!
    
    // 使用 controller.signal...
}
```

#### 影响

1. 第一个 AbortController 的事件监听器未被清理
2. 内存泄漏
3. 可能导致中止信号传递到错误的请求

#### 建议修复

```typescript
// 方案1: 统一在 agent-state 中管理
class AgentState {
    private _abortController: AbortController | null = null;
    
    startTask(): AbortController {
        if (this._abortController) {
            // 先清理旧的
            this._abortController.abort();
        }
        this._abortController = new AbortController();
        return this._abortController;
    }
    
    getAbortSignal(): AbortSignal {
        return this._abortController?.signal ?? AbortSignal.none();
    }
}
```

---

### 1.2 初始化错误静默吞掉

**文件**: `src/agent-v2/agent/agent.ts`

#### 问题代码

```typescript
private startInitialization(): void {
    if (this.initializePromise) {
        return;
    }
    this.initializePromise = (async () => {
        await this.session.initialize();
    })();
    void this.initializePromise.catch(() => {});  // 静默吞掉!
}
```

#### 影响

1. 初始化失败后无法追踪原因
2. 可能导致后续执行时出现难以理解的错误

#### 建议修复

```typescript
private startInitialization(): void {
    if (this.initializePromise) {
        return;
    }
    this.initializePromise = (async () => {
        try {
            await this.session.initialize();
            this.isInitialized = true;
        } catch (err) {
            this.logger.error('Initialization failed', { error: err });
            this.agentState.setError(err);
            throw err;
        }
    })();
}
```

---

## 2. 流式处理问题

### 2.1 缓冲区大小计算错误

**文件**: `src/agent-v2/agent/stream-processor.ts`

#### 问题代码

```typescript
private appendToBuffer(type: 'reasoning' | 'content', content: string): boolean {
    // 使用字符长度
    const currentSize = this.buffers.reasoning.length + this.buffers.content.length;
    const projectedSize = currentSize + content.length;
    
    // 但 maxBufferSize 是字节数!
    if (projectedSize > this.maxBufferSize) {
        this.state.aborted = true;
        return false;
    }
    
    // ...
}
```

#### 影响

- 英文文本: 1 字符 ≈ 1 字节 → 正常工作
- 中文文本: 1 字符 ≈ 3 字节 → 实际内存是预期的 3 倍
- Emoji: 1 emoji ≈ 4 字节 → 实际内存是预期的 4 倍

#### 建议修复

```typescript
private appendToBuffer(type: 'reasoning' | 'content', content: string): boolean {
    // 使用字节长度
    const currentSize = Buffer.byteLength(this.buffers.reasoning, 'utf8') + 
                        Buffer.byteLength(this.buffers.content, 'utf8');
    const projectedSize = currentSize + Buffer.byteLength(content, 'utf8');
    
    if (projectedSize > this.maxBufferSize) {
        this.state.aborted = true;
        return false;
    }
    
    // ...
}
```

---

### 2.2 单次增量可能超过缓冲区

#### 问题代码

```typescript
// 如果单次 content 超过 maxBufferSize 会怎样?
if (projectedSize > this.maxBufferSize) {
    this.state.aborted = true;
    return false;  // 静默失败
}
```

#### 建议修复

```typescript
const contentBytes = Buffer.byteLength(content, 'utf8');
if (contentBytes > this.maxBufferSize) {
    // 单次增量超过限制，拒绝并记录
    this.logger.warn('Single content exceeds buffer size', {
        contentSize: contentBytes,
        maxBufferSize: this.maxBufferSize
    });
    this.state.aborted = true;
    return false;
}
```

---

## 3. 错误处理问题

### 3.1 重试延迟可能为 0

**文件**: `src/agent-v2/agent/agent.ts`

#### 问题代码

```typescript
private resolveRetryDelay(error: unknown): number {
    const retryAfterMs = this.extractRetryAfterMs(error);
    if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
        return retryAfterMs;
    }
    return this.agentState.nextRetryDelayMs;  // 可能为 0!
}
```

#### 建议修复

```typescript
private resolveRetryDelay(error: unknown): number {
    const retryAfterMs = this.extractRetryAfterMs(error);
    if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
        return Math.min(retryAfterMs, this.config.maxRetryDelayMs ?? 60000);
    }
    return Math.max(
        this.agentState.nextRetryDelayMs,
        this.config.minRetryDelayMs ?? 100  // 最小延迟
    );
}
```

---

### 3.2 错误分类冗余

**文件**: `src/agent-v2/agent/error-classifier.ts`

#### 问题代码

```typescript
// 先检查 instanceof
if (error instanceof AgentAbortedError) {
    return 'AGENT_ABORTED';
}

// 后面又检查 code 属性，可能重复处理
if (hasValidFailureCode(error)) {
    return error.code;
}
```

#### 建议

统一错误分类逻辑，避免重复判断

---

## 4. 资源清理问题

### 4.1 close() 方法不完整

**文件**: `src/agent-v2/agent/agent.ts`

#### 问题代码

```typescript
async close(): Promise<void> {
    this.resolveAllPendingPermissions(false);
    if (this.unsubscribeEventLogger) {
        this.unsubscribeEventLogger();
    }
    this.eventBus.clear();
    // 问题: toolRegistry, session 等资源未清理
    // 问题: 定时器未清理
}
```

#### 建议修复

```typescript
async close(): Promise<void> {
    // 1. 停止接收新请求
    this.agentState.abort();
    
    // 2. 清理待处理权限
    this.resolveAllPendingPermissions(false);
    
    // 3. 清理工具注册表
    this.toolRegistry?.unregisterAll();
    
    // 4. 关闭会话
    await this.session?.close();
    
    // 5. 清理事件日志
    if (this.unsubscribeEventLogger) {
        this.unsubscribeEventLogger();
        this.unsubscribeEventLogger = undefined;
    }
    
    // 6. 清理事件总线
    this.eventBus.clear();
    
    // 7. 清理定时器
    this.clearAllTimers();
    
    // 8. 清理状态
    this.agentState.reset();
}
```

---

### 4.2 空闲超时定时器泄漏

**文件**: `src/agent-v2/agent/core/idle-timeout-controller.ts`

#### 问题代码

```typescript
private startTimer(): void {
    this.timer = setTimeout(() => {
        this.triggerTimeout();  // 如果这里抛异常...
    }, this.idleMs);
}

private triggerTimeout(): void {
    // 可能抛出异常
    this.onIdleTimeout?.();  // 未捕获的异常
    // 此时 timer 引用不会被清除
}
```

#### 建议修复

```typescript
private startTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(async () => {
        try {
            await this.triggerTimeout();
        } catch (err) {
            this.logger.error('Idle timeout handler failed', { error: err });
        } finally {
            this.timer = null;
        }
    }, this.idleMs);
}

private clearTimer(): void {
    if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
    }
}
```

---

## 5. 并发问题

### 5.1 权限决策竞态

**文件**: `src/agent-v2/agent/core/tool-executor.ts`

#### 问题代码

```typescript
const batchApproval = batchApprovalDecisions.get(batchKey);
if (batchApproval === true) {
    continue;
}
if (batchApproval === false) {
    throw new AgentAbortedError();
}
// 第一次遇到时
const approved = await this.config.onPermissionAsk({...});
batchApprovalDecisions.set(batchKey, approved);
```

#### 问题

当多个工具调用具有相同 batchKey 时:
1. 第一个调用触发 onPermissionAsk
2. 第二个调用同时读取到 undefined
3. 第二个调用也触发 onPermissionAsk

#### 建议修复

```typescript
// 使用 Promise 缓存
const pendingApproval = batchApprovalPromises.get(batchKey);
if (pendingApproval) {
    const approved = await pendingApproval;
    // ...
} else {
    const approvalPromise = this.config.onPermissionAsk({...});
    batchApprovalPromises.set(batchKey, approvalPromise);
    const approved = await approvalPromise;
    batchApprovalDecisions.set(batchKey, approved);
}
```

---

## 6. 内存问题

### 6.1 累积 Usage 未清理

**文件**: `src/agent-v2/agent/agent-emitter.ts`

#### 问题代码

```typescript
emitUsageUpdate(usage: Usage, messageId?: string): CumulativeUsage {
    // 整个 Agent 生命周期内持续累加
    this.cumulativeUsage.prompt_tokens += usage.prompt_tokens;
    this.cumulativeUsage.completion_tokens += usage.completion_tokens;
    // 永不重置
    return this.cumulativeUsage;
}
```

#### 风险

虽然 Token 数量通常不会达到 JS Number 精度问题，但长时间运行的 Agent 可能累积数十亿 Token

#### 建议

```typescript
// 添加重置方法
resetUsage(): void {
    this.cumulativeUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

// 或使用 BigInt
this.cumulativeUsage.prompt_tokens = BigInt(this.cumulativeUsage.prompt_tokens) + BigInt(usage.prompt_tokens);
```

---

## 7. 类型安全问题

### 7.1 手动设置 cause 属性

**文件**: `src/agent-v2/agent/errors.ts`

```typescript
constructor(...) {
    super(message, undefined, 'CONTEXT_COMPRESSION_NEEDED');
    if (options?.cause) {
        (this as Error & { cause?: unknown }).cause = options?.cause;
    }
}
```

#### 建议

使用 TypeScript 4.x+ 的 Error cause 支持，或使用自定义错误类

---

## 8. 总结

### 问题统计

| 类别 | 高优先级 | 中优先级 | 低优先级 |
|------|---------|---------|---------|
| 状态管理 | 2 | 1 | - |
| 流式处理 | 1 | 1 | - |
| 错误处理 | 1 | 1 | 1 |
| 资源清理 | 2 | - | - |
| 并发 | - | 1 | - |
| 内存 | - | 1 | 1 |
| 类型安全 | - | - | 1 |

### 关键修复建议

1. **立即修复**: AbortController 竞态、缓冲区字节计算、close() 资源清理
2. **高优先级**: 重试延迟保护、权限决策竞态、启动加载优化
3. **持续改进**: 错误分类优化、类型安全增强
