# 企业级 LLM Provider 设计

> 版本: 1.1.0
> 最后更新: 2026-03-04
> 作者: Claude

---

## 1. 概述

### 1.1 设计背景

现有的 `src/providers` 模块已经实现了完整的 LLM Provider 抽象层，支持多种模型接入。本设计文档将详细分析现有实现，并提供企业级优化方案。

**现有模块对应关系**：

| 现有实现 | 文件路径 | 描述 |
|----------|----------|------|
| `LLMProvider` | `src/providers/types/provider.ts` | 抽象基类 |
| `OpenAICompatibleProvider` | `src/providers/openai-compatible.ts` | 通用实现 |
| `BaseAPIAdapter` | `src/providers/adapters/base.ts` | 适配器基类 |
| `StandardAdapter` | `src/providers/adapters/standard.ts` | 标准适配器 |
| `AnthropicAdapter` | `src/providers/adapters/anthropic.ts` | Anthropic 适配器 |
| `KimiAdapter` | `src/providers/adapters/kimi.ts` | Kimi 适配器 |
| `HTTPClient` | `src/providers/http/client.ts` | HTTP 请求封装 |
| `StreamParser` | `src/providers/http/stream-parser.ts` | 流式解析 |
| `ProviderRegistry` | `src/providers/registry/provider-factory.ts` | 工厂创建 |
| `MODEL_CONFIGS` | `src/providers/registry/model-config.ts` | 模型配置 |

### 1.2 现有能力

| 能力 | 实现 |
|------|------|
| **多模型支持** | Anthropic, OpenAI, GLM, Kimi, MiniMax, DeepSeek, Qwen |
| **统一接口** | LLMProvider 抽象类 |
| **适配器模式** | BaseAPIAdapter + 具体适配器 |
| **错误处理** | 可重试 vs 永久错误分类 |
| **流式处理** | StreamParser + Chunk 标准化 |
| **工具调用** | Function Calling 统一格式 |
| **多模态** | Text, Image, Audio, Video, File |

---

## 2. 现有架构分析

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Provider 架构                                      │
└─────────────────────────────────────────────────────────────────────────────┘

                           Agent / Caller
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     OpenAICompatibleProvider                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────────────────────┐     │
│  │  Config        │    │              Adapter (适配器)               │     │
│  │  - baseURL    │    │  ┌────────────┐ ┌────────┐ ┌─────────┐ │     │
│  │  - apiKey     │───▶│  │ Standard  │ │ Anthropic│ │  Kimi  │ │     │
│  │  - model      │    │  │ Adapter   │ │ Adapter │ │ Adapter │     │
│  │  - timeout    │    │  └────────────┘ └────────┘ └─────────┘ │     │
│  └─────────────────┘    └─────────────────────────────────────────────┘     │
│                                    │                                       │
│                                    ▼                                       │
│                        ┌─────────────────────────────────────┐              │
│                        │           HTTPClient              │              │
│                        │  - Fetch API                     │              │
│                        │  - Timeout / Retry               │              │
│                        │  - Error Handling               │              │
│                        └─────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    External LLM Services                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   OpenAI    │   Anthropic   │   GLM   │   Kimi   │   DeepSeek   │   Qwen  │
│   API       │     API        │   API   │   API   │     API      │   API   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

| 组件 | 职责 | 文件路径 (src/providers/) |
|------|------|--------------------------|
| **LLMProvider** | 抽象基类 | `types/provider.ts` |
| **OpenAICompatibleProvider** | 通用实现 | `openai-compatible.ts` |
| **BaseAPIAdapter** | 适配器基类 | `adapters/base.ts` |
| **StandardAdapter** | OpenAI 标准适配器 | `adapters/standard.ts` |
| **AnthropicAdapter** | Anthropic 专用适配器 | `adapters/anthropic.ts` |
| **KimiAdapter** | Kimi 专用适配器 | `adapters/kimi.ts` |
| **HTTPClient** | HTTP 请求封装 | `http/client.ts` |
| **StreamParser** | 流式解析 | `http/stream-parser.ts` |
| **ProviderRegistry** | 工厂创建 + 注册 | `registry/provider-factory.ts` |
| **MODEL_CONFIGS** | 模型配置 | `registry/model-config.ts` |
| **错误类型** | 错误分类定义 | `types/errors.ts` |

