# 企业级 Agent 服务端 - 无状态Agent设计

> 版本: 1.0.0
> 最后更新: 2026-03-04
> 作者: Claude

---

## 1. 概述

### 1.1 设计背景

现有的 `agent-v2` 实现采用了**有状态设计**，Agent 实例管理所有运行时状态，包括：

- 对话上下文（Session）
- 执行状态（AgentState）
- 消息队列
- 工具注册表

这种设计适合**单机/CLI 场景**，但在**企业级服务端部署**时面临挑战：

| 问题 | 有状态设计 | 无状态设计 |
|------|------------|------------|
| **水平扩展** | 困难，需要粘性会话 | 简单，任意实例处理 |
| **故障恢复** | 状态丢失 | 状态外部化，快速恢复 |
| **资源利用** | 状态常驻内存 | 按需加载，高效利用 |
| **部署复杂度** | 需要状态共享 | 简单，无状态部署 |
| **成本** | 高资源配置 | 按需弹性伸缩 |

### 1.2 设计目标

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        无状态 Agent 设计目标                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 状态外部化                                                              │
│     ├── 上下文存储在外部 (Redis/数据库)                                     │
│     ├── 执行状态通过请求传递                                                │
│     └── 工具注册表可共享                                                   │
│                                                                             │
│  2. 请求级别生命周期                                                        │
│     ├── 每个请求独立完整执行                                                │
│     ├── 状态不跨请求保留                                                    │
│     └── 请求结束时释放所有资源                                              │
│                                                                             │
│  3. 可水平扩展                                                              │
│     ├── 无状态实例可随意增减                                                │
│     ├── 负载均衡无感知                                                      │
│     └── 适合容器化/云原生                                                   │
│                                                                             │
│  4. 保留核心能力                                                            │
│     ├── ReAct 循环                                                          │
│     ├── 工具执行                                                            │
│     ├── 流式响应                                                            │
│     └── 错误处理/重试                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 现有实现分析

### 2.1 agent-v2 架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      agent-v2 有状态架构                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                           Agent (有状态)
    ┌─────────────────────────────────────────────────────────────┐
    │                                                              │
    │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
    │  │  AgentState  │    │  LLMCaller   │    │ToolExecutor │   │
    │  │  (执行状态)  │    │  (LLM调用)   │    │  (工具执行) │   │
    │  └──────────────┘    └──────────────┘    └──────────────┘   │
    │                                                              │
    │  ┌──────────────┐    ┌──────────────┐                       │
    │  │   Session    │    │ ToolRegistry │                       │
    │  │  (消息管理)  │    │  (工具注册)  │                       │
    │  └──────────────┘    └──────────────┘                       │
    │                                                              │
    │  ┌──────────────┐    ┌──────────────┐                       │
    │  │   EventBus   │    │   Logger     │                       │
    │  │  (事件总线)  │    │   (日志)     │                       │
    │  └──────────────┘    └──────────────┘                       │
    │                                                              │
    └─────────────────────────────────────────────────────────────┘
                              │
                              │ 依赖
                              ▼
                    ┌──────────────────┐
                    │  MemoryManager   │
                    │  (外部存储)      │
                    └──────────────────┘
```

### 2.2 核心组件分析

| 组件 | 职责 | 外部化可行性 |
|------|------|--------------|
| **AgentState** | 执行状态管理 | ✅ 可合并到请求上下文 |
| **LLMCaller** | LLM 调用封装 | ✅ 无状态，可复用 |
| **ToolExecutor** | 工具执行 | ✅ 无状态，可复用 |
| **ToolRegistry** | 工具注册表 | ✅ 可作为共享单例 |
| **Session** | 消息管理 | ✅ 完全外部化到 Redis |
| **EventBus** | 事件发布订阅 | ✅ 可用外部 EventBus |
| **Logger** | 日志记录 | ✅ 可用外部 Logger |

### 2.3 现有实现的优秀特性（需保留）

```typescript
// 1. 流式处理 (StreamProcessor)
//    - 完善的 reasoning_content 处理
//    - 缓冲区管理
//    - 错误恢复机制

// 2. 工具执行 (ToolExecutor)
//    - 工具注册表
//    - 权限引擎
//    - 文件快照

// 3. 错误处理
//    - 错误分类 (可重试 vs 永久)
//    - 指数退避
//    - 工具循环检测

// 4. ReAct 循环
//    - 完成条件检测
//    - 工具调用配对
//    - 上下文压缩

// 5. 响应验证
//    - 模型幻觉检测
//    - 响应格式验证
```

---

## 3. 无状态 Agent 架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      无状态 Agent 架构                                      │
└─────────────────────────────────────────────────────────────────────────────┘

    请求入口                    无状态 Worker                    外部依赖
    ─────────                  ─────────────                   ─────────

┌─────────────┐          ┌──────────────────┐          ┌──────────────────┐
│   API       │─────────▶│  StatelessAgent  │─────────▶│     Redis       │
│   Gateway   │          │  Handler         │          │  (Context)      │
└─────────────┘          └────────┬─────────┘          └────────┬─────────┘
                                   │                              │
                                   │  ┌──────────────────┐        │
                                   │  │                  │        │
                                   ▼  ▼                  │        ▼
                          ┌──────────────────┐    ┌───────────────┐
                          │  StatelessAgent   │    │ PostgreSQL    │
                          │  (请求级别)       │    │ (持久化)      │
                          └────────┬─────────┘    └───────────────┘
                                   │
                                   │  ┌──────────────────┐
                                   │  │                  │
                                   ▼  ▼                  │
                          ┌──────────────────┐    ┌───────────────┐
                          │   ToolExecutor   │    │   LLM API    │
                          │  (无状态复用)    │───▶│  (Provider)  │
                          └──────────────────┘    └───────────────┘
```

