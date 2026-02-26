# 空闲超时（Idle Timeout）实现计划

## 问题描述

当前超时机制使用 `AbortSignal.timeout()`，这是**固定超时**：
- 从请求开始就倒计时
- 无论是否有数据流动，到时间就强制中断
- 即使 LLM 正在流式输出内容也会被杀死

**问题场景**：
```
请求开始 ──────────────────────────────────────> 时间线
   │
   ├── chunk 1 ── chunk 2 ── chunk 3 ── ... ── chunk N ── 结束
   │
   └── 3分钟超时点（可能还在输出 chunk 5）
              ↑
           这里被中断 ❌（连接正常，任务正在进展）
```

## 目标

实现**空闲超时（Idle Timeout）**机制：
- 每次收到数据就重置超时计时器
- 只有长时间无数据才触发超时
- 活跃的任务永远不会被中断

```
请求开始 ──────────────────────────────────────> 时间线
   │
   ├── chunk 1 ────── chunk 2 ────── [卡住30秒] ────── chunk 3
   │      │              │                │               │
   │      └─重置计时器───┘                │               │
   │                      超时！(无数据)  │               │
   │                           ↑          └─重置计时器───┘
   │                        应该终止 ✅
   │
   └── 只要持续有数据，永远不会超时
```

## 架构设计

### 新增组件

```
src/agent-v2/agent/core/
├── idle-timeout-controller.ts  # 新增：空闲超时控制器
├── llm-caller.ts               # 修改：集成空闲超时
└── stream-processor.ts         # 修改：每次 chunk 重置计时器
```

### 数据流

```
LLMCaller.execute()
    │
    ├── 创建 IdleTimeoutController(idleMs)
    │
    ├── 合并信号：AbortSignal.any([
    │       userAbortSignal,
    │       idleTimeoutController.signal,  // 空闲超时信号
    │   ])
    │
    └── Provider.generate(messages, { abortSignal })
            │
            └── HTTPClient.fetch(url, { signal })
                    │
                    └── StreamParser.parseAsync(reader)
                            │
                            └── for each chunk:
                                    │
                                    └── StreamProcessor.processChunk(chunk)
                                            │
                                            └── idleTimeoutController.reset()
                                                    ↑
                                            每次收到数据重置计时器
```

## 实现步骤

### Phase 1: 空闲超时控制器

**文件**: `src/agent-v2/agent/core/idle-timeout-controller.ts`

```typescript
/**
 * 空闲超时控制器
 *
 * 与 AbortSignal.timeout() 不同，这个控制器：
 * - 每次调用 reset() 都会重新开始计时
 * - 只有超过 idleMs 没有调用 reset() 才会触发超时
 * - 适用于流式请求场景
 */
export class IdleTimeoutController {
    private timer: NodeJS.Timeout | null = null;
    private readonly abortController: AbortController;
    private readonly idleMs: number;
    private startTime: number;

    constructor(idleMs: number) {
        this.idleMs = idleMs;
        this.abortController = new AbortController();
        this.startTime = Date.now();
        this.startTimer();
    }

    /**
     * 重置空闲计时器
     * 每次收到数据时调用
     */
    reset(): void {
        if (this.abortController.signal.aborted) {
            return;
        }
        this.clearTimer();
        this.startTimer();
    }

    /**
     * 获取 AbortSignal，用于传递给 fetch 等
     */
    get signal(): AbortSignal {
        return this.abortController.signal;
    }

    /**
     * 获取从开始到现在经过的时间
     */
    getElapsedTime(): number {
        return Date.now() - this.startTime;
    }

    /**
     * 手动中止
     */
    abort(): void {
        this.clearTimer();
        this.abortController.abort();
    }

    private startTimer(): void {
        this.timer = setTimeout(() => {
            this.abortController.abort(
                new DOMException(
                    `Idle timeout after ${this.idleMs}ms of inactivity`,
                    'TimeoutError'
                )
            );
        }, this.idleMs);
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
```

### Phase 2: 修改 LLMCaller

**文件**: `src/agent-v2/agent/core/llm-caller.ts`

修改点：
1. 新增 `idleTimeoutMs` 配置选项
2. 对于流式请求，使用空闲超时替代固定超时
3. 将 `resetIdleTimeout` 回调传给 StreamProcessor

```typescript
interface LLMCallerConfig {
    // ... 现有配置
    /** 空闲超时（毫秒），用于流式请求 */
    idleTimeoutMs?: number;
}

// execute() 方法中
async execute(...): Promise<LLMCallResult> {
    // 对于流式请求，使用空闲超时
    const idleTimeout = (options.stream ?? this.config.stream)
        ? new IdleTimeoutController(this.config.idleTimeoutMs ?? 3 * 60 * 1000)
        : null;

    // 合并信号
    const signals = [
        this.abortController.signal,
        ...(abortSignal ? [abortSignal] : []),
    ];

    if (idleTimeout) {
        signals.push(idleTimeout.signal);
    } else {
        // 非流式请求使用固定超时
        const timeout = this.config.requestTimeoutMs ?? this.config.provider.getTimeTimeout();
        signals.push(AbortSignal.timeout(timeout));
    }

    const mergedSignal = AbortSignal.any(signals);

    // 传递 resetIdleTimeout 回调
    const resetIdleTimeout = idleTimeout ? () => idleTimeout.reset() : undefined;

    // ... 调用 Provider
}
```