### 2.3 数据模型 (来自 types/api.ts)

```typescript
// 核心类型定义

// 消息内容 (多模态)
type MessageContent = string | InputContentPart[];

interface InputContentPart {
  type: 'text' | 'image_url' | 'input_audio' | 'input_video' | 'file';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
  input_audio?: { data: string; format: 'wav' | 'mp3' };
  input_video?: { url?: string; file_id?: string; format?: 'mp4' | 'mov' | 'webm' };
  file?: { file_id?: string; filename?: string };
}

// 工具调用
interface ToolCall {
  id: string;
  type: string;
  index: number;
  function: {
    name: string;
    arguments: string;
  };
}

// Token 使用量
interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

// LLM 响应
interface LLMResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: LLMResponseMessage;
    finish_reason: FinishReason;
  }>;
  usage?: Usage;
}

// 流式响应块
interface Chunk {
  id?: string;
  index: number;
  choices?: Array<{
    index: number;
    delta: LLMResponseMessage;
    finish_reason?: FinishReason;
  }>;
  usage?: Usage;
  error?: StreamChunkError;
}
```

---

## 3. 企业级增强设计

### 3.1 连接池管理

```typescript
/**
 * 连接池管理器
 * 
 * 企业级特性：
 * 1. HTTP 连接池复用
 * 2. DNS 缓存
 * 3. Keep-Alive
 * 4. 请求排队与优先级
 */
class ConnectionPoolManager {
  private pools = new Map<string, ConnectionPool>();
  private readonly defaultOptions: PoolOptions;
  
  constructor(options: PoolOptions) {
    this.defaultOptions = options;
  }
  
  /**
   * 获取连接池
   */
  getPool(baseURL: string): ConnectionPool {
    if (!this.pools.has(baseURL)) {
      this.pools.set(baseURL, new ConnectionPool({
        ...this.defaultOptions,
        baseURL,
      }));
    }
    return this.pools.get(baseURL)!;
  }
  
  /**
   * 关闭所有连接池
   */
  async closeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.pools.values()).map(pool => pool.close())
    );
    this.pools.clear();
  }
}

/**
 * 连接池配置
 */
interface PoolOptions {
  maxConnections: number;        // 最大连接数
  maxIdleTime: number;          // 最大空闲时间 (ms)
  connectionTimeout: number;     // 连接超时 (ms)
  requestTimeout: number;       // 请求超时 (ms)
  retryAttempts: number;        // 重试次数
  retryDelay: number;          // 重试延迟 (ms)
}
```

### 3.2 智能路由