### 3.2 核心设计：状态外部化

```typescript
/**
 * 无状态 Agent 核心设计
 * 
 * 关键变化：
 * 1. 所有状态通过请求参数传入
 * 2. 上下文存储在外部 (Redis)
 * 3. 执行状态在请求结束时释放
 */

// 请求上下文 (代替原来的 Session + AgentState)
interface AgentRequestContext {
  // 必需
  sessionId: string;           // 会话ID (Redis key)
  messages: Message[];         // 当前消息列表
  systemPrompt: string;         // 系统提示词
  
  // 可选覆盖
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  
  // 执行状态 (用于断点续传)
  executionState?: ExecutionState;
}

// 执行状态 (可序列化，用于支持中断恢复)
interface ExecutionState {
  loopCount: number;
  retryCount: number;
  lastToolCallId?: string;
  pendingToolCalls?: ToolCall[];
}
```

### 3.3 无状态 Worker 设计

```typescript
/**
 * 无状态 Agent Handler
 * 
 * 每个请求创建一个 Handler 实例
 * 请求结束后实例被销毁
 */
class StatelessAgentHandler {
  private readonly llmCaller: LLMCaller;
  private readonly toolExecutor: ToolExecutor;
  private readonly toolRegistry: ToolRegistry;
  private readonly contextStore: ContextStore;
  private readonly logger: Logger;
  
  /**
   * 执行单个请求
   * 
   * 完整流程：
   * 1. 从 Redis 加载上下文
   * 2. 构建请求消息
   * 3. 执行 ReAct 循环
   * 4. 保存上下文到 Redis
   * 5. 返回结果
   */
  async execute(request: AgentRequest): Promise<AgentResponse> {
    // 1. 加载上下文
    const context = await this.contextStore.load(request.sessionId);
    
    // 2. 合并执行状态
    const executionState = this.mergeExecutionState(
      context.executionState,
      request.executionState
    );
    
    // 3. 构建消息列表
    const messages = this.buildMessages(
      context.messages,
      request.userMessage,
      executionState
    );
    
    // 4. 执行 ReAct 循环
    const result = await this.runReActLoop({
      systemPrompt: context.systemPrompt,
      messages,
      executionState,
      tools: context.tools,
      config: request.config,
    });
    
    // 5. 更新上下文
    await this.contextStore.save(request.sessionId, {
      messages: result.messages,
      executionState: result.executionState,
    });
    
    // 6. 返回响应
    return this.buildResponse(result);
  }
  
  /**
   * ReAct 循环
   */
  private async runReActLoop(params: {
    systemPrompt: string;
    messages: Message[];
    executionState: ExecutionState;
    tools: Tool[];
    config: AgentConfig;
  }): Promise<ReActResult> {
    let { messages, executionState } = params;
    const maxLoops = params.config.maxLoops ?? 100;
    
    while (executionState.loopCount < maxLoops) {
      // 1. 检查是否完成
      if (this.isComplete(messages)) {
        break;
      }
      
      // 2. LLM 调用
      const llmResponse = await this.llmCaller.execute({
        messages,
        tools: params.tools,
        model: params.config.model,
        temperature: params.config.temperature,
      });
      
      // 3. 添加 assistant 消息
      messages = [...messages, llmResponse.message];
      
      // 4. 检查工具调用
      if (llmResponse.toolCalls.length > 0) {
        // 5. 执行工具
        const toolResults = await this.toolExecutor.execute(
          llmResponse.toolCalls,
          llmResponse.message.messageId
        );
        
        // 6. 添加 tool 结果消息
        messages = [...messages, ...toolResults];
        
        // 7. 更新执行状态
        executionState = {
          ...executionState,
          loopCount: executionState.loopCount + 1,
          lastToolCallId: llmResponse.toolCalls[0]?.id,
        };
      } else {
        // 无工具调用，完成
        break;
      }
    }
    
    return {
      messages,
      executionState,
      finalMessage: messages[messages.length - 1],
    };
  }
}
```

---

## 4. 核心模块设计

### 4.1 Context Store (上下文存储)