### Phase 3: 修改 StreamProcessor

**文件**: `src/agent-v2/agent/stream-processor.ts`

修改点：
1. 新增 `onResetIdleTimeout` 回调选项
2. 在 `processChunk()` 中调用回调

```typescript
interface StreamProcessorOptions {
    // ... 现有配置
    /** 重置空闲超时回调 */
    onResetIdleTimeout?: () => void;
}

// processChunk() 方法中
processChunk(chunk: Chunk): void {
    if (this.state.aborted) return;

    // 每次收到 chunk 就重置空闲超时
    this.options.onResetIdleTimeout?.();

    // ... 原有处理逻辑
}
```

### Phase 4: 修改 Provider 层（可选优化）

**文件**: `src/providers/openai-compatible.ts`

修改点：
- 流式请求时，可以在 `_generateStream()` 中也重置空闲超时
- 这样可以在更底层就重置，响应更快

### Phase 5: 配置与默认值

**文件**: `src/agent-v2/agent/agent.ts`

```typescript
const AGENT_DEFAULTS = {
    // ... 现有配置
    /** 默认空闲超时（毫秒）- 3 分钟 */
    IDLE_TIMEOUT_MS: 3 * 60 * 1000,
};
```

**文件**: `src/agent-v2/tool/task/subagent-config.ts`

```typescript
// 为需要长时间运行的子 Agent 配置更长的空闲超时
export const AGENT_CONFIGS: Record<SubagentType, AgentConfig> = {
    [SubagentType.Explore]: {
        // ...
        idleTimeoutMs: 10 * 60 * 1000,  // 10 分钟
    },
    // ...
};
```

## 测试计划

### 单元测试

**文件**: `src/agent-v2/agent/core/idle-timeout-controller.test.ts`

```typescript
describe('IdleTimeoutController', () => {
    it('应该在空闲超时后触发中止', async () => {
        const controller = new IdleTimeoutController(100);
        await sleep(150);
        expect(controller.signal.aborted).toBe(true);
    });

    it('reset() 应该重置计时器', async () => {
        const controller = new IdleTimeoutController(100);

        // 在 50ms 时重置
        await sleep(50);
        controller.reset();

        // 100ms 后不应该超时（因为刚重置过）
        await sleep(80);
        expect(controller.signal.aborted).toBe(false);

        // 再等 50ms 应该超时
        await sleep(50);
        expect(controller.signal.aborted).toBe(true);
    });

    it('持续调用 reset() 应该永远不会超时', async () => {
        const controller = new IdleTimeoutController(50);

        for (let i = 0; i < 10; i++) {
            await sleep(30);
            controller.reset();
        }

        expect(controller.signal.aborted).toBe(false);
    });
});
```

### 集成测试

**文件**: `src/agent-v2/agent/agent.idle-timeout.test.ts`

```typescript
describe('Agent 空闲超时', () => {
    it('流式请求中持续有数据不应该超时', async () => {
        // Mock Provider 每隔 1 秒发送一个 chunk
        // 总共发送 5 分钟的内容
        // 空闲超时设置为 30 秒
        // 应该成功完成
    });

    it('流式请求中数据停止应该超时', async () => {
        // Mock Provider 发送几个 chunk 后停止
        // 空闲超时设置为 100ms
        // 应该触发超时
    });

    it('非流式请求应该使用固定超时', async () => {
        // 验证非流式请求行为不变
    });
});
```

## 向后兼容性

- **默认行为不变**：如果没有配置 `idleTimeoutMs`，使用默认 3 分钟
- **非流式请求不变**：继续使用固定超时
- **现有 API 不变**：只是新增可选配置

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 计时器泄漏 | 内存泄漏 | 确保在 finally 中清理 |
| 信号合并复杂性 | 行为异常 | 充分测试 AbortSignal.any() |
| Provider 层兼容性 | 请求失败 | 保持 abortSignal 接口不变 |

## 预计工作量

| 阶段 | 预计时间 |
|------|---------|
| Phase 1: IdleTimeoutController | 30 分钟 |
| Phase 2: 修改 LLMCaller | 1 小时 |
| Phase 3: 修改 StreamProcessor | 30 分钟 |
| Phase 4: Provider 层优化 | 30 分钟 |
| Phase 5: 配置默认值 | 15 分钟 |
| 测试编写 | 1 小时 |
| 联调验证 | 30 分钟 |
| **总计** | **约 4 小时** |

## 验收标准

1. ✅ 流式请求中，只要持续收到数据，永远不会超时
2. ✅ 流式请求中，超过空闲时间没有数据，触发超时
3. ✅ 非流式请求行为不变
4. ✅ 所有现有测试通过
5. ✅ 新增测试覆盖空闲超时场景

## 执行顺序

1. [ ] 创建 `idle-timeout-controller.ts`
2. [ ] 编写 `idle-timeout-controller.test.ts`
3. [ ] 修改 `stream-processor.ts`
4. [ ] 修改 `llm-caller.ts`
5. [ ] 修改 `agent.ts` 添加默认配置
6. [ ] 修改 `subagent-config.ts` 为不同类型配置超时
7. [ ] 编写集成测试
8. [ ] 运行全量测试
9. [ ] 提交代码