```typescript
/**
 * 模型路由器
 * 
 * 根据请求特征自动选择最优模型
 */
class ModelRouter {
  private rules: RoutingRule[] = [];
  private fallbackModel: string;
  
  /**
   * 添加路由规则
   */
  addRule(rule: RoutingRule): this {
    this.rules.push(rule);
    return this;
  }
  
  /**
   * 选择模型
   */
  selectModel(context: RoutingContext): string {
    // 按优先级匹配规则
    for (const rule of this.rules) {
      if (rule.matcher(context)) {
        return rule.targetModel;
      }
    }
    
    return this.fallbackModel;
  }
}

/**
 * 路由规则
 */
interface RoutingRule {
  name: string;
  matcher: (context: RoutingContext) => boolean;
  targetModel: string;
  weight?: number;  // 权重，用于负载均衡
}

/**
 * 路由上下文
 */
interface RoutingContext {
  // 请求特征
  messages: Message[];
  estimatedTokens: number;
  requiresVision: boolean;
  requiresReasoning: boolean;
  requiresCoding: boolean;
  
  // 运行时特征
  latency?: number;
  errorRate?: number;
  cost?: number;
  
  // 用户偏好
  userId?: string;
  tenantId?: string;
}

// 预定义路由规则
const DefaultRoutingRules: RoutingRule[] = [
  // 视觉任务
  {
    name: 'vision-tasks',
    matcher: ctx => ctx.requiresVision,
    targetModel: 'claude-opus-4.6',
  },
  
  // 代码任务
  {
    name: 'coding-tasks',
    matcher: ctx => ctx.requiresCoding,
    targetModel: 'kimi-k2.5',
  },
  
  // 长上下文
  {
    name: 'long-context',
    matcher: ctx => ctx.estimatedTokens > 100000,
    targetModel: 'glm-5',
  },
  
  // 推理任务
  {
    name: 'reasoning-tasks',
    matcher: ctx => ctx.requiresReasoning,
    targetModel: 'deepseek-chat',
  },
  
  // 默认低成本
  {
    name: 'low-cost',
    matcher: () => true,
    targetModel: 'qwen3.5-plus',
  },
];
```

### 3.3 请求队列与优先级

```typescript
/**
 * 请求队列
 * 
 * 特性：
 * 1. 优先级队列
 * 2. 流量控制
 * 3. 公平调度
 */
class RequestQueue {
  private queues = new Map<Priority, AsyncQueue<QueuedRequest>>();
  private running = 0;
  private readonly maxConcurrent: number;
  
  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
    
    // 初始化优先级队列
    for (const priority of [Priority.CRITICAL, Priority.HIGH, Priority.NORMAL, Priority.LOW]) {
      this.queues.set(priority, new AsyncQueue());
    }
  }
  
  /**
   * 入队
   */
  async enqueue(request: QueuedRequest): Promise<LLMResponse> {
    const queue = this.queues.get(request.priority)!;
    
    return new Promise((resolve, reject) => {
      queue.enqueue({
        ...request,
        resolve,
        reject,
      });
      
      this.processNext();
    });
  }
  
  /**
   * 处理下一个请求
   */
  private async processNext(): Promise<void> {
    if (this.running >= this.maxConcurrent) {
      return;  // 达到并发上限
    }
    
    // 按优先级从高到低选择
    for (const [priority, queue] of this.queues) {
      if (queue.isEmpty()) continue;
      
      const request = queue.dequeue();
      if (!request) continue;
      
      this.running++;
      
      try {
        const response = await request.execute();
        request.resolve(response);
      } catch (error) {
        request.reject(error);
      } finally {
        this.running--;
        this.processNext();  // 继续处理
      }
      
      return;  // 每次只处理一个
    }
  }
}

/**
 * 优先级
 */
enum Priority {
  CRITICAL = 0,  // 关键业务
  HIGH = 1,       // 高优先级
  NORMAL = 2,    // 普通
  LOW = 3,        // 低优先级
}
```

### 3.4 缓存策略

```typescript
/**
 * 响应缓存
 * 
 * 特性：
 * 1. LRU 淘汰
 * 2. 哈希键
 * 3. TTL 过期
 * 4. 语义缓存 (可选)
 */
class ResponseCache {
  private cache = new LRUCache<string, CacheEntry>(1000);
  private readonly ttl: number;
  
  constructor(ttl: number = 3600000) {  // 默认 1 小时
    this.ttl = ttl;
  }
  
  /**
   * 生成缓存键
   */
  generateKey(messages: Message[], options: GenerateOptions): string {
    const content = JSON.stringify({
      messages: messages.map(m => ({
        role: m.role,
        content: this.truncateContent(m.content),
      })),
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
    });
    
    return hash(content);
  }
  
  /**
   * 获取缓存
   */
  get(key: string): LLMResponse | null {
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.response;
  }
  
  /**
   * 设置缓存
   */
  set(key: string, response: LLMResponse): void {
    this.cache.set(key, {
      response,
      timestamp: Date.now(),
    });
  }
  
  /**
   * 语义缓存 (可选)
   * 
   * 使用嵌入向量相似度匹配
   */
  async getSemantic(key: string, similarity: number = 0.95): Promise<LLMResponse | null> {
    const embedding = await this.embed(key);
    
    for (const [cachedKey, entry] of this.cache.entries()) {
      const cachedEmbedding = await this.embed(cachedKey);
      const sim = cosineSimilarity(embedding, cachedEmbedding);
      
      if (sim >= similarity) {
        return entry.response;
      }
    }
    
    return null;
  }
}
```