```typescript
/**
 * 上下文存储接口
 * 
 * 负责从外部存储加载/保存 Agent 上下文
 */
interface IContextStore {
  /**
   * 加载会话上下文
   */
  load(sessionId: string): Promise<SessionContext>;
  
  /**
   * 保存会话上下文
   */
  save(sessionId: string, context: Partial<SessionContext>): Promise<void>;
  
  /**
   * 删除会话上下文
   */
  delete(sessionId: string): Promise<void>;
  
  /**
   * 原子更新 (乐观锁)
   */
  update(
    sessionId: string, 
    updates: Partial<SessionContext>,
    expectedVersion: number
  ): Promise<boolean>;
}

/**
 * SessionContext (会话上下文)
 */
interface SessionContext {
  // 基本信息
  sessionId: string;
  version: number;            // 乐观锁版本
  
  // 消息
  messages: Message[];
  systemPrompt: string;
  
  // 配置
  config: SessionConfig;
  
  // 执行状态
  executionState?: ExecutionState;
  
  // 元数据
  metadata: {
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
  };
}

/**
 * Redis Context Store 实现
 */
class RedisContextStore implements IContextStore {
  private redis: Redis;
  private readonly PREFIX = 'agent:context:';
  private readonly VERSION_PREFIX = 'agent:version:';
  
  async load(sessionId: string): Promise<SessionContext> {
    const key = `${this.PREFIX}${sessionId}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      throw new ContextNotFoundError(sessionId);
    }
    
    return JSON.parse(data);
  }
  
  async save(sessionId: string, context: Partial<SessionContext>): Promise<void> {
    const key = `${this.PREFIX}${sessionId}`;
    
    // 乐观锁更新
    await this.redis.watch(key, async () => {
      const current = await this.redis.get(key);
      const currentContext = current ? JSON.parse(current) : { version: 0 };
      
      const updated = {
        ...currentContext,
        ...context,
        version: currentContext.version + 1,
        metadata: {
          ...currentContext.metadata,
          updatedAt: Date.now(),
        },
      };
      
      await this.redis.set(key, JSON.stringify(updated));
    });
  }
  
  async update(
    sessionId: string,
    updates: Partial<SessionContext>,
    expectedVersion: number
  ): Promise<boolean> {
    const key = `${this.PREFIX}${sessionId}`;
    const versionKey = `${this.VERSION_PREFIX}${sessionId}`;
    
    // 使用 Lua 脚本实现原子更新
    const script = `
      local current = redis.call('GET', KEYS[1])
      if not current then return 0 end
      
      local ctx = cjson.decode(current)
      if ctx.version ~= tonumber(ARGV[1]) then return -1 end
      
      ctx.version = ctx.version + 1
      local updates = cjson.decode(ARGV[2])
      for k, v in pairs(updates) do
        ctx[k] = v
      end
      ctx.updatedAt = tonumber(ARGV[3])
      
      redis.call('SET', KEYS[1], cjson.encode(ctx))
      return 1
    `;
    
    const result = await this.redis.eval(script, {
      keys: [key],
      arguments: [
        expectedVersion.toString(),
        JSON.stringify(updates),
        Date.now().toString(),
      ],
    });
    
    return result === 1;
  }
}
```

### 4.2 Stateless LLM Caller (无状态 LLM 调用器)

```typescript
/**
 * 无状态 LLM 调用器
 * 
 * 核心变化：
 * 1. 不保存任何状态
 * 2. 所有配置通过参数传入
 * 3. 可复用实例
 */
class StatelessLLMCaller {
  private readonly provider: LLMProvider;
  private readonly streamProcessorFactory: StreamProcessorFactory;
  
  /**
   * 执行 LLM 调用
   */
  async execute(
    messages: Message[],
    options: LLMCallOptions
  ): Promise<LLMResponse> {
    const {
      tools,
      model,
      temperature,
      maxTokens,
      stream = false,
      abortSignal,
      onChunk,
      onUsage,
    } = options;
    
    // 构建请求
    const request: LLMGenerateOptions = {
      model,
      temperature,
      max_tokens: maxTokens,
      tools,
      stream,
      abortSignal,
    };
    
    if (stream) {
      return this.executeStream(messages, request, { onChunk, onUsage });
    } else {
      return this.provider.generate(messages, request);
    }
  }
  
  /**
   * 流式执行
   */
  private async executeStream(
    messages: Message[],
    options: LLMGenerateOptions,
    callbacks: StreamCallbacks
  ): Promise<LLMResponse> {
    // 创建新的 StreamProcessor (无状态，每次请求创建)
    const processor = this.streamProcessorFactory.create({
      maxBufferSize: 100000,
      ...callbacks,
    });
    
    const stream = await this.provider.generate(messages, {
      ...options,
      stream: true,
    });
    
    for await (const chunk of stream) {
      processor.processChunk(chunk);
    }
    
    return processor.buildResponse();
  }
}
```

### 4.3 Stateless Tool Executor (无状态工具执行器)

```typescript
/**
 * 无状态工具执行器
 * 
 * 核心变化：
 * 1. 工具注册表外部注入
 * 2. 不保存任何会话相关状态
 * 3. 权限检查可配置
 */
class StatelessToolExecutor {
  private readonly toolRegistry: ToolRegistry;
  private readonly permissionEngine?: PermissionEngine;
  private readonly logger: Logger;
  
