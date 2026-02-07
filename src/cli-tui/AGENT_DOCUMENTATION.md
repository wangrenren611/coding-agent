# Agent 模块深度分析文档

> 生成日期: 2026-02-07
> 项目路径: `/Users/wrr/work/coding-agent/src/cli-tui/agent`

---

## 目录

1. [模块概述](#模块概述)
2. [文件结构](#文件结构)
3. [stream-adapter.ts 深度分析](#stream-adapterts-深度分析)
4. [use-agent-runner.tsx 深度分析](#use-agent-runnertsx-深度分析)
5. [类型依赖关系](#类型依赖关系)
6. [数据流分析](#数据流分析)
7. [核心机制详解](#核心机制详解)
8. [总结与架构图](#总结与架构图)

---

## 模块概述

`agent` 模块是整个 CLI TUI 项目的核心组件，负责将 `agent-v2` 引擎与前端 UI 进行桥接。该模块主要处理：

- **流式消息处理**: 将 agent 的流式输出转换为 UI 事件
- **会话管理**: 支持会话持久化存储
- **Agent 生命周期管理**: 初始化、执行、中止等操作
- **事件派发**: 将 agent 消息转换为 UI 可渲染的事件

### 核心职责

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent 模块核心职责                        │
├─────────────────────────────────────────────────────────────┤
│  1. 流式适配器 (Stream Adapter)                              │
│     - 解析 agent 消息类型                                    │
│     - 缓冲文本增量                                           │
│     - 派发 UI 事件                                           │
├─────────────────────────────────────────────────────────────┤
│  2. Agent 运行时 (Agent Runner)                              │
│     - 初始化 agent 实例                                      │
│     - 管理会话持久化                                         │
│     - 控制执行流程                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 文件结构

```
agent/
├── stream-adapter.ts       # 流式消息适配器 (378 行)
├── use-agent-runner.tsx    # Agent 运行 hook (202 行)
└── AGENT_DOCUMENTATION.md  # 本文档
```

### 文件统计

| 文件名 | 行数 | 主要功能 |
|--------|------|----------|
| `stream-adapter.ts` | 378 | 将 agent 流式消息转换为 UI 事件 |
| `use-agent-runner.tsx` | 202 | React hook，管理 agent 生命周期 |

---

## stream-adapter.ts 深度分析

### 文件信息

- **文件路径**: `agent/stream-adapter.ts`
- **导出**: `StreamAdapter` 类
- **依赖**: `agent-v2/agent/stream-types`, `../types`

### 核心类: StreamAdapter

#### 类签名

```typescript
export class StreamAdapter {
  private state: StreamingState = createEmptyState();
  private lastTextMsgId: string | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly emit: (event: UIEvent) => void,
    private readonly flushIntervalMs = 33
  ) {}
}
```

#### 构造函数参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `emit` | `(event: UIEvent) => void` | - | 事件派发函数，将处理后的 UI 事件发送到前端 |
| `flushIntervalMs` | `number` | 33 | 文本刷新间隔（毫秒），约 30fps |

### 内部状态管理

#### StreamingState 接口

```typescript
interface StreamingState {
  messageId: string | null;           // 当前消息 ID
  buffer: string;                     // 文本增量缓冲
  fullContent: string;                // 完整文本内容
  hasStarted: boolean;                // 是否已开始接收
  toolCalls: Map<string, ToolInvocation>;  // 工具调用映射
  codePatches: Map<string, CodePatchInfo>; // 代码补丁映射
}
```

#### 状态流转图

```
┌──────────────────────────────────────────────────────────────────┐
│                        状态流转图                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  createEmptyState()                                               │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────┐                                                 │
│  │   初始状态   │                                                 │
│  │ messageId=  │                                                 │
│  │ null        │                                                 │
│  └─────────────┘                                                 │
│       │                                                          │
│       │ handleTextStart()                                        │
│       ▼                                                          │
│  ┌─────────────┐                                                 │
│  │  接收开始    │  handleTextDelta()                              │
│  │ messageId=  │◄────────────────────────────────┐               │
│  │ "xxx"       │                                 │               │
│  └─────────────┘                                 │               │
│       │                                         │               │
│       │ handleTextDelta()                       │               │
│       │ scheduleFlush()                         │               │
│       ▼                                         │               │
│  ┌─────────────┐  handleTextComplete()          │               │
│  │  文本缓冲    │◄────────────────────────────────┘               │
│  │ buffer+=    │                                                 │
│  │ content     │                                                 │
│  └─────────────┘                                                 │
│       │                                                          │
│       │ flushNow() / flushPartial()                              │
│       ▼                                                          │
│  ┌─────────────┐                                                 │
│  │  完成状态    │                                                 │
│  │ messageId=  │ ──► reset() ──► 返回初始状态                    │
│  │ null        │                                                 │
│  └─────────────┘                                                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 消息处理核心方法

#### 1. handleAgentMessage() - 消息分发器

```typescript
handleAgentMessage(message: AgentMessage): void {
  switch (message.type) {
    case 'text-start':
      this.handleTextStart(message as TextStartMessage);
      break;
    case 'text-delta':
      this.handleTextDelta(message as ThoughtMessage);
      break;
    case 'text-complete':
      this.handleTextComplete(message as TextMessage);
      break;
    case 'tool_call_created':
      this.handleToolCallCreated(message as ToolCallCreatedMessage);
      break;
    case 'tool_call_stream':
      this.handleToolCallStream(message as ToolCallStreamMessage);
      break;
    case 'tool_call_result':
      this.handleToolCallResult(message as ToolCallResultMessage);
      break;
    case 'code_patch':
      this.handleCodePatch(message as CodePatchMessage);
      break;
    case 'status':
      this.handleStatus(message as StatusMessage);
      break;
    case 'error':
      this.handleError(message as ErrorMessage);
      break;
    default:
      break;
  }
}
```

**支持的 Agent 消息类型**:

| 消息类型 | 处理方法 | 用途 |
|----------|----------|------|
| `text-start` | handleTextStart | 文本消息开始 |
| `text-delta` | handleTextDelta | 文本增量（流式输出） |
| `text-complete` | handleTextComplete | 文本消息完成 |
| `tool_call_created` | handleToolCallCreated | 工具调用创建 |
| `tool_call_stream` | handleToolCallStream | 工具调用流式输出 |
| `tool_call_result` | handleToolCallResult | 工具调用结果 |
| `code_patch` | handleCodePatch | 代码补丁 |
| `status` | handleStatus | 状态更新 |
| `error` | handleError | 错误处理 |

#### 2. handleTextStart() - 文本开始处理

```typescript
private handleTextStart(message: TextStartMessage): void {
  const { msgId, timestamp } = message;

  // 如果有未完成的消息，先完成它
  if (this.state.messageId && this.state.messageId !== msgId) {
    this.flushAndCompleteCurrent();
  }

  // 初始化状态
  this.state.messageId = msgId;
  this.lastTextMsgId = msgId;
  this.state.buffer = '';
  this.state.fullContent = '';
  this.state.hasStarted = true;

  // 派发事件
  this.emit({
    type: 'text-start',
    messageId: msgId,
    timestamp,
  });
}
```

**关键逻辑**:
- 处理消息 ID 切换时自动完成前一条消息
- 重置缓冲区，准备接收新消息

#### 3. handleTextDelta() - 文本增量处理

```typescript
private handleTextDelta(message: ThoughtMessage): void {
  const { msgId, payload, timestamp } = message;
  const content = payload.content || '';

  // 如果消息 ID 不匹配，先启动新消息
  if (this.state.messageId !== msgId) {
    this.handleTextStart({
      ...message,
      type: 'text-start',
      timestamp: timestamp ?? Date.now(),
    } as TextStartMessage);
  }

  if (!content) return;

  // 累积到缓冲区
  this.state.buffer += content;
  this.state.fullContent += content;

  // 调度刷新
  this.scheduleFlush(msgId);
}
```

**关键逻辑**:
- 累积文本增量到缓冲区
- 使用节流策略减少 UI 更新频率（默认 33ms）

#### 4. handleTextComplete() - 文本完成处理

```typescript
private handleTextComplete(message: TextMessage): void {
  const { msgId, payload, timestamp } = message;
  const content = payload.content || '';

  if (this.state.messageId !== msgId) {
    this.handleTextStart({
      type: 'text-start',
      msgId,
      timestamp: timestamp ?? Date.now(),
      payload: { content: '' },
    } as TextStartMessage);
  }

  // 立即刷新缓冲区
  this.flushNow();

  // 派发完成事件
  this.emit({
    type: 'text-complete',
    messageId: msgId,
    content: content || this.state.fullContent,
  });

  // 重置状态
  this.state.messageId = null;
  this.lastTextMsgId = msgId;
  this.state.buffer = '';
  this.state.fullContent = '';
  this.state.hasStarted = false;
  this.clearFlushTimer();
}
```

#### 5. handleToolCallCreated() - 工具调用创建

```typescript
private handleToolCallCreated(message: ToolCallCreatedMessage): void {
  const { msgId, payload, timestamp } = message;

  // 先完成当前的文本消息
  if (this.state.messageId) {
    this.flushNow();
  }

  // 处理每个工具调用
  for (const toolCall of payload.tool_calls) {
    const parsedArgs = parseToolArgs(toolCall.args);
    const invocation: ToolInvocation = {
      id: toolCall.callId,
      name: toolCall.toolName,
      args: parsedArgs,
      status: 'running',
      startedAt: timestamp,
    };

    this.state.toolCalls.set(toolCall.callId, invocation);

    // 派发工具开始事件
    this.emit({
      type: 'tool-start',
      messageId: msgId,
      toolCallId: toolCall.callId,
      toolName: toolCall.toolName,
      args: parsedArgs,
      timestamp,
      content: payload.content,
    });
  }
}
```

**工具调用状态流转**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    工具调用生命周期                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  tool_call_created                                              │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐                                                │
│  │   running   │  tool_call_stream (optional)                   │
│  │             │◄────────────────────────────────┐              │
│  └─────────────┘                                 │              │
│       │                                         │              │
│       │ tool_call_result (success/error)        │              │
│       ▼                                         │              │
│  ┌─────────────┐  tool_call_result              │              │
│  │ completed   │◄────────────────────────────────┘              │
│  │ (removed)   │                                                │
│  └─────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 6. handleToolCallStream() - 工具调用流式输出

```typescript
private handleToolCallStream(message: ToolCallStreamMessage): void {
  const { payload, timestamp } = message;
  const { callId, output } = payload;
  const messageId = (message as { msgId?: string }).msgId
    ?? this.state.messageId
    ?? this.lastTextMsgId;

  if (!messageId) return;

  const invocation = this.state.toolCalls.get(callId);
  if (!invocation) return;

  // 累积流式输出
  invocation.streamOutput = (invocation.streamOutput || '') + output;

  // 派发流式事件
  this.emit({
    type: 'tool-stream',
    messageId,
    toolCallId: callId,
    output,
    timestamp,
  });
}
```

#### 7. handleToolCallResult() - 工具调用结果

```typescript
private handleToolCallResult(message: ToolCallResultMessage): void {
  const { payload, timestamp } = message;
  const { callId, status, result } = payload;

  const invocation = this.state.toolCalls.get(callId);
  if (!invocation) return;

  const messageId = (message as { msgId?: string }).msgId
    ?? this.state.messageId
    ?? this.lastTextMsgId;

  if (!messageId) return;

  // 计算执行时长
  const duration = timestamp - invocation.startedAt;

  if (status === 'success') {
    this.emit({
      type: 'tool-complete',
      messageId,
      toolCallId: callId,
      result: safeStringify(result),
      duration,
      timestamp,
    });
  } else {
    this.emit({
      type: 'tool-error',
      messageId,
      toolCallId: callId,
      error: safeStringify(result) || 'Tool call failed',
      duration,
      timestamp,
    });
  }

  // 从映射中移除
  this.state.toolCalls.delete(callId);
}
```

#### 8. handleCodePatch() - 代码补丁处理

```typescript
private handleCodePatch(message: CodePatchMessage): void {
  const { msgId, payload, timestamp } = message;
  const { path, diff, language } = payload;

  // 保存到代码补丁映射
  this.state.codePatches.set(path, { path, diff, language, timestamp });

  // 派发代码补丁事件
  this.emit({
    type: 'code-patch',
    messageId: msgId,
    path,
    diff,
    language,
    timestamp,
  });
}
```

#### 9. handleStatus() - 状态处理

```typescript
private handleStatus(message: StatusMessage): void {
  const state = message.payload?.state;

  // 派发状态事件
  this.emit({
    type: 'status',
    state: typeof state === 'string' ? state : undefined,
    message: message.payload?.message,
  });

  if (!state || typeof state !== 'string') return;

  const normalized = state.toLowerCase();

  // 判断是否为终态
  const isTerminal =
    normalized === 'completed' ||
    normalized === 'success' ||
    normalized === 'succeeded' ||
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'aborted';

  if (!isTerminal) return;

  // 完成当前会话
  this.flushAndCompleteCurrent();
  this.emit({ type: 'session-complete' });
  this.reset();
}
```

**支持的终态**:

| 状态值 | 说明 |
|--------|------|
| `completed` | 正常完成 |
| `success` | 成功 |
| `succeeded` | 成功（同义词） |
| `failed` | 失败 |
| `error` | 错误 |
| `aborted` | 中止 |

#### 10. handleError() - 错误处理

```typescript
private handleError(message: ErrorMessage): void {
  this.emit({
    type: 'error',
    message: message.payload?.error || 'Unknown error',
    phase: message.payload?.phase,
  });
  this.reset();
}
```

### 缓冲区管理机制

#### 刷新策略

```typescript
// 调度刷新（节流）
private scheduleFlush(messageId: string): void {
  if (this.flushTimer) return;  // 防止重复调度

  this.flushTimer = setTimeout(() => {
    this.flushTimer = null;
    this.flushPartial(messageId);
  }, this.flushIntervalMs);
}

// 部分刷新
private flushPartial(messageId: string): void {
  if (!this.state.buffer) return;
  if (this.state.messageId !== messageId) return;

  const delta = this.state.buffer;
  this.state.buffer = '';

  this.emit({
    type: 'text-delta',
    messageId,
    contentDelta: delta,
    isDone: false,
  });
}

// 立即刷新
private flushNow(): void {
  this.clearFlushTimer();
  if (!this.state.messageId || !this.state.buffer) return;

  const delta = this.state.buffer;
  this.state.buffer = '';

  this.emit({
    type: 'text-delta',
    messageId: this.state.messageId,
    contentDelta: delta,
    isDone: false,
  });
}
```

**缓冲区刷新流程**:

```
文本增量到达
     │
     ▼
┌────────────┐
│ 加入 buffer │ ◄──── 累积
└────────────┘
     │
     │ scheduleFlush()
     ▼
┌────────────────────────────────────┐
│ 检查是否有待处理的 flushTimer?      │
│                                    │
│   是 ──► 忽略，等待定时器触发        │
│   否 ──► 创建新的定时器 (33ms)      │
└────────────────────────────────────┘
                │
                ▼ (33ms 后)
┌────────────────────────────────────┐
│ 定时器触发                          │
│                                    │
│ flushTimer = null                  │
│ 调用 flushPartial()                │
└────────────────────────────────────┘
                │
                ▼
┌────────────────────────────────────┐
│ flushPartial()                     │
│                                    │
│ 1. 检查 buffer 和 messageId        │
│ 2. 取出 buffer 内容                │
│ 3. 清空 buffer                     │
│ 4. 派发 text-delta 事件            │
└────────────────────────────────────┘
```

### 工具函数

#### parseToolArgs() - 工具参数解析

```typescript
const parseToolArgs = (args: unknown): Record<string, unknown> => {
  // 情况 1: JSON 字符串
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      return { raw: args };
    }
  }

  // 情况 2: 已是对象
  if (args && typeof args === 'object') {
    return args as Record<string, unknown>;
  }

  // 情况 3: 其他类型
  return { raw: args };
};
```

**解析逻辑**:
- 输入是字符串 -> 尝试 JSON 解析
- 输入是对象 -> 直接返回
- 其他类型 -> 包装为 `{ raw: value }`

#### safeStringify() - 安全序列化

```typescript
const safeStringify = (value: unknown): string => {
  // 字符串直接返回
  if (typeof value === 'string') return value;
  // null/undefined 返回空字符串
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
```

### 公共方法

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `reset()` | - | `void` | 重置内部状态 |
| `dispose()` | - | `void` | 释放资源（调用 reset） |
| `handleAgentMessage()` | `message: AgentMessage` | `void` | 处理 agent 消息 |

---

## use-agent-runner.tsx 深度分析

### 文件信息

- **文件路径**: `agent/use-agent-runner.tsx`
- **导出**: `useAgentRunner()` 函数
- **依赖**: `react`, `agent-v2/agent/agent`, `agent-v2/agent/types`, `agent-v2/prompts/operator`, `providers`, `state/chat-store`, `stream-adapter`, `agent-v2/memory`

### 核心函数: useAgentRunner()

#### 函数签名

```typescript
export function useAgentRunner(model: ModelId): UseAgentRunnerReturn
```

#### 返回值类型

```typescript
export interface UseAgentRunnerReturn {
  messages: ReturnType<typeof useChatStore>['messages'];
  isLoading: boolean;
  executionState: ReturnType<typeof useChatStore>['executionState'];
  statusMessage?: string;
  submitMessage: (input: string) => void;
  clearMessages: () => void;
  addSystemMessage: (level: 'info' | 'warn' | 'error', content: string) => void;
  stopCurrentRun: () => void;
  sessions: ReturnType<typeof useChatStore>['sessions'];
  currentSessionId: ReturnType<typeof useChatStore>['currentSessionId'];
  isStorageReady: boolean;
  createNewSession: (title?: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSessionById: (sessionId: string) => Promise<void>;
}
```

### 内部状态引用

```typescript
const agentRef = useRef<Agent | null>(null);           // Agent 实例
const adapterRef = useRef<StreamAdapter | null>(null); // StreamAdapter 实例
const memoryManagerRef = useRef<ReturnType<typeof createMemoryManager> | null>(null); // 内存管理器
const applyEventRef = useRef<ReturnType<typeof useChatStore>['applyEvent'] | null>(null); // 事件应用函数
```

**为什么使用 useRef**:

| Ref | 用途 | 说明 |
|-----|------|------|
| `agentRef` | 存储 Agent 实例 | 保持跨渲染的 agent 状态 |
| `adapterRef` | 存储 StreamAdapter | 生命周期与 agent 同步 |
| `memoryManagerRef` | 存储内存管理器 | 持久化会话数据 |
| `applyEventRef` | 存储 applyEvent | 在回调中访问最新的 store 方法 |

### 常量定义

```typescript
const STORAGE_PATH = process.env.CODING_AGENT_SESSIONS_PATH || '.coding-agent/sessions';
```

**说明**:
- 会话存储路径
- 默认值: `.coding-agent/sessions`
- 可通过环境变量 `CODING_AGENT_SESSIONS_PATH` 覆盖

### 生命周期分析

#### 1. MemoryManager 初始化

```typescript
// Initialize MemoryManager
useEffect(() => {
  const mm = createMemoryManager({
    type: 'file',
    connectionString: STORAGE_PATH,
  });
  memoryManagerRef.current = mm;

  mm.initialize().catch(error => {
    console.error('Failed to initialize memory manager:', error);
  });

  return () => {
    mm.close().catch(console.error);
  };
}, []);
```

**生命周期**:
- 挂载时: 创建并初始化 MemoryManager
- 卸载时: 关闭 MemoryManager

#### 2. Agent 初始化与重初始化

```typescript
// Re-initialize agent when session changes
useEffect(() => {
  initAgent();

  return () => {
    adapterRef.current?.dispose();
    agentRef.current?.abort();
    adapterRef.current = null;
    agentRef.current = null;
  };
}, [initAgent]);
```

**触发条件**:
- `initAgent` 依赖变化时（model, currentSessionId）
- 清理时: 释放 adapter 和 agent 资源

### 核心方法详解

#### initAgent() - Agent 初始化

```typescript
const initAgent = useCallback(() => {
  try {
    // 1. 创建 Provider
    const provider = ProviderRegistry.createFromEnv(model);

    // 2. 创建 StreamAdapter
    const adapter = new StreamAdapter(event => applyEventRef.current?.(event));

    // 3. 配置 Agent
    const agentConfig = {
      provider,
      systemPrompt: operatorPrompt({
        directory: process.cwd(),
        vcs: 'git',
        language: 'Chinese',
      }),
      stream: true,
      streamCallback: message => adapter.handleAgentMessage(message),
    };

    // 4. 添加会话持久化
    if (currentSessionId && memoryManagerRef.current) {
      agentConfig.sessionId = currentSessionId;
      agentConfig.memoryManager = memoryManagerRef.current;
    }

    // 5. 创建 Agent
    const agent = new Agent(agentConfig);

    // 6. 保存引用
    agentRef.current = agent;
    adapterRef.current = adapter;

    // 7. 更新状态
    setStatusMessage(`Model: ${model}${currentSessionId ? ` | Session: ${currentSessionId.slice(0, 8)}` : ''}`);
    setExecutionState('idle');

  } catch (error) {
    agentRef.current = null;
    adapterRef.current = null;
    const message = error instanceof Error ? error.message : String(error);
    addSystemMessage('error', `Failed to initialize model '${model}': ${message}`);
    setExecutionState('error', 'Model initialization failed');
  }
}, [addSystemMessage, model, setExecutionState, setStatusMessage, currentSessionId]);
```

**初始化流程图**:

```
┌─────────────────────────────────────────────────────────────────┐
│                      initAgent() 流程                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  start                                                           │
│    │                                                            │
│    ▼                                                            │
│  ┌─────────────────┐                                            │
│  │ 1. 创建 Provider │ ProviderRegistry.createFromEnv(model)    │
│  └─────────────────┘                                            │
│    │                                                            │
│    ▼                                                            │
│  ┌─────────────────────────┐                                    │
│  │ 2. 创建 StreamAdapter   │ with emit callback                 │
│  └─────────────────────────┘                                    │
│    │                                                            │
│    ▼                                                            │
│  ┌─────────────────────────┐                                    │
│  │ 3. 配置 Agent           │                                    │
│  │   - provider            │                                    │
│  │   - systemPrompt        │ operatorPrompt()                   │
│  │   - stream=true         │                                    │
│  │   - streamCallback      │ adapter.handleAgentMessage         │
│  └─────────────────────────┘                                    │
│    │                                                            │
│    ▼                                                            │
│  ┌─────────────────────────────────┐                            │
│  │ 4. 添加会话持久化 (可选)          │                            │
│  │   - sessionId                   │                            │
│  │   - memoryManager               │                            │
│  └─────────────────────────────────┘                            │
│    │                                                            │
│    ▼                                                            │
│  ┌─────────────────┐                                            │
│  │ 5. 创建 Agent   │ new Agent(config)                         │
│  └─────────────────┘                                            │
│    │                                                            │
│    ▼                                                            │
│  ┌─────────────────────────┐                                    │
│  │ 6. 保存引用并更新状态    │                                    │
│  └─────────────────────────┘                                    │
│    │                                                            │
│    ▼                                                            │
│  success / error                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### submitMessage() - 提交消息

```typescript
const submitMessage = useCallback(
  (input: string) => {
    const message = input.trim();
    if (!message) return;

    const agent = agentRef.current;
    if (!agent) {
      addSystemMessage('error', 'Agent is not initialized. Check model and API config.');
      return;
    }

    if (agent.getStatus() !== AgentStatus.IDLE) {
      agent.abort();
    }

    addUserMessage(message);
    setLoading(true);
    setStatusMessage(undefined);

    agent
      .execute(message)
      .then(() => {
        setLoading(false);
      })
      .catch(error => {
        setLoading(false);
        applyEventRef.current?.({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          phase: 'agent.execute',
        });
      });
  },
  [addSystemMessage, addUserMessage, setLoading, setStatusMessage]
);
```

**执行流程**:

```
submitMessage(input)
     │
     ▼
┌────────────────────┐
│ 1. 验证非空输入     │ trim() && !empty
└────────────────────┘
     │
     ▼
┌────────────────────┐
│ 2. 检查 Agent 状态  │ agentRef.current
└────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│ 3. 如果 Agent 正在运行，中止它      │ agent.getStatus() !== IDLE
│                                    │ agent.abort()
└────────────────────────────────────┘
     │
     ▼
┌────────────────────┐
│ 4. 添加用户消息     │ addUserMessage()
└────────────────────┘
     │
     ▼
┌────────────────────┐
│ 5. 设置加载状态     │ setLoading(true)
└────────────────────┘
     │
     ▼
┌────────────────────┐
│ 6. 执行 Agent      │ agent.execute(message)
└────────────────────┘
     │
     ├──► success ──► setLoading(false)
     │
     └──► error ──► 派发错误事件
```

#### stopCurrentRun() - 停止当前运行

```typescript
const stopCurrentRun = useCallback(() => {
  const agent = agentRef.current;
  if (!agent) return;

  const status = agent.getStatus();
  if (status === AgentStatus.RUNNING || status === AgentStatus.THINKING || status === AgentStatus.RETRYING) {
    agent.abort();
    setLoading(false);
    setExecutionState('idle', 'Stopped');
  }
}, [setExecutionState, setLoading]);
```

**可停止的状态**:
- `RUNNING` - 运行中
- `THINKING` - 思考中
- `RETRYING` - 重试中

### 返回值汇总

| 属性 | 类型 | 说明 |
|------|------|------|
| `messages` | `Message[]` | 聊天消息列表 |
| `isLoading` | `boolean` | 是否正在加载 |
| `executionState` | `AgentExecutionState` | 执行状态 |
| `statusMessage` | `string \| undefined` | 状态消息 |
| `submitMessage` | `(input: string) => void` | 提交消息函数 |
| `clearMessages` | `() => void` | 清空消息函数 |
| `addSystemMessage` | `(level, content) => void` | 添加系统消息 |
| `stopCurrentRun` | `() => void` | 停止当前运行 |
| `sessions` | `Session[]` | 会话列表 |
| `currentSessionId` | `string \| null` | 当前会话 ID |
| `isStorageReady` | `boolean` | 存储是否就绪 |
| `createNewSession` | `(title?) => Promise<string>` | 创建新会话 |
| `loadSession` | `(sessionId) => Promise<void>` | 加载会话 |
| `deleteSessionById` | `(sessionId) => Promise<void>` | 删除会话 |

---

## 类型依赖关系

### 导入的类型

#### stream-adapter.ts 导入

```typescript
// 从 agent-v2/agent/stream-types 导入
import type {
  AgentMessage,
  CodePatchMessage,
  ErrorMessage,
  StatusMessage,
  TextMessage,
  TextStartMessage,
  ThoughtMessage,
  ToolCallCreatedMessage,
  ToolCallResultMessage,
  ToolCallStreamMessage,
} from '../../agent-v2/agent/stream-types';

// 从 ../types 导入
import type { ToolInvocation, UIEvent } from '../types';
```

#### use-agent-runner.tsx 导入

```typescript
import { Agent } from '../../agent-v2/agent/agent';
import { AgentStatus } from '../../agent-v2/agent/types';
import { operatorPrompt } from '../../agent-v2/prompts/operator';
import { ProviderRegistry, type ModelId } from '../../providers';
import { useChatStore } from '../state/chat-store';
import { StreamAdapter } from './stream-adapter';
import { createMemoryManager } from '../../agent-v2/memory';
```

### 类型依赖图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           类型依赖关系图                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  agent-v2/agent/stream-types                                            │
│  ┌─────────────────┐                                                    │
│  │ AgentMessage    │ ─┐                                                 │
│  │ TextStartMessage│  │                                                 │
│  │ TextMessage     │  │                                                 │
│  │ ThoughtMessage  │  │                                                 │
│  │ ToolCallCreated │  │                                                 │
│  │ ToolCallResult  │  │                                                 │
│  │ CodePatchMessage│  │                                                 │
│  │ StatusMessage   │  │                                                 │
│  │ ErrorMessage    │  │                                                 │
│  └─────────────────┘  │                                                 │
│         ▲            │                                                 │
│         │            │                                                 │
│  stream-adapter.ts   │                                                 │
│  ┌─────────────────┐ │                                                 │
│  │ StreamAdapter   │◄┘                                                 │
│  │ handleAgentMsg()│                                                   │
│  └─────────────────┘                                                   │
│         │            │                                                 │
│         │ emits      │                                                 │
│         ▼            │                                                 │
│  ../types/index.ts  ─┘                                                 │
│  ┌─────────────────┐                                                    │
│  │ UIEvent         │                                                    │
│  │ ToolInvocation  │                                                    │
│  │ Message         │                                                    │
│  │ ChatState       │                                                    │
│  └─────────────────┘                                                    │
│         ▲                                                               │
│         │                                                               │
│  state/chat-store.ts                                                    │
│  ┌─────────────────┐                                                    │
│  │ useChatStore    │                                                    │
│  │ applyEvent()    │                                                    │
│  └─────────────────┘                                                    │
│         ▲                                                               │
│         │                                                               │
│  use-agent-runner.tsx                                                   │
│  ┌─────────────────┐                                                    │
│  │ useAgentRunner  │                                                    │
│  └─────────────────┘                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 数据流分析

### 完整数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           完整数据流                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐                                                         │
│  │ User Input  │                                                         │
│  └──────┬──────┘                                                         │
│         │                                                                │
│         ▼                                                                │
│  ┌──────────────────────────┐                                           │
│  │   useAgentRunner         │◄────────────────────────────────┐         │
│  │   - submitMessage()      │                                 │         │
│  │   - stopCurrentRun()     │                                 │         │
│  └───────────┬──────────────┘                                 │         │
│              │                                                 │         │
│              │ agent.execute(message)                          │         │
│              ▼                                                 │         │
│  ┌──────────────────────────┐                                 │         │
│  │   agent-v2 Agent         │                                 │         │
│  │   - execute()            │                                 │         │
│  │   - streamCallback()     │                                 │         │
│  └───────────┬──────────────┘                                 │         │
│              │                                                 │         │
│              │ AgentMessage (stream)                           │         │
│              ▼                                                 │         │
│  ┌──────────────────────────┐                                 │         │
│  │   StreamAdapter          │                                 │         │
│  │   - handleAgentMessage() │                                 │         │
│  │   - emit(uiEvent)        │                                 │         │
│  └───────────┬──────────────┘                                 │         │
│              │                                                 │         │
│              │ UIEvent                                         │         │
│              ▼                                                 │         │
│  ┌──────────────────────────┐                                 │         │
│  │   useChatStore           │                                 │         │
│  │   - applyEvent(event)    │                                 │         │
│  └───────────┬──────────────┘                                 │         │
│              │                                                 │         │
│              │ update state                                    │         │
│              ▼                                                 │         │
│  ┌──────────────────────────┐                                 │         │
│  │   React Components       │                                 │         │
│  │   - render messages      │                                 │         │
│  │   - render tool calls    │                                 │         │
│  │   - render code patches  │                                 │         │
│  └──────────────────────────┘                                 │         │
│                                                                │         │
│  ┌──────────────────────────┐                                 │         │
│  │   MemoryManager          │                                 │         │
│  │   - session persistence  │◄────────────────────────────────┘         │
│  └──────────────────────────┘                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 消息转换流程

```
Agent 消息 (Agent-v2)                    UI 事件 (cli-tui)
─────────────────────                    ─────────────────

text-start           ──────────────►    text-start
                                              │
                                              ▼
text-delta           ──────────────►    text-delta (buffered, throttled)
                                              │
                                              ▼
text-complete        ──────────────►    text-complete
                                              │
                                              ▼
tool_call_created    ──────────────►    tool-start
                                              │
                                              ▼
tool_call_stream     ──────────────►    tool-stream
                                              │
                                              ▼
tool_call_result     ──────────────►    tool-complete / tool-error
                                              │
                                              ▼
code_patch           ──────────────►    code-patch
                                              │
                                              ▼
status               ──────────────►    status
(terminal state)     ──────────────►    session-complete
                                              │
                                              ▼
error                ──────────────►    error
```

---

## 核心机制详解

### 1. 流式文本处理机制

**问题**: Agent 流式输出文本增量，但直接派发每个增量会导致 UI 渲染过于频繁。

**解决方案**: 使用缓冲区 + 节流策略

```typescript
// 1. 累积到缓冲区
this.state.buffer += content;

// 2. 节流调度
private scheduleFlush(messageId: string): void {
  if (this.flushTimer) return;  // 已存在定时器则忽略
  this.flushTimer = setTimeout(() => {
    this.flushTimer = null;
    this.flushPartial(messageId);  // 批量发送
  }, this.flushIntervalMs);  // 默认 33ms
}
```

**效果**:
- 减少 UI 更新频率
- 每秒约 30 帧的更新速度
- 保证流畅的视觉体验

### 2. 消息状态管理

**问题**: 同一个对话中可能有多个连续的消息，需要正确区分和处理。

**解决方案**: 使用 messageId 追踪当前消息

```typescript
// 处理新消息前，先完成前一个消息
if (this.state.messageId && this.state.messageId !== msgId) {
  this.flushAndCompleteCurrent();
}
```

### 3. 工具调用追踪

**问题**: 需要追踪工具调用的完整生命周期（创建 -> 流式输出 -> 结果）。

**解决方案**: 使用 Map 存储工具调用状态

```typescript
private state: StreamingState = {
  // ...
  toolCalls: new Map<string, ToolInvocation>(),
  // ...
};

// 创建时
this.state.toolCalls.set(toolCall.callId, invocation);

// 结果时
this.state.toolCalls.delete(callId);
```

### 4. 会话持久化

**问题**: 用户切换会话时需要加载历史上下文。

**解决方案**: 结合 MemoryManager 和 Agent 配置

```typescript
// 创建 Agent 时注入会话信息
if (currentSessionId && memoryManagerRef.current) {
  agentConfig.sessionId = currentSessionId;
  agentConfig.memoryManager = memoryManagerRef.current;
}
```

### 5. 错误恢复

**问题**: Agent 执行可能出错，需要优雅处理。

**解决方案**: 错误捕获与状态恢复

```typescript
agent
  .execute(message)
  .then(() => {
    setLoading(false);
  })
  .catch(error => {
    setLoading(false);
    applyEventRef.current?.({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      phase: 'agent.execute',
    });
  });
```

---

## 总结与架构图

### 模块职责总结

| 组件 | 职责 |
|------|------|
| `StreamAdapter` | 流式消息转换器，将 Agent 消息转换为 UI 事件 |
| `useAgentRunner` | React Hook，管理 Agent 生命周期和会话 |

### 架构分层

```
┌─────────────────────────────────────────────────────────────────────┐
│                         架构分层                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  UI Layer (React Components)                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  - ChatDisplay    - ToolPanel    - CodeViewer               │   │
│  │  - StatusBar      - InputArea    - SessionList              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                │                                     │
│                                ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  useAgentRunner (Hook)                                       │   │
│  │  - 状态管理                                                   │   │
│  │  - 会话管理                                                   │   │
│  │  - 执行控制                                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                │                                     │
│                                ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  StreamAdapter (Message Adapter)                             │   │
│  │  - 消息解析                                                   │   │
│  │  - 事件派发                                                   │   │
│  │  - 缓冲控制                                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                │                                     │
│                                ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  agent-v2 (Core Agent)                                       │   │
│  │  - Agent 引擎                                                │   │
│  │  - 工具调用                                                   │   │
│  │  - 流式输出                                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键设计决策

| 决策 | 原因 | 影响 |
|------|------|------|
| 使用 Ref 存储 Agent 实例 | 避免闭包问题，保持跨渲染状态 | 可以在回调中访问最新的 agent |
| StreamAdapter 独立类 | 分离关注点，可测试性 | 消息处理逻辑清晰独立 |
| 缓冲区 + 节流 | 优化 UI 渲染性能 | 减少不必要的重渲染 |
| MemoryManager 注入 | 支持会话持久化 | 用户体验更好 |
| 事件驱动架构 | 松耦合 | 易于扩展和维护 |

### 扩展点

1. **自定义消息处理器**: 继承 StreamAdapter 添加新的消息类型处理
2. **自定义存储后端**: 实现不同的 MemoryManager（文件/数据库/远程）
3. **自定义 Provider**: 实现新的模型提供者
4. **自定义 Tool**: 添加新的工具类型到 agent-v2

---

## 附录

### A. 相关文件路径

| 文件 | 路径 |
|------|------|
| StreamAdapter | `agent/stream-adapter.ts` |
| useAgentRunner | `agent/use-agent-runner.tsx` |
| 类型定义 | `types/index.ts` |
| Chat Store | `state/chat-store.ts` |
| Agent 核心 | `agent-v2/agent/agent.ts` |
| Stream Types | `agent-v2/agent/stream-types.ts` |

### B. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CODING_AGENT_SESSIONS_PATH` | `.coding-agent/sessions` | 会话存储路径 |

### C. 依赖版本

- React: 18+
- TypeScript: 5.x
- Bun: 1.x

---

> 文档结束