### 3.5 熔断器

```typescript
/**
 * 熔断器
 * 
 * 防止级联故障
 */
class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  
  constructor(
    private readonly options: CircuitBreakerOptions
  ) {}
  
  /**
   * 执行请求
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
      } else {
        throw new CircuitOpenError('Circuit is open');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  /**
   * 成功回调
   */
  private onSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.successCount = 0;
    }
  }
  
  /**
   * 失败回调
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
    }
  }
  
  /**
   * 是否应该尝试重置
   */
  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime > this.options.resetTimeout;
  }
}

/**
 * 熔断器状态
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * 熔断器配置
 */
interface CircuitBreakerOptions {
  failureThreshold: number;    // 失败次数阈值
  successThreshold: number;     // 成功次数阈值
  resetTimeout: number;        // 重置超时 (ms)
}
```

---

## 4. 多模型支持

### 4.1 支持的模型

| 模型 | Provider | 特性 | 适用场景 |
|------|----------|------|----------|
| **Claude Opus 4.6** | Anthropic | 视觉、推理 | 复杂推理、视觉理解 |
| **GLM-5** | 智谱 | 长上下文 | 长文本处理 |
| **Kimi K2.5** | 月之暗面 | 编程、推理 | 代码生成 |
| **MiniMax-2.5** | MiniMax | 多模态 | 对话、创作 |
| **DeepSeek Chat** | DeepSeek | 低成本 | 日常对话 |
| **Qwen 3.5 Plus** | 阿里 | 编程 | 代码辅助 |
| **GPT-4** | OpenAI | 通用 | 全能 |

### 4.2 模型配置

```typescript
/**
 * 模型配置
 */
interface ModelConfig {
  // 基础信息
  id: string;
  provider: string;
  name: string;
  
  // API 配置
  baseURL: string;
  endpointPath: string;
  apiKeyEnv: string;
  
  // 能力参数
  maxTokens: number;           // 最大输出
  contextWindow: number;        // 上下文窗口
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  
  // 性能特征
  latency: 'fast' | 'medium' | 'slow';
  throughput: 'low' | 'medium' | 'high';
  cost: 'low' | 'medium' | 'high';
  
  // 默认参数
  defaultTemperature: number;
  defaultMaxTokens: number;
}

/**
 * 模型能力矩阵
 */
const MODEL_CAPABILITIES: Record<string, ModelConfig> = {
  'claude-opus-4.6': {
    id: 'claude-opus-4.6',
    provider: 'anthropic',
    name: 'Claude Opus 4.6',
    baseURL: 'https://api.anthropic.com',
    endpointPath: '/v1/messages',
    maxTokens: 16384,
    contextWindow: 1000000,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true,
    latency: 'slow',
    throughput: 'medium',
    cost: 'high',
    defaultTemperature: 0.1,
    defaultMaxTokens: 4096,
  },
  
  'kimi-k2.5': {
    id: 'kimi-k2.5',
    provider: 'kimi',
    name: 'Kimi K2.5',
    baseURL: 'https://api.kimi.com/coding/v1',
    endpointPath: '/chat/completions',
    maxTokens: 10000,
    contextWindow: 200000,
    supportsVision: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsReasoning: true,
    latency: 'fast',
    throughput: 'high',
    cost: 'medium',
    defaultTemperature: 0.6,
    defaultMaxTokens: 8192,
  },
  
  // ... 更多模型配置
};
```