  /**
   * 执行工具调用
   */
  async execute(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult[]> {
    const { sessionId, workspace, permissionCheck = true } = context;
    
    // 权限检查
    if (permissionCheck && this.permissionEngine) {
      await this.checkPermissions(toolCalls, sessionId);
    }
    
    // 执行工具
    const results = await this.toolRegistry.execute(toolCalls, {
      sessionId,
      workspace: workspace || process.cwd(),
    });
    
    return results;
  }
  
  /**
   * 批量执行工具
   */
  async executeAll(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolBatchResult> {
    const results: ToolExecutionResult[] = [];
    
    for (const toolCall of toolCalls) {
      try {
        const result = await this.execute([toolCall], context);
        results.push(...result);
      } catch (error) {
        results.push({
          tool_call_id: toolCall.id,
          result: {
            success: false,
            error: error.message,
          },
        });
      }
    }
    
    return {
      results,
      success: results.every(r => r.result?.success !== false),
    };
  }
}
```

### 4.4 ReAct Loop Engine (无状态循环引擎)

```typescript
/**
 * ReAct 循环引擎
 * 
 * 核心设计：
 * 1. 无状态，每次请求创建
 * 2. 状态通过参数传递
 * 3. 支持断点续传
 */
class ReActLoopEngine {
  private readonly llmCaller: StatelessLLMCaller;
  private readonly toolExecutor: StatelessToolExecutor;
  private readonly completionChecker: CompletionChecker;
  private readonly errorHandler: ErrorHandler;
  
  /**
   * 执行 ReAct 循环
   */
  async *execute(
    initialState: LoopState
  ): AsyncGenerator<LoopEvent, LoopResult, unknown> {
    let state = initialState;
    
    while (state.loopCount < state.config.maxLoops) {
      // 1. 检查是否完成
      if (this.completionChecker.isComplete(state.messages)) {
        yield {
          type: 'complete',
          finalMessage: state.messages[state.messages.length - 1],
        };
        break;
      }
      
      // 2. 发送 LLM 请求
      yield { type: 'thinking' };
      
      try {
        const llmResponse = await this.llmCaller.execute(state.messages, {
          tools: state.tools,
          model: state.config.model,
          temperature: state.config.temperature,
        });
        
        // 3. 添加助手消息
        state = this.addMessage(state, llmResponse.message);
        yield { type: 'message', message: llmResponse.message };
        
        // 4. 检查工具调用
        if (llmResponse.toolCalls.length > 0) {
          yield { type: 'tool_calls', calls: llmResponse.toolCalls };
          
          // 5. 执行工具
          const toolResults = await this.toolExecutor.executeAll(
            llmResponse.toolCalls,
            state.context
          );
          
          // 6. 添加工具结果消息
          for (const result of toolResults.results) {
            const toolMessage = this.buildToolMessage(result);
            state = this.addMessage(state, toolMessage);
            yield { type: 'tool_result', result };
          }
          
          // 7. 更新循环计数
          state = {
            ...state,
            loopCount: state.loopCount + 1,
          };
        } else {
          // 无工具调用，完成
          break;
        }
        
      } catch (error) {
        // 7. 错误处理
        const handled = await this.errorHandler.handle(error, state);
        
        if (handled.retry) {
          yield { type: 'retry', reason: error.message };
          state = {
            ...state,
            retryCount: state.retryCount + 1,
          };
          continue;
        }
        
        if (handled.abort) {
          yield { type: 'error', error };
          throw error;
        }
      }
    }
    
    // 返回最终结果
    return {
      messages: state.messages,
      loopCount: state.loopCount,
      finalMessage: state.messages[state.messages.length - 1],
    };
  }
  
  /**
   * 添加消息
   */
  private addMessage(state: LoopState, message: Message): LoopState {
    return {
      ...state,
      messages: [...state.messages, message],
    };
  }
}

/**
 * 循环状态
 */
interface LoopState {
  messages: Message[];
  tools: Tool[];
  config: AgentConfig;
  context: ToolExecutionContext;
  loopCount: number;
  retryCount: number;
}

/**
 * 循环事件
 */
type LoopEvent = 
  | { type: 'thinking' }
  | { type: 'message'; message: Message }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'tool_result'; result: ToolExecutionResult }
  | { type: 'retry'; reason: string }
  | { type: 'complete'; finalMessage: Message }
  | { type: 'error'; error: Error };

/**
 * 循环结果
 */
interface LoopResult {
  messages: Message[];
  loopCount: number;
  finalMessage: Message;
}
```

---

## 5. API 设计

### 5.1 请求/响应格式

```typescript
// Agent 请求
interface AgentRequest {
  // 必需
  sessionId: string;                    // 会话ID
  message: MessageContent;               // 用户消息
  
  // 可选覆盖
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  
  // 流式
  stream?: boolean;
  
  // 执行状态 (断点续传)
  executionState?: {
    loopCount: number;
    retryCount: number;
    lastToolCallId?: string;
  };
  
  // 配置覆盖
  config?: {
    maxLoops?: number;
    timeout?: number;
    enableCompaction?: boolean;
  };
}

// Agent 响应 (非流式)
interface AgentResponse {
  success: boolean;
  sessionId: string;
  
  // 结果
  message?: Message;
  usage?: Usage;
  
  // 执行信息
  executionState: {
    loopCount: number;
    retryCount: number;
    finished: boolean;
  };
  
  // 错误信息
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

// Agent 响应 (流式)
type AgentStreamEvent = 
  | { event: 'thinking' }
  | { event: 'message_start'; messageId: string }
  | { event: 'content_delta'; delta: string; messageId: string }
  | { event: 'message_end'; messageId: string; finishReason: string }
  | { event: 'tool_call_start'; id: string; name: string }
  | { event: 'tool_call_delta'; id: string; arguments: string }
  | { event: 'tool_call_end'; id: string }
  | { event: 'tool_result'; id: string; result: string }
  | { event: 'error'; error: string }
  | { event: 'done'; finalMessage: Message };
```

### 5.2 REST API 定义

```typescript
// 1. 发送消息 (非流式)
POST /v1/sessions/:sessionId/messages
Body: { message: "...", model?: "gpt-4" }

// 2. 发送消息 (流式)
GET /v1/sessions/:sessionId/messages/stream?message=...

// 3. 创建新会话
POST /v1/sessions
Body: { systemPrompt: "...", model?: "gpt-4" }

// 4. 获取会话状态
GET /v1/sessions/:sessionId

// 5. 中断执行
POST /v1/sessions/:sessionId/abort

// 6. 删除会话
DELETE /v1/sessions/:sessionId
```

---

## 6. 部署架构

### 6.1 Kubernetes 部署

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stateless-agent
spec:
  replicas: 10                    # 可水平扩展
  selector:
    matchLabels:
      app: stateless-agent
  template:
    metadata:
      labels:
        app: stateless-agent
    spec:
      containers:
        - name: agent
          image: stateless-agent:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
          env:
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: agent-secrets
                  key: redis-url
            - name: LLM_PROVIDER_URL
              valueFrom:
                secretKeyRef:
                  name: agent-secrets
                  key: llm-provider-url

---
# HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: stateless-agent-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: stateless-agent
  minReplicas: 5
  maxReplicas: 50
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### 6.2 负载均衡

```
                          ┌─────────────────┐
                          │  Load Balancer  │
                          │   (Nginx/ALB)   │
                          └────────┬────────┘
                                   │
         ┌─────────────┬─────────┼─────────┬─────────────┐
         │             │         │         │             │
         ▼             ▼         ▼         ▼             ▼
    ┌─────────┐  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ Worker 1│  │Worker 2│ │Worker 3│ │Worker 4│ │Worker N│
    │(无状态) │  │(无状态) │ │(无状态) │ │(无状态) │ │(无状态) │
    └────┬────┘  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
         │             │         │         │             │
         └─────────────┴─────────┼─────────┴─────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │      Redis      │
                        │   (共享状态)     │
                        └─────────────────┘
```

---

## 7. 性能优化

### 7.1 上下文缓存

```typescript
/**
 * 上下文缓存
 * 
 * 策略：
 * 1. 热数据缓存到 Redis
 * 2. 使用 LRU 淘汰
 * 3. 定期刷新到数据库
 */
class ContextCache {
  private redis: Redis;
  private localCache = new LRUCache<string, SessionContext>(100);
  
  async get(sessionId: string): Promise<SessionContext | null> {
    // 1. 先查本地缓存
    const local = this.localCache.get(sessionId);
    if (local) {
      return local;
    }
    
    // 2. 再查 Redis
    const key = `cache:context:${sessionId}`;
    const cached = await this.redis.get(key);
    if (cached) {
      const context = JSON.parse(cached);
      // 3. 回填本地缓存
      this.localCache.set(sessionId, context);
      return context;
    }
    
    return null;
  }
  
  async set(sessionId: string, context: SessionContext): Promise<void> {
    const key = `cache:context:${sessionId}`;
    
    // 1. 写入 Redis
    await this.redis.setex(key, 300, JSON.stringify(context)); // 5分钟 TTL
    
    // 2. 回填本地缓存
    this.localCache.set(sessionId, context);
  }
  
  async invalidate(sessionId: string): Promise<void> {
    this.localCache.delete(sessionId);
    await this.redis.del(`cache:context:${sessionId}`);
  }
}
```

### 7.2 连接池复用

```typescript
/**
 * 连接池管理
 * 
 * 关键点：
 * 1. LLM Provider 连接池
 * 2. Redis 连接池
 * 3. 工具执行器复用
 */
class ConnectionPoolManager {
  private llmProviderPool: Pool<LLMProvider>;
  private redisPool: Pool<Redis>;
  
  /**
   * 复用 LLM Provider
   * 
   * 由于 LLM Provider 通常是 HTTP 连接
   * 保持少量实例复用连接
   */
  getLLMProvider(model: string): LLMProvider {
    return this.llmProviderPool.acquire(model);
  }
  
  /**
   * 复用 Tool Executor
   * 
   * 工具执行器无状态，可以完全复用
   */
  private toolExecutors = new Map<string, StatelessToolExecutor>();
  