---

## 5. 错误处理

### 5.1 错误分类

```typescript
/**
 * 错误分类体系
 */
class ErrorClassifier {
  /**
   * 分类错误
   */
  static classify(error: Error): ErrorCategory {
    if (error instanceof LLMRetryableError) {
      return {
        type: 'retryable',
        action: 'retry',
        backoff: this.calculateBackoff(error),
      };
    }
    
    if (error instanceof LLMPermanentError) {
      return {
        type: 'permanent',
        action: 'abort',
        shouldNotify: true,
      };
    }
    
    if (error instanceof LLMAbortedError) {
      return {
        type: 'aborted',
        action: 'abort',
      };
    }
    
    return {
      type: 'unknown',
      action: 'retry',
      backoff: 1000,
    };
  }
  
  /**
   * 计算退避时间
   */
  private static calculateBackoff(error: LLMRetryableError): number {
    // 速率限制使用服务器指定的 retry-after
    if (error instanceof LLMRateLimitError && error.retryAfter) {
      return Math.min(error.retryAfter * 1000, 60000);
    }
    
    // 指数退避 + jitter
    return Math.min(1000 * Math.pow(2, retryCount) * (0.5 + Math.random()), 60000);
  }
}

/**
 * 错误类别
 */
interface ErrorCategory {
  type: 'retryable' | 'permanent' | 'aborted' | 'unknown';
  action: 'retry' | 'abort';
  backoff?: number;
  shouldNotify?: boolean;
}
```

### 5.2 重试策略

```typescript
/**
 * 重试策略
 */
class RetryPolicy {
  constructor(
    private readonly config: RetryConfig
  ) {}
  
  /**
   * 执行带重试
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (!this.shouldRetry(error, attempt)) {
          throw error;
        }
        
        const delay = this.calculateDelay(attempt, error);
        await sleep(delay);
      }
    }
    
    throw lastError!;
  }
  
  /**
   * 判断是否应该重试
   */
  private shouldRetry(error: Error, attempt: number): boolean {
    if (attempt >= this.config.maxRetries) {
      return false;
    }
    
    if (error instanceof LLMPermanentError) {
      return false;
    }
    
    if (error instanceof LLMAbortedError) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 计算延迟
   */
  private calculateDelay(attempt: number, error: Error): number {
    const baseDelay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt);
    const jitter = Math.random() * this.config.jitter * baseDelay;
    
    return Math.min(baseDelay + jitter, this.config.maxDelay);
  }
}

/**
 * 重试配置
 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
  jitter: number;
}
```

---

## 6. 性能优化

### 6.1 指标收集

```typescript
/**
 * Provider 指标收集器
 */
class ProviderMetrics {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  
  /**
   * 记录请求
   */
  recordRequest(model: string, success: boolean, duration: number): void {
    // 请求计数
    this.increment(`requests.${model}.total`);
    this.increment(`requests.${model}.${success ? 'success' : 'failure'}`);
    
    // 延迟直方图
    this.push(`latency.${model}`, duration);
  }
  
  /**
   * 记录 Token 使用
   */
  recordUsage(model: string, usage: Usage): void {
    this.increment(`tokens.${model}.prompt`, usage.prompt_tokens);
    this.increment(`tokens.${model}.completion`, usage.completion_tokens);
    this.increment(`tokens.${model}.total`, usage.total_tokens);
  }
  
  /**
   * 获取指标快照
   */
  getSnapshot(): MetricsSnapshot {
    const histograms: Record<string, MetricStats> = {};
    
    for (const [key, values] of this.histograms) {
      const sorted = [...values].sort((a, b) => a - b);
      histograms[key] = {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        p50: this.percentile(sorted, 0.5),
        p95: this.percentile(sorted, 0.95),
        p99: this.percentile(sorted, 0.99),
      };
    }
    
    return {
      counters: Object.fromEntries(this.counters),
      histograms,
    };
  }
}
```