  getToolExecutor(workspace: string): StatelessToolExecutor {
    if (!this.toolExecutors.has(workspace)) {
      const registry = this.getOrCreateRegistry(workspace);
      this.toolExecutors.set(
        workspace, 
        new StatelessToolExecutor(registry, this.permissionEngine)
      );
    }
    return this.toolExecutors.get(workspace)!;
  }
}
```

---

## 8. 错误处理与重试

### 8.1 错误分类

```typescript
/**
 * 无状态 Agent 错误分类
 */
interface AgentError {
  code: string;
  message: string;
  retryable: boolean;
  recoverable: boolean;
  statusCode: number;
}

// 错误分类
const ErrorTypes = {
  // LLM 相关
  LLM_TIMEOUT: { retryable: true, statusCode: 504 },
  LLM_RATE_LIMIT: { retryable: true, statusCode: 429 },
  LLM_INVALID: { retryable: false, statusCode: 400 },
  
  // 工具执行
  TOOL_NOT_FOUND: { retryable: false, statusCode: 404 },
  TOOL_TIMEOUT: { retryable: true, statusCode: 504 },
  TOOL_PERMISSION_DENIED: { retryable: false, statusCode: 403 },
  
  // 上下文
  CONTEXT_NOT_FOUND: { retryable: false, statusCode: 404 },
  CONTEXT_VERSION_CONFLICT: { retryable: true, statusCode: 409 },
  CONTEXT_EXPIRED: { retryable: false, statusCode: 410 },
  
  // 系统
  INTERNAL_ERROR: { retryable: true, statusCode: 500 },
} as const;
```

### 8.2 重试策略

```typescript
/**
 * 重试策略
 * 
 * 无状态重试关键：
 * 1. 使用 executionState 传递重试次数
 * 2. 指数退避
 * 3. 最多重试 N 次
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelay: number;
    executionState: ExecutionState;
  }
): Promise<{ result: T; executionState: ExecutionState }> {
  let lastError: Error;
  
  for (let i = options.executionState.retryCount; i < options.maxRetries; i++) {
    try {
      const result = await fn();
      return {
        result,
        executionState: {
          ...options.executionState,
          retryCount: i,
        },
      };
    } catch (error) {
      lastError = error;
      
      if (!isRetryable(error)) {
        throw error;
      }
      
      // 指数退避
      const delay = options.baseDelay * Math.pow(2, i);
      await sleep(delay);
    }
    
    throw new MaxRetriesExceededError(lastError!);
  }
}
```

---

## 9. 监控指标

### 9.1 关键指标

| 指标 | 类型 | 描述 |
|------|------|------|
| `agent.requests.total` | Counter | 总请求数 |
| `agent.requests.success` | Counter | 成功请求数 |
| `agent.requests.failed` | Counter | 失败请求数 |
| `agent.loop.duration` | Histogram | 循环耗时 |
| `agent.llm.calls` | Counter | LLM 调用次数 |
| `agent.tool.executions` | Counter | 工具执行次数 |
| `agent.context.load.duration` | Histogram | 上下文加载耗时 |
| `agent.context.save.duration` | Histogram | 上下文保存耗时 |

### 9.2 健康检查

```typescript
/**
 * 健康检查端点
 */
app.get('/health', async (req, res) => {
  const checks = await Promise.all([
    redis.ping(),
    llmProvider.healthCheck(),
  ]);
  
  const healthy = checks.every(c => c.ok);
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    checks: {
      redis: checks[0].ok ? 'ok' : 'error',
      llm: checks[1].ok ? 'ok' : 'error',
    },
  });
});
```

> **说明**：以上监控指标与架构设计文档中定义的指标体系保持一致，详细可参考 [01-架构设计.md](./01-架构设计.md#_8-监控与可观测性)。

---

## 10. 与现有 agent-v2 的对比

### 10.1 设计差异

| 方面 | agent-v2 (有状态) | Stateless Agent (无状态) |
|------|-------------------|--------------------------|
| **状态管理** | 内存中 | 外部存储 (Redis) |
| **实例生命周期** | 长驻 | 请求级别 |
| **扩展性** | 困难 | 简单 |
| **故障恢复** | 状态丢失 | 状态恢复 |
| **资源利用** | 常驻内存 | 按需分配 |
| **适合场景** | CLI/Desktop | Server/API |

### 10.2 代码复用

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           代码复用策略                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  可直接复用:                                                                 │
│  ├── StreamProcessor (流式处理)                                              │
│  ├── CompletionChecker (完成检测)                                            │
│  ├── ErrorClassifier (错误分类)                                             │
│  ├── ToolRegistry (工具注册表)                                              │
│  ├── ToolExecutor (工具执行逻辑)                                            │
│  ├── PermissionEngine (权限引擎)                                            │
│  └── prompts/ (提示词模板)                                                  │
│                                                                             │
│  需要适配:                                                                   │
│  ├── LLMCaller → StatelessLLMCaller                                        │
│  ├── Session → ContextStore (Redis)                                        │
│  ├── AgentState → ExecutionState (请求参数)                                 │
│  └── EventBus → 外部事件服务                                                │
│                                                                             │
│  新增:                                                                       │
│  ├── StatelessAgentHandler                                                   │
│  ├── ReActLoopEngine                                                        │
│  └── ContextCache                                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. 压缩触发与上下文溢出处理

### 11.1 压缩触发时机

在无状态架构下，压缩需要在**服务端**和**请求级别**进行：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    无状态 Agent 压缩触发时机                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  触发点 1: API 请求入口 (强制检查)                                      │
│  ────────────────────────────────────────────────────────                 │
│  POST /v1/sessions/:id/messages                                        │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────────────────────────────────────┐                           │
│  │ 1. 加载上下文 (ContextStore.load)         │                           │
│  │ 2. 计算当前 Token 使用量                  │                           │
│  │ 3. 检查是否需要压缩                     │                           │
│  │ 4. 如果需要，先执行压缩               │                           │
│  │ 5. 再执行 ReAct 循环                  │                           │
│  └─────────────────────────────────────────────┘                           │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  触发点 2: 主动触发 (可选)                                           │
│  ────────────────────────────────────────────────────────                 │
│  POST /v1/sessions/:id/compact  ← 手动触发压缩                            │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  触发点 3: 定时任务 (后台清理)                                       │
│  ────────────────────────────────────────────────────────                 │
│  - 定期扫描过期会话                                                   │
│  - 清理长期未压缩的会话                                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 压缩触发条件

```typescript
/**
 * 压缩触发条件
 */

interface CompactionConfig {
  // 触发压缩的 Token 使用比例 (默认 90%)
  triggerRatio: number;
  
  // 最大上下文 Token 数
  maxTokens: number;
  
  // 保留最近消息数
  keepMessagesNum: number;
  
  // 最小压缩间隔 (防止频繁压缩)
  minIntervalMs: number;
}

// 默认配置
const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  triggerRatio: 0.9,       // 超过 90% 时压缩
  maxTokens: 200000,        // 最大 200K tokens
  keepMessagesNum: 40,      // 保留最近 40 条
  minIntervalMs: 60000,    // 最小间隔 60 秒
};

/**
 * 判断是否需要压缩
 */
function shouldCompact(
  messages: Message[],
  config: CompactionConfig,
  lastCompactedAt?: number
): boolean {
  // 1. 检查最小间隔
  if (lastCompactedAt) {
    const elapsed = Date.now() - lastCompactedAt;
    if (elapsed < config.minIntervalMs) {
      return false;  // 刚压缩过，跳过
    }
  }
  
  // 2. 计算 Token 使用量
  const estimated = estimateTokens(messages);
  const threshold = config.maxTokens * config.triggerRatio;
  
  // 3. 检查 Token 阈值
  if (estimated < threshold) {
    return false;  // 未达到阈值
  }
  
  // 4. 检查消息数量
  const nonSystemCount = messages.filter(m => m.role !== 'system').length;
  if (nonSystemCount <= config.keepMessagesNum) {
    return false;  // 消息太少，不需要压缩
  }
  
  return true;
}
```

### 11.2 上下文溢出处理

当 Token 超过模型限制时，需要特殊处理：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        两种不同的处理                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  场景 A: Token 超过阈值 (90%)                                          │
│  ────────────────────────────────                                        │
│  • 处理方式: 压缩 (Compaction)                                         │
│  • 调用 LLM 生成摘要                                                 │
│  • 保留: system + 摘要 + 最近 N 条消息                               │
│  • 这是**可恢复**的                                                  │
│                                                                          │
│  场景 B: Token 超过模型限制 (100%)                                     │
│  ─────────────────────────────────                                      │
│  • 处理方式: 多种策略 (见下文)                                         │
│  • 这是**紧急情况**，无法继续执行                                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 溢出处理策略

```typescript
/**
 * 上下文溢出处理策略
 */
enum OverflowStrategy {
  /**
   * 策略 1: 强制压缩
   * 保留更少的消息，强制生成摘要
   */
  FORCE_COMPACT = 'force_compact',
  
  /**
   * 策略 2: 截断
   * 直接截断最老的消息
   */
  TRUNCATE = 'truncate',
  
  /**
   * 策略 3: 回退模型
   * 切换到支持更长上下文的模型
   */
  FALLBACK_MODEL = 'fallback_model',
  
  /**
   * 策略 4: 拒绝请求
   * 返回错误，让用户处理
   */
  REJECT = 'reject',
}

/**
 * 上下文溢出错误
 */
class ContextOverflowError extends Error {
  constructor(
    message: string,
    public readonly strategy: OverflowStrategy,
    public readonly estimatedTokens: number,
    public readonly modelLimit: number
  ) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}
```

#### 完整的溢出处理流程

```typescript
/**
 * 无状态 Agent Handler - 包含溢出处理
 */
class StatelessAgentHandler {
  
  /**
   * 处理消息请求
   */
  async handleMessage(request: AgentRequest): Promise<AgentResponse> {
    // 步骤 1: 加载上下文
    const context = await this.contextStore.load(request.sessionId);
    
    // 步骤 2: 检查上下文溢出 (关键！)
    const overflowCheck = this.checkOverflow(context.messages, request.model);
    
    if (overflowCheck.overflowed) {
      // 上下文已经溢出，需要特殊处理
      return await this.handleOverflow(request, context, overflowCheck);
    }
    
    // 步骤 3: 检查是否需要压缩
    const compactionResult = await this.compactionService.checkAndCompact(
      context.messages,
      context.config
    );
    
    let messages = compactionResult.compacted 
      ? compactionResult.messages 
      : context.messages;
    
    // 步骤 4: 添加用户消息
    messages = [...messages, {
      messageId: uuid(),
      role: 'user',
      content: request.message,
      createdAt: new Date(),
    }];
    
    // 步骤 5: 执行 ReAct 循环
    const result = await this.reActLoop.execute({
      messages,
      config: request.config,
      onError: (error) => this.handleLLMError(error, context, request),
    });
    
    // 步骤 6: 保存上下文
    await this.contextStore.save(request.sessionId, {
      messages: result.messages,
    });
    
    return {
      success: true,
      message: result.finalMessage,
    };
  }
  
  /**
   * 检查上下文是否溢出
   */
  private checkOverflow(
    messages: Message[],
    model: string
  ): OverflowCheckResult {
    const modelConfig = MODEL_CONFIGS[model];
    const estimated = this.estimateTokens(messages);
    const limit = modelConfig.contextWindow;
    
    return {
      overflowed: estimated > limit,
      estimated,
      limit,
      overflowRatio: estimated / limit,
    };
  }
  
  /**
   * 处理上下文溢出
   */
  private async handleOverflow(
    request: AgentRequest,
    context: SessionContext,
    overflowCheck: OverflowCheckResult
  ): Promise<AgentResponse> {
    // 按优先级尝试处理策略
    for (const strategy of this.config.overflowStrategies) {
      try {
        switch (strategy) {
          case OverflowStrategy.FORCE_COMPACT:
            // 强制压缩，保留更少消息
            const result = await this.compactionService.forceCompact(
              context.messages,
              { keepLastN: 10 }
            );
            
            if (result.success) {
              // 重试请求
              return this.handleMessage({
                ...request,
                _internal: { preprocessedMessages: result.messages }
              });
            }
            break;
            
          case OverflowStrategy.TRUNCATE:
            // 截断消息
            const truncated = this.truncateMessages(context.messages, 20);
            return this.handleMessage({
              ...request,
              _internal: { preprocessedMessages: truncated }
            });
            
          case OverflowStrategy.FALLBACK_MODEL:
            // 切换到更长上下文的模型
            const fallbackModel = this.findFallbackModel(request.model!);
            if (fallbackModel) {
              return this.handleMessage({
                ...request,
                model: fallbackModel
              });
            }
            break;
            
          case OverflowStrategy.REJECT:
            // 直接拒绝
            return {
              success: false,
              error: {
                code: 'CONTEXT_OVERFLOW',
                message: `Context too large for model ${request.model}. ` +
                  `Estimated ${overflowCheck.estimated} tokens exceeds limit ${overflowCheck.limit}.`,
                retryable: false,
              }
            };
        }
      } catch (e) {
        // 当前策略失败，尝试下一个
        continue;
      }
    }
    
    // 所有策略都失败
    return {
      success: false,
      error: {
        code: 'CONTEXT_OVERFLOW_FAILED',
        message: 'All overflow strategies failed',
        retryable: false,
      }
    };
  }
  