### 6.2 Prometheus 指标

```typescript
/**
 * Prometheus 指标定义
 */
const ProviderMetrics = {
  // 请求计数
  requestsTotal: new Counter({
    name: 'llm_requests_total',
    help: 'Total number of LLM requests',
    labelNames: ['model', 'status'],
  }),
  
  // 请求延迟
  requestDuration: new Histogram({
    name: 'llm_request_duration_seconds',
    help: 'LLM request duration in seconds',
    labelNames: ['model'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  }),
  
  // Token 使用
  tokensUsed: new Counter({
    name: 'llm_tokens_used_total',
    help: 'Total number of tokens used',
    labelNames: ['model', 'type'],
  }),
  
  // 错误计数
  errorsTotal: new Counter({
    name: 'llm_errors_total',
    help: 'Total number of LLM errors',
    labelNames: ['model', 'error_type'],
  }),
  
  // 活跃连接
  activeConnections: new Gauge({
    name: 'llm_active_connections',
    help: 'Number of active connections',
    labelNames: ['model'],
  }),
  
  // 队列长度
  queueLength: new Gauge({
    name: 'llm_queue_length',
    help: 'Number of pending requests',
    labelNames: ['model', 'priority'],
  }),
  
  // 缓存命中
  cacheHits: new Counter({
    name: 'llm_cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['model'],
  }),
  
  // 熔断器状态
  circuitBreakerState: new Gauge({
    name: 'llm_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
    labelNames: ['model'],
  }),
};
```

---

## 7. 监控与告警

### 7.1 关键指标

| 指标 | 描述 | 告警阈值 |
|------|------|----------|
| **请求延迟 P99** | 99% 请求延迟 | > 30s |
| **错误率** | 失败请求比例 | > 5% |
| **速率限制** | 429 错误比例 | > 10% |
| **Token 消耗** | 每分钟消耗 | 接近限额 |
| **队列长度** | 等待处理请求 | > 100 |
| **连接池** | 活跃连接数 | > 80% |

### 7.2 告警规则

```yaml
# alerts/provider.yml
groups:
  - name: llm-provider
    rules:
      # 高延迟告警
      - alert: HighLLMLatency
        expr: |
          histogram_quantile(0.99, 
            rate(llm_request_duration_seconds_bucket[5m])
          ) > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "LLM request P99 latency is high"
          
      # 高错误率告警
      - alert: HighLLMErrorRate
        expr: |
          sum(rate(llm_requests_total{status="failure"}[5m]))
          / sum(rate(llm_requests_total[5m])) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "LLM error rate is too high"
          
      # 速率限制告警
      - alert: HighRateLimitErrors
        expr: |
          rate(llm_errors_total{error_type="rate_limit"}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Too many rate limit errors"
```

---

## 8. 最佳实践

### 8.1 Provider 选择指南

```typescript
/**
 * Provider 选择决策树
 */

// 1. 需要视觉理解
if (requiresVision) {
  return 'claude-opus-4.6';
}

// 2. 需要代码能力
if (requiresCoding && contextLength < 200000) {
  return 'kimi-k2.5';  // 性价比高
}

// 3. 超长上下文
if (contextLength > 100000) {
  return 'glm-5';  // 长上下文
}

// 4. 低成本优先
if (budget === 'low') {
  return 'deepseek-chat';
}

// 5. 默认平衡
return 'qwen3.5-plus';
```

### 8.2 配置示例