  /**
   * 在 ReAct 循环中处理 LLM 错误
   */
  private async handleLLMError(
    error: Error,
    context: SessionContext,
    request: AgentRequest
  ): Promise<ErrorAction> {
    // 检查是否是上下文溢出错误
    if (this.isContextOverflowError(error)) {
      return await this.handleOverflow(request, context, {
        overflowed: true,
        estimated: error.estimatedTokens,
        limit: error.modelLimit,
      } as OverflowCheckResult);
    }
    
    // 其他错误按默认处理
    return { action: 'throw', error };
  }
}
```

#### 溢出处理流程图

```
LLM 调用返回错误
        │
        ▼
┌──────────────────────┐
│ 是上下文溢出错误吗？  │
└──────────┬───────────┘
            │
     ┌────┴────┐
     │         │
    是        否
     │         │
     ▼         ▼
┌─────────────────┐   ┌─────────────┐
│ 触发溢出处理策略  │   │ 正常错误处理 │
└────────┬────────┘   └─────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     策略尝试顺序                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. FORCE_COMPACT (强制压缩)                                        │
│     └── 保留更少消息，强制生成摘要                                   │
│         │                                                            │
│         ├── 成功 → 重试 LLM 调用                                     │
│         │                                                            │
│         └── 失败 → 尝试下一个策略                                    │
│                                                                      │
│  2. TRUNCATE (截断)                                               │
│     └── 直接丢弃最老的消息                                          │
│         │                                                            │
│         ├── 成功 → 重试 LLM 调用                                     │
│         │                                                            │
│         └── 失败 → 尝试下一个策略                                    │
│                                                                      │
│  3. FALLBACK_MODEL (回退模型)                                      │
│     └── 切换到支持更长上下文的模型                                  │
│         │                                                            │
│         ├── 成功 → 使用新模型重试                                    │
│         │                                                            │
│         └── 失败 → 尝试下一个策略                                    │
│                                                                      │
│  4. REJECT (拒绝)                                                 │
│     └── 返回错误给客户端                                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### 模型回退选择

```typescript
/**
 * 找到支持更长上下文的备用模型
 */
function findFallbackModel(currentModel: string): string | null {
  const fallbackMap: Record<string, string> = {
    // 短上下文 → 长上下文
    'gpt-4': 'gpt-4-32k',
    'gpt-3.5-turbo': 'gpt-4',
    'claude-opus-4.6': null,   // 已是最长
    'kimi-k2.5': 'glm-5',    // Kimi → GLM
    'deepseek-chat': 'glm-5', // DeepSeek → GLM
    'qwen3.5-plus': 'glm-5', // Qwen → GLM
  };
  
  return fallbackMap[currentModel] || null;
}
```

### 11.3 总结：压缩 vs 溢出处理

| 阶段 | 处理方式 | 触发条件 |
|------|----------|----------|
| **压缩** | 调用 LLM 生成摘要 | Token 超过阈值 (90%) |
| **溢出处理** | 多策略尝试 | Token 超过模型限制 (100%) |

**关键点**：
1. 压缩是**预防**溢出，溢出处理是**紧急救援**
2. 压缩在**每次 LLM 调用前**检查
3. 多个溢出处理策略按优先级尝试，直到成功或全部失败
4. 最终兜底是返回错误，让用户处理

> **与架构设计的一致性**：本设计严格遵循 [01-架构设计.md](./01-架构设计.md) 中定义的无状态设计原则，与架构设计中的模块划分、技术选型和部署模式保持一致。核心模块（Context Store、LLM Caller、Tool Executor、ReAct Loop Engine）与架构设计中的 Agent Core 层对应。

---

## 12. 总结

### 12.1 无状态 Agent 优势

| 优势 | 说明 |
|------|------|
| **水平扩展** | 可随意增减实例，适应流量变化 |
| **故障恢复** | 状态外部化，实例故障不影响服务 |
| **资源效率** | 按需分配，请求结束释放资源 |
| **部署简单** | 无状态部署，无需共享存储 |
| **成本优化** | 弹性伸缩，按需付费 |

### 12.2 实现建议

1. **分阶段实现**：
   - Phase 1: 实现 ContextStore (Redis)
   - Phase 2: 改造 LLMCaller 为无状态
   - Phase 3: 实现 StatelessAgentHandler
   - Phase 4: 添加流式支持
   - Phase 5: 完善监控和错误处理

2. **测试策略**：
   - 单元测试: 各个无状态组件
   - 集成测试: ReAct 循环
   - 压力测试: 并发请求
   - 故障测试: 实例崩溃恢复

3. **迁移路径**：
   - 保持 agent-v2 CLI 兼容
   - 新功能在无状态版本实现
   - 逐步迁移到无状态架构

---

*本文档定义了企业级无状态 Agent 服务端的设计方案。核心思想是将所有状态外部化，使 Agent 实例成为真正的"无状态 Worker"，适合大规模部署和水平扩展。*