```typescript
/**
 * 企业级 Provider 配置
 */
const providerConfig: ProviderConfig = {
  // 主 Provider
  primary: {
    model: 'kimi-k2.5',
    apiKey: process.env.KIMI_API_KEY,
    baseURL: 'https://api.kimi.com/coding/v1',
    timeout: 120000,
    maxRetries: 3,
  },
  
  // 备用 Provider
  fallback: [
    {
      model: 'qwen3.5-plus',
      condition: (error) => error instanceof LLMRateLimitError,
    },
    {
      model: 'deepseek-chat',
      condition: () => true,  // 最终兜底
    }
  ],
  
  // 路由规则
  routing: {
    rules: DefaultRoutingRules,
    fallbackModel: 'deepseek-chat',
  },
  
  // 缓存
  cache: {
    enabled: true,
    ttl: 3600000,
    maxSize: 1000,
  },
  
  // 熔断
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 60000,
  },
  
  // 监控
  metrics: {
    enabled: true,
    exportInterval: 10000,
  },
};
```

---

## 9. 总结

### 9.1 核心设计要点

| 特性 | 实现方式 |
|------|----------|
| **多模型支持** | Adapter 模式 + MODEL_DEFINITIONS 配置 |
| **统一接口** | LLMProvider 抽象类 |
| **错误处理** | 可重试 vs 永久错误分类 + 指数退避 |
| **流式处理** | StreamParser + Chunk 标准化 |
| **企业增强** | 连接池 + 智能路由 + 熔断器 + 缓存 |
| **可观测** | Prometheus 指标 + 告警规则 |

### 9.2 与现有代码的关系

```
现有 src/providers/                         企业级增强
─────────────────────                      ───────────

┌─────────────────────────────────┐         ┌─────────────────────────────┐
│  types/provider.ts              │  ──────▶│  LLMProvider (继承使用)    │
│  (抽象基类)                      │         └─────────────────────────────┘
└─────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────┐         ┌─────────────────────────────┐
│  openai-compatible.ts          │  ──────▶│  OpenAICompatibleProvider   │
│  (通用 Provider 实现)           │         │  (继承使用)                  │
└─────────────────────────────────┘         └─────────────────────────────┘
              │
       ┌──────┴──────┐
      ▼              ▼
┌───────────┐  ┌───────────┐
│ HTTPClient│  │ Adapters  │     ↳ 继承使用
│(http/)   │  │(adapters/)│         + 新增 RouterAdapter
└───────────┘  └───────────┘
      │              │
      ▼              ▼
┌─────────────────────────────────┐         ┌─────────────────────────────┐
│  registry/                      │  ──────▶│  ProviderRegistry          │
│  - provider-factory.ts          │         │  (扩展智能路由)             │
│  - model-config.ts              │         └─────────────────────────────┘
└─────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────┐         ┌─────────────────────────────┐
│  types/errors.ts                │  ──────▶│  错误分类 (继承使用)        │
│  (错误类型定义)                  │         │  + CircuitBreaker 新增    │
└─────────────────────────────────┘         └─────────────────────────────┘

新增组件 (企业级增强)：
├── ConnectionPoolManager (连接池)      - HTTP 连接复用
├── ModelRouter (智能路由)              - 根据请求特征选择模型
├── RequestQueue (优先级队列)           - 请求调度与限流
├── ResponseCache (响应缓存)            - 响应结果缓存
├── CircuitBreaker (熔断器)             - 防止级联故障
└── ProviderMetrics (指标收集)          - Prometheus 指标导出
```

**模块对应关系总结**：

| 企业级特性 | 对应现有模块 | 增强方式 |
|------------|--------------|----------|
| 连接池 | `http/client.ts` | 添加连接复用 |
| 智能路由 | `registry/provider-factory.ts` | 添加 RouterAdapter |
| 优先级队列 | - | 新增 RequestQueue |
| 响应缓存 | - | 新增 ResponseCache |
| 熔断器 | `types/errors.ts` | 新增 CircuitBreaker |
| 指标收集 | - | 新增 ProviderMetrics |

---

*本文档 (v1.1.0) 定义了企业级 LLM Provider 的完整设计，基于现有的 `src/providers` 模块，增强了连接池管理、智能路由、请求队列、缓存、熔断器等企业级特性。*
