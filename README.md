# Coding Agent

> 一个生产级的 AI 编码助手框架，采用 **ReAct 范式** 和 **协调器模式** 设计，基于 TypeScript 构建的多模态 LLM Agent 系统

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Vitest-4.0+-purple.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)
[![Tests](https://img.shields.io/badge/tests-1200+-brightgreen.svg)]()

---

## 📖 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [快速开始](#快速开始)
- [安装](#安装)
- [架构设计](#架构设计)
- [核心组件](#核心组件)
- [ReAct 工作流程](#react-工作流程)
- [API 文档](#api-文档)
- [工具系统](#工具系统)
- [会话管理](#会话管理)
- [持久化存储](#持久化存储)
- [日志系统](#日志系统)
- [事件系统](#事件系统)
- [LLM Provider](#llm-provider)
- [CLI 使用](#cli-使用)
- [配置选项](#配置选项)
- [开发指南](#开发指南)
- [测试](#测试)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)

---

## 项目简介

Coding Agent 是一个生产级的 AI 编码助手框架，采用**协调器模式（Coordinator Pattern）**设计，将复杂的 Agent 逻辑分解为独立的可插拔组件。它支持多轮对话、工具调用、上下文压缩、持久化存储等核心功能，可作为构建智能编程助手、代码审查工具、自动化开发流程的基础框架。

### 核心设计理念

| 理念 | 说明 |
|------|------|
| **ReAct 范式** | Reasoning（思考）+ Acting（行动）交替执行，实现智能决策 |
| **协调器模式** | Agent 作为协调器，委托具体工作给专业组件 |
| **可插拔架构** | 工具、Provider、存储均可独立扩展 |
| **端口与适配器** | Memory 和 Provider 层采用六边形架构，支持多种后端 |
| **事件驱动** | 通过 EventBus 解耦组件间通信 |
| **类型安全** | TypeScript 严格模式，完整的类型定义 |
| **生产就绪** | 1200+ 单元测试，完善的错误处理、自动重试、资源管理 |

### 技术栈

- **TypeScript 5.3+** - 主要开发语言，严格模式
- **Node.js 20+** - 运行环境
- **Vitest 4.0+** - 单元测试框架（1200+ 测试用例）
- **Zod 4.0+** - 运行时类型验证
- **Pino** - 高性能日志系统
- **TailwindCSS** - CLI 界面样式

---

## 核心特性

### 🤖 Agent 核心

| 特性 | 描述 |
|------|------|
| **ReAct 引擎** | Reasoning + Acting 循环，智能决策与执行 |
| **多轮对话** | 完整的对话上下文管理，支持工具调用协议修复 |
| **工具调用** | 16+ 内置工具，支持自定义扩展，带超时和截断控制 |
| **流式输出** | 实时流式响应，支持 reasoning/content 分离处理 |
| **自动重试** | 智能错误分类，指数退避，自动重试可恢复错误 |
| **上下文压缩** | 8 章节结构化摘要，智能压缩长对话，节省 token 消耗 |
| **任务中止** | 支持 abort 中断，支持空闲超时控制 |
| **响应验证** | 实时检测模型幻觉、重复模式等异常 |
| **流式恢复** | 智能检测流式中断，自动恢复响应 |

### 🛠️ 工具系统

| 工具类别 | 工具名称 | 功能描述 |
|----------|----------|----------|
| **文件操作** | `read_file` | 读取文件内容，支持图片、PDF、Jupyter Notebook |
| | `write_file` | 写入文件，自动创建目录 |
| | `precise_replace` | 精确的文本替换编辑 |
| | `batch_replace` | 批量文本替换 |
| **搜索** | `grep` | 基于正则的代码搜索 |
| | `glob` | 文件模式匹配 |
| **执行** | `bash` | Shell 命令执行，支持超时和后台运行 |
| **Web** | `web_search` | 网络搜索（Tavily API） |
| | `web_fetch` | 网页内容抓取 |
| **代码智能** | `lsp` | 语言服务器协议支持（定义跳转、引用查找等） |
| **任务管理** | `task` | 子 Agent 任务委托 |
| | `task_create/get/list/update/output/stop` | 完整的任务生命周期管理 |

### 💾 存储系统

- **文件持久化**：JSON 文件存储，支持多会话
- **会话恢复**：支持通过 sessionId 恢复历史会话
- **上下文压缩记录**：保存压缩历史，支持回溯
- **多后端支持**：File / MongoDB / Hybrid

### 📝 日志系统

- **结构化日志**：JSON/Pretty 格式支持
- **多 Transport**：控制台 + 文件同时输出
- **中间件链**：可插拔日志处理中间件
- **敏感字段脱敏**：自动过滤 API Key 等敏感信息
- **异步写入**：非阻塞日志写入，高性能
- **上下文追踪**：自动注入 sessionId、toolName 等上下文

---

## 快速开始

### 最小示例

```typescript
import { Agent } from './src/agent-v2';
import { createKimiProvider } from './src/providers';

// 创建 Provider
const provider = createKimiProvider({
  apiKey: process.env.KIMI_API_KEY!,
  model: 'moonshot-v1-128k',
});

// 创建 Agent
const agent = new Agent({
  provider,
  systemPrompt: '你是一个有帮助的编程助手。',
  stream: true,
  streamCallback: (msg) => {
    console.log(msg);
  },
});

// 执行任务
const result = await agent.execute('帮我写一个 Hello World 程序');
console.log(result.content);
```

### 带工具的示例

```typescript
import { Agent, createDefaultToolRegistry, FileMemoryManager } from './src/agent-v2';
import { createKimiProvider } from './src/providers';

const provider = createKimiProvider({
  apiKey: process.env.KIMI_API_KEY!,
  model: 'moonshot-v1-128k',
});

// 创建工具注册表
const toolRegistry = createDefaultToolRegistry({
  workingDirectory: process.cwd(),
}, provider);

// 创建持久化存储
const memoryManager = new FileMemoryManager({
  baseDir: './data/sessions',
});

const agent = new Agent({
  provider,
  systemPrompt: '你是一个专业的编程助手，可以使用工具来帮助用户。',
  toolRegistry,
  memoryManager,
  stream: true,
  streamCallback: (msg) => {
    if (msg.type === 'text-delta') {
      process.stdout.write(msg.content);
    }
  },
});

// 执行带工具的任务
const result = await agent.execute(
  '请读取 package.json 文件并告诉我项目的依赖有哪些'
);
```

### 使用 ProviderRegistry（推荐）

```typescript
import { ProviderRegistry } from './src/providers';

// 从环境变量创建 Provider
const provider = ProviderRegistry.createFromEnv('glm-4.7');

const agent = new Agent({
  provider,
  systemPrompt: '你是一个有帮助的助手',
});

const result = await agent.execute('你好');
```

---

## 安装

### 环境要求

- Node.js >= 20.0.0
- pnpm（推荐）或 npm

### 安装依赖

```bash
# 使用 pnpm
pnpm install

# 或使用 npm
npm install
```

### 环境变量配置

创建 `.env.development` 文件：

```env
# GLM (智谱)
GLM_API_KEY=your_api_key

# Kimi (月之暗面)
KIMI_API_KEY=your_api_key

# MiniMax
MINIMAX_API_KEY=your_api_key
MINIMAX_GROUP_ID=your_group_id

# Tavily (Web 搜索)
TAVILY_API_KEY=your_api_key
```

---

## 架构设计

### 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    表现层 (Presentation)                         │
│              CLI (React TUI) / Web UI / API                      │
├─────────────────────────────────────────────────────────────────┤
│                    应用层 (Application)                          │
│              Agent 协调器 / Session 会话管理                      │
├─────────────────────────────────────────────────────────────────┤
│                    领域层 (Domain)                               │
│         Tool 工具系统 / Truncation 截断 / Compaction 压缩        │
├─────────────────────────────────────────────────────────────────┤
│                    基础设施层 (Infrastructure)                    │
│         Memory 存储 / Provider LLM 适配 / EventBus 事件          │
└─────────────────────────────────────────────────────────────────┘
```

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        表现层 (Presentation)                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   CLI (React)   │  │  React Hooks    │  │   自定义应用      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Agent 协调器 (Coordinator Pattern)              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  AgentState  │  │ AgentEmitter │  │  EventBus    │           │
│  │  (状态机)     │  │  (事件发射)   │  │  (发布订阅)    │            │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   LLMCaller     │  │  ToolExecutor   │  │     Session     │
│  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │
│  │  Stream   │  │  │  │  Registry │  │  │  │ Compaction│  │
│  │ Processor │  │  │  │  + 截断    │  │  │  │  压缩器   │  │
│  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │
│  ┌───────────┐  │  │                 │  │                 │
│  │ Response  │  │  │                 │  │                 │
│  │ Validator │  │  │                 │  │                 │
│  └───────────┘  │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    Provider     │  │     Tools       │  │ MemoryManager   │
│  ┌───────────┐  │  │  ┌───────────┐  │  │  (六边形架构)     │
│  │ Adapters  │  │  │  │  Bash     │  │  │  ┌───────────┐  │
│  │ Standard  │  │  │  │  File     │  │  │  │  File     │  │
│  │   Kimi    │  │  │  │  Grep     │  │  │  │  MongoDB  │  │
│  └───────────┘  │  │  │  Web      │  │  │  │  Hybrid   │  │
│  ┌───────────┐  │  │  │  LSP      │  │  │  └───────────┘  │
│  │ HTTP      │  │  │  │  Task     │  │  │                 │
│  │ Client    │  │  │  └───────────┘  │  │                 │
│  │ + Stream  │  │  │                 │  │                 │
│  │ Parser    │  │  │                 │  │                 │
│  └───────────┘  │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 核心组件职责

| 组件 | 职责 |
|------|------|
| **Agent** | 协调器，管理任务生命周期，协调各组件工作 |
| **LLMCaller** | 封装 LLM 调用逻辑，处理流式响应，响应验证 |
| **ToolExecutor** | 工具执行调度，超时控制，结果处理，截断中间件 |
| **Session** | 消息管理，上下文压缩，持久化触发，工具协议修复 |
| **AgentState** | Agent 状态机，循环/重试计数，abort 控制 |
| **EventBus** | 事件发布订阅，组件间解耦通信 |
| **MemoryManager** | 持久化存储抽象，会话数据管理，多后端支持 |
| **Logger** | 结构化日志，多 Transport，中间件链，敏感字段脱敏 |

### 设计模式

| 设计模式 | 应用位置 | 目的 |
|----------|----------|------|
| **协调器模式** | Agent | 组件组合与协调 |
| **状态机模式** | AgentState, StreamProcessor | 状态转换管理 |
| **策略模式** | Truncation Strategies | 可替换截断策略 |
| **工厂模式** | ProviderFactory, createMemoryManager | 对象创建封装 |
| **适配器模式** | Provider Adapters, Memory Adapters | 接口转换 |
| **模板方法** | BaseTool | 工具骨架定义 |
| **发布订阅** | EventBus | 事件解耦 |

---

## 核心组件

### Agent 协调器

Agent 是系统的核心协调器，负责：

1. **任务生命周期管理**：启动、执行、完成、失败
2. **组件协调**：协调 LLMCaller、ToolExecutor、Session 等组件
3. **错误处理**：错误分类、重试决策、失败处理
4. **事件发射**：通过 EventBus 和 Emitter 发布事件

```typescript
const agent = new Agent({
  provider,           // LLM Provider（必需）
  systemPrompt,       // 系统提示词
  toolRegistry,       // 工具注册表
  memoryManager,      // 持久化存储
  stream: true,       // 启用流式输出
  maxLoops: 100,      // 最大循环次数
  maxRetries: 5,      // 最大重试次数
});
```

### Session 会话管理

Session 管理对话上下文：

```typescript
const session = new Session({
  systemPrompt: '你是一个助手',
  memoryManager,      // 可选，启用持久化
  sessionId,          // 可选，恢复已有会话
  enableCompaction: true,
  compactionConfig: {
    maxTokens: 100000,
    compactionRatio: 0.3,
  },
});
```

**核心功能：**
- 消息增删改查
- 持久化到 MemoryManager
- 自动上下文压缩
- 工具调用协议修复

### ToolRegistry 工具注册表

管理工具的注册与执行：

```typescript
const registry = new ToolRegistry({
  workingDirectory: process.cwd(),
  toolTimeout: 300000, // 5 分钟超时
});

// 注册工具
registry.register([new BashTool(), new ReadFileTool()]);

// 执行工具
const results = await registry.execute(toolCalls, {
  sessionId: 'session-123',
  memoryManager,
});
```

### Logger 日志系统

企业级日志系统：

```typescript
import { createLogger } from './src/agent-v2/logger';

const logger = createLogger({
  level: 'info',
  console: {
    enabled: true,
    format: 'pretty',
    colorize: true,
  },
  file: {
    enabled: true,
    filepath: './logs/app.log',
    format: 'json',
  },
  sensitiveFields: ['apiKey', 'password', 'token'],
});

logger.info('Agent started', { sessionId: '123' });
logger.error('Tool failed', error, { toolName: 'bash' });
```

---

## ReAct 工作流程

项目实现了 **ReAct (Reasoning + Acting)** 范式：

```
┌─────────────────────────────────────────────────────────┐
│                    ReAct 主循环                          │
│                                                         │
│  ┌─────────┐    ┌──────────┐    ┌─────────────┐       │
│  │  User   │───▶│  Agent   │───▶│   Think     │       │
│  │ Query   │    │  Start   │    │ (LLM Call)  │       │
│  └─────────┘    └──────────┘    └──────┬──────┘       │
│                                        │               │
│                      ┌─────────────────┼─────────────┐ │
│                      ▼                 ▼             │ │
│               ┌────────────┐    ┌─────────────┐     │ │
│               │ Tool Calls │    │ Text Output │     │ │
│               └─────┬──────┘    └──────┬──────┘     │ │
│                     │                  │            │ │
│                     ▼                  ▼            │ │
│               ┌────────────┐    ┌─────────────┐     │ │
│               │  Execute   │    │  Complete   │◀────┘ │
│               │   Tools    │    │   (Done)    │       │
│               └─────┬──────┘    └─────────────┘       │
│                     │                                  │
│                     ▼                                  │
│               ┌────────────┐                          │
│               │  Observe   │──────────────────────────┤
│               │  Results   │                          │
│               └────────────┘                          │
│                     │                                  │
│                     └──────────▶ (循环继续)            │
└─────────────────────────────────────────────────────────┘
```

### 主循环伪代码

```typescript
while (task not complete) {
  // 1. 思考阶段
  response = LLM(messages, tools)
  
  if (response.tool_calls) {
    // 2. 行动阶段：执行工具
    results = executeTools(response.tool_calls)
    addObservation(results)
  } else {
    // 3. 完成：返回最终答案
    return response.content
  }
  
  // 4. 错误处理与重试
  if (error and retryable) {
    retryWithBackoff()
  }
}
```

---

## API 文档

### Agent 类

#### 构造函数

```typescript
constructor(config: AgentOptions)
```

#### AgentOptions 配置

| 参数 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| `provider` | `LLMProvider` | ✅ | - | LLM 提供者 |
| `systemPrompt` | `string` | ❌ | `''` | 系统提示词 |
| `toolRegistry` | `ToolRegistry` | ❌ | 默认工具 | 工具注册表 |
| `memoryManager` | `IMemoryManager` | ❌ | - | 持久化存储管理器 |
| `sessionId` | `string` | ❌ | UUID | 会话 ID |
| `stream` | `boolean` | ❌ | `false` | 是否启用流式输出 |
| `streamCallback` | `StreamCallback` | ❌ | - | 流式消息回调 |
| `maxLoops` | `number` | ❌ | `3000` | 最大循环次数 |
| `maxRetries` | `number` | ❌ | `10` | 最大重试次数 |
| `retryDelayMs` | `number` | ❌ | `5000` | 重试延迟（毫秒） |
| `requestTimeout` | `number` | ❌ | Provider 默认 | 请求超时（毫秒） |
| `idleTimeout` | `number` | ❌ | `180000` | 流式空闲超时（毫秒） |
| `enableCompaction` | `boolean` | ❌ | `false` | 启用上下文压缩 |
| `compactionConfig` | `Partial<CompactionConfig>` | ❌ | - | 压缩配置 |
| `thinking` | `boolean` | ❌ | `false` | 启用 thinking 模式 |
| `maxBufferSize` | `number` | ❌ | `100000` | 流式缓冲区大小 |
| `logger` | `Logger` | ❌ | 默认日志器 | 日志器实例 |
| `enableEventLogging` | `boolean` | ❌ | `true` | 启用事件日志 |

#### 方法

##### execute()

执行任务并返回最终消息。

```typescript
async execute(
  query: MessageContent,
  options?: LLMGenerateOptions
): Promise<Message>
```

**示例：**

```typescript
const message = await agent.execute('帮我分析这段代码');

// 多模态输入
const message = await agent.execute([
  { type: 'text', text: '这张图片里有什么？' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
]);
```

##### executeWithResult()

执行任务并返回详细结果。

```typescript
async executeWithResult(
  query: MessageContent,
  options?: LLMGenerateOptions
): Promise<AgentExecutionResult>
```

**返回：**

```typescript
interface AgentExecutionResult {
  status: 'completed' | 'failed' | 'aborted';
  finalMessage?: Message;
  failure?: AgentFailure;
  loopCount: number;
  retryCount: number;
  sessionId: string;
}
```

##### abort()

中止正在执行的任务。

```typescript
abort(): void
```

##### close()

关闭 Agent，释放资源。

```typescript
async close(): Promise<void>
```

##### 状态查询方法

```typescript
getStatus(): AgentStatus        // 获取当前状态
getMessages(): Message[]        // 获取所有消息
getSessionId(): string          // 获取会话 ID
getLoopCount(): number          // 获取循环次数
getRetryCount(): number         // 获取重试次数
getTokenInfo()                  // 获取 Token 使用情况
```

### AgentStatus 枚举

```typescript
enum AgentStatus {
  IDLE = 'idle',           // 空闲
  THINKING = 'thinking',   // 思考中
  RUNNING = 'running',     // 运行中
  RETRYING = 'retrying',   // 重试中
  COMPLETED = 'completed', // 已完成
  FAILED = 'failed',       // 已失败
  ABORTED = 'aborted',     // 已中止
}
```

---

## 工具系统

### 内置工具列表

#### 1. BashTool

执行 Shell 命令。

```typescript
// 工具名称：bash
// 参数:
{
  command: string;      // 要执行的命令
  timeout?: number;     // 超时时间（毫秒）
  run_in_background?: boolean;  // 是否后台运行
}
```

#### 2. ReadFileTool

读取文件内容。

```typescript
// 工具名称：read_file
// 参数:
{
  filePath: string;     // 文件路径
  startLine?: number;   // 起始行
  endLine?: number;     // 结束行
}
```

#### 3. WriteFileTool

写入文件。

```typescript
// 工具名称：write_file
// 参数:
{
  filePath: string;     // 文件路径
  content: string;      // 文件内容
}
```

#### 4. SurgicalEditTool

精确的文本替换编辑。

```typescript
// 工具名称：precise_replace
// 参数:
{
  filePath: string;     // 文件路径
  line: number;         // 行号
  oldText: string;      // 要替换的文本
  newText: string;      // 新文本
}
```

#### 5. BatchReplaceTool

批量文本替换。

```typescript
// 工具名称：batch_replace
// 参数:
{
  filePath: string;
  replacements: Array<{
    line: number;
    oldText: string;
    newText: string;
  }>;
}
```

#### 6. GrepTool

基于正则的代码搜索。

```typescript
// 工具名称：grep
// 参数:
{
  pattern: string;      // 正则模式
  path?: string;        // 搜索路径
  filePattern?: string; // 文件 glob 模式
  caseMode?: 'smart' | 'sensitive' | 'insensitive';
  multiline?: boolean;
}
```

#### 7. GlobTool

文件模式匹配。

```typescript
// 工具名称：glob
// 参数:
{
  pattern: string;      // Glob 模式
  path?: string;        // 搜索路径
}
```

#### 8. WebSearchTool

网络搜索。

```typescript
// 工具名称：web_search
// 参数:
{
  query: string;        // 搜索查询
  maxResults?: number;  // 最大结果数 (1-10)
}
```

#### 9. WebFetchTool

网页内容抓取。

```typescript
// 工具名称：web_fetch
// 参数:
{
  url: string;          // 网页 URL
  format?: 'text' | 'markdown' | 'html';
  timeout?: number;
}
```

#### 10. LspTool

语言服务器协议支持。

```typescript
// 工具名称：lsp
// 参数:
{
  operation: 'goToDefinition' | 'findReferences' | 'hover' | 
             'documentSymbol' | 'workspaceSymbol';
  filePath: string;
  line: number;
  character: number;
}
```

#### 11-16. 任务管理工具

```typescript
// TaskCreateTool - 创建任务
{
  subject: string;      // 任务标题
  description: string;  // 任务描述
  activeForm: string;   // 进行中形式
}

// TaskGetTool - 获取任务详情
// TaskListTool - 列出所有任务
// TaskUpdateTool - 更新任务状态
// TaskOutputTool - 获取任务输出
// TaskStopTool - 停止任务
```

### 自定义工具

创建自定义工具只需继承 `BaseTool`：

```typescript
import { BaseTool, ToolResult } from './src/agent-v2';
import { z } from 'zod';

class DatabaseQueryTool extends BaseTool<typeof MySchema> {
  name = 'db_query';
  description = '执行数据库查询';
  
  schema = z.object({
    sql: z.string().describe('SQL 查询语句'),
    limit: z.number().optional().describe('返回行数限制'),
  });

  async execute(params: { sql: string; limit?: number }): Promise<ToolResult> {
    try {
      const results = await this.runQuery(params.sql, params.limit);
      
      return {
        success: true,
        output: JSON.stringify(results, null, 2),
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async runQuery(sql: string, limit?: number) {
    // 实现查询逻辑
  }
}

// 注册到 ToolRegistry
const registry = new ToolRegistry({ workingDirectory: process.cwd() });
registry.register(new DatabaseQueryTool());
```

---

## 会话管理

### Session 类

Session 负责管理对话上下文：

```typescript
import { Session } from './src/agent-v2';

const session = new Session({
  systemPrompt: '你是一个有帮助的助手',
  memoryManager,           // 可选：启用持久化
  sessionId: 'existing-session-id',  // 可选：恢复会话
  enableCompaction: true,  // 启用自动压缩
  compactionConfig: {
    maxTokens: 100000,     // 触发压缩的 token 阈值
    compactionRatio: 0.3,  // 压缩后保留的比例
    llmProvider: provider, // 用于压缩的 LLM
  },
});

// 初始化（如果使用持久化，会加载历史数据）
await session.initialize();

// 添加消息
session.addMessage({
  messageId: 'msg-1',
  role: 'user',
  content: '你好',
});

// 获取消息
const messages = session.getMessages();

// 同步到存储
await session.sync();
```

### 上下文压缩

当对话上下文过长时，Session 会自动触发压缩：

```typescript
const session = new Session({
  enableCompaction: true,
  compactionConfig: {
    maxTokens: 100000,      // 超过此值触发压缩
    compactionRatio: 0.3,   // 保留 30% 的上下文
    llmProvider: provider,  // 用于压缩的 LLM
  },
});

// 压缩会在 LLM 调用前自动触发
await session.compactBeforeLLMCall();
```

### 消息类型

```typescript
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface Message {
  messageId: string;
  role: MessageRole;
  content: MessageContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  finish_reason?: FinishReason;
  usage?: Usage;
  type?: 'text' | 'tool-call';
}

type MessageContent = 
  | string 
  | Array<TextContent | ImageContent>;
```

---

## 持久化存储

### FileMemoryManager

基于文件系统的持久化存储：

```typescript
import { FileMemoryManager } from './src/agent-v2';

const memoryManager = new FileMemoryManager({
  baseDir: './data/sessions',  // 存储目录
});

// 初始化
await memoryManager.initialize();

// 存储会话数据
await memoryManager.saveSession(sessionId, {
  id: sessionId,
  messages: [...],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// 加载会话
const session = await memoryManager.loadSession(sessionId);

// 列出所有会话
const sessions = await memoryManager.listSessions();

// 删除会话
await memoryManager.deleteSession(sessionId);
```

### 存储结构

```
data/sessions/
├── session-xxx/
│   ├── session.json      # 会话元数据
│   ├── messages.json     # 消息历史
│   ├── context.json      # 当前上下文
│   └── compactions/      # 压缩记录
│       ├── compact-1.json
│       └── compact-2.json
└── session-yyy/
    └── ...
```

### 自定义存储

实现 `IMemoryManager` 接口可以创建自定义存储：

```typescript
interface IMemoryManager {
  initialize(): Promise<void>;
  saveSession(sessionId: string, data: SessionData): Promise<void>;
  loadSession(sessionId: string): Promise<SessionData | null>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(filter?: SessionFilter): Promise<SessionData[]>;
}

class RedisMemoryManager implements IMemoryManager {
  // 实现接口方法
}
```

---

## 日志系统

### 创建日志器

```typescript
import { createLogger, getLogger } from './src/agent-v2/logger';

// 获取默认日志器
const logger = getLogger();

// 创建自定义日志器
const customLogger = createLogger({
  level: 'info',
  console: {
    enabled: true,
    format: 'pretty',
    colorize: true,
    timestamp: true,
  },
  file: {
    enabled: true,
    filepath: './logs/app.log',
    format: 'json',
    rotation: {
      maxSize: '10MB',
      maxFiles: 5,
    },
  },
  sensitiveFields: ['apiKey', 'password', 'token', 'secret'],
  defaultContext: {
    app: 'coding-agent',
    version: '2.0.0',
  },
});
```

### 日志级别

```typescript
logger.trace('详细追踪信息');
logger.debug('调试信息', { sessionId: '123' });
logger.info('普通信息', { toolName: 'bash' }, { duration: 100 });
logger.warn('警告信息');
logger.error('错误信息', error, { toolName: 'bash' });
logger.fatal('致命错误', error);
```

### 子日志器

```typescript
const agentLogger = logger.child('agent');
agentLogger.info('Agent started');

const toolLogger = agentLogger.child('tools');
toolLogger.debug('Tool executing');
```

### 中间件

```typescript
// 添加自定义中间件
logger.use((record, next) => {
  // 添加请求 ID
  record.context.requestId = generateRequestId();
  next();
});

// 敏感字段脱敏（内置）
const logger = createLogger({
  sensitiveFields: ['apiKey', 'password'],
});
```

---

## 事件系统

### EventBus

事件总线用于组件间解耦通信：

```typescript
import { Agent, EventType } from './src/agent-v2';

const agent = new Agent({ provider });

// 订阅事件
agent.on(EventType.TASK_START, (data) => {
  console.log('任务开始:', data);
});

agent.on(EventType.TASK_PROGRESS, (data) => {
  console.log(`进度：循环 ${data.loopCount}`);
});

agent.on(EventType.TASK_SUCCESS, (data) => {
  console.log('任务成功:', data);
});

agent.on(EventType.TASK_FAILED, (data) => {
  console.log('任务失败:', data);
});

agent.on(EventType.TASK_RETRY, (data) => {
  console.log(`重试 ${data.retryCount}/${data.maxRetries}: ${data.reason}`);
});
```

### 事件类型

```typescript
enum EventType {
  TASK_START = 'task:start',
  TASK_PROGRESS = 'task:progress',
  TASK_SUCCESS = 'task:success',
  TASK_FAILED = 'task:failed',
  TASK_RETRY = 'task:retry',
  TOOL_START = 'tool:start',
  TOOL_SUCCESS = 'tool:success',
  TOOL_FAILED = 'tool:failed',
  STREAM_CHUNK = 'stream:chunk',
}
```

### 流式消息类型

```typescript
enum AgentMessageType {
  TEXT_START = 'text-start',
  TEXT_DELTA = 'text-delta',
  TEXT_COMPLETE = 'text-complete',
  REASONING_START = 'reasoning-start',
  REASONING_DELTA = 'reasoning-delta',
  REASONING_COMPLETE = 'reasoning-complete',
  TOOL_CALL_CREATED = 'tool-call-created',
  TOOL_CALL_STREAM = 'tool-call-stream',
  TOOL_CALL_RESULT = 'tool-call-result',
  STATUS = 'status',
  ERROR = 'error',
  CODE_PATCH = 'code-patch',
  USAGE = 'usage',
}
```

### 流式回调示例

```typescript
const agent = new Agent({
  provider,
  stream: true,
  streamCallback: (msg) => {
    switch (msg.type) {
      case 'text-delta':
        process.stdout.write(msg.content);
        break;
      case 'text-complete':
        console.log('\n[文本结束]');
        break;
      case 'reasoning-delta':
        process.stderr.write(`[思考] ${msg.content}`);
        break;
      case 'tool-call-created':
        console.log(`\n调用工具：${msg.toolCalls.map(t => t.name).join(', ')}`);
        break;
      case 'tool-call-result':
        console.log(`工具结果：${msg.status}`);
        break;
      case 'usage':
        console.log(`Token 使用：${msg.usage.total_tokens}`);
        break;
      case 'status':
        console.log(`状态：${msg.status} - ${msg.message}`);
        break;
      case 'error':
        console.error(`错误：${msg.message}`);
        break;
    }
  },
});
```

---

## LLM Provider

### 支持的 Provider

目前支持以下 LLM Provider：

| Provider | 模型示例 | 特性 |
|----------|----------|------|
| GLM (智谱) | glm-4.7, glm-5 | 支持工具调用，长上下文，高性价比 |
| Kimi (月之暗面) | kimi-k2.5, moonshot-v1 | 超长上下文 (128K+), thinking 模式 |
| MiniMax | minimax-2.5, abab6.5 | 支持工具调用，多模态理解 |
| DeepSeek | deepseek-chat, deepseek-coder | 代码能力优秀，极低价格 |
| Qwen (通义千问) | qwen3.5-plus, qwen-max | 支持工具调用，多语言支持 |

### 使用 ProviderRegistry（推荐）

```typescript
import { ProviderRegistry, Models } from './src/providers';

// 从环境变量创建（推荐）
const provider = ProviderRegistry.createFromEnv('glm-4.7');

// 获取模型配置
const modelConfig = Models.glm47;
console.log(modelConfig.name, modelConfig.max_tokens);

// 列出所有可用模型
const allModels = ProviderRegistry.listModels();
```

### 创建 Provider

```typescript
import { 
  createGLMProvider, 
  createKimiProvider,
  createMiniMaxProvider 
} from './src/providers';

// GLM Provider
const glmProvider = createGLMProvider({
  apiKey: process.env.GLM_API_KEY!,
  model: 'glm-4-plus',
  timeout: 60000,
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
});

// Kimi Provider（支持 thinking 模式）
const kimiProvider = createKimiProvider({
  apiKey: process.env.KIMI_API_KEY!,
  model: 'moonshot-v1-128k',
  timeout: 120000,
});

// MiniMax Provider
const miniMaxProvider = createMiniMaxProvider({
  apiKey: process.env.MINIMAX_API_KEY!,
  groupId: process.env.MINIMAX_GROUP_ID!,
  model: 'abab6.5s-chat',
});
```

### 自定义 Provider

```typescript
import { LLMProvider, LLMResponse, Message } from './src/providers';

class MyCustomProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(config: { apiKey: string; model: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  getModel(): string {
    return this.model;
  }

  getTimeTimeout(): number {
    return 60000;
  }

  async generate(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: LLMGenerateOptions
  ): Promise<LLMResponse> {
    const response = await fetch('https://api.example.com/v1/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        tools: tools,
        ...options,
      }),
    });

    return this.parseResponse(response);
  }

  private parseResponse(response: Response): LLMResponse {
    // 解析响应为统一格式
  }
}
```

---

## CLI 使用

### 启动 CLI

```bash
# 开发模式
pnpm dev:cli

# 或使用 bun
bun run src/cli/run.tsx
```

### CLI 功能

- **交互式对话**：与 Agent 进行多轮对话
- **流式输出**：实时显示 Agent 响应
- **工具调用展示**：显示工具调用过程和结果
- **会话管理**：支持新建/恢复会话
- **React TUI**：美观的终端用户界面

---

## 配置选项

### 完整配置示例

```typescript
import { 
  Agent, 
  createDefaultToolRegistry, 
  FileMemoryManager 
} from './src/agent-v2';
import { createKimiProvider } from './src/providers';

const provider = createKimiProvider({
  apiKey: process.env.KIMI_API_KEY!,
  model: 'moonshot-v1-128k',
  timeout: 120000,
});

const toolRegistry = createDefaultToolRegistry({
  workingDirectory: process.cwd(),
}, provider);

const memoryManager = new FileMemoryManager({
  baseDir: './data/sessions',
});

const agent = new Agent({
  // 必需配置
  provider,
  
  // 提示词配置
  systemPrompt: `
你是一个专业的编程助手。你的职责是：
1. 帮助用户编写、分析和优化代码
2. 解答编程相关问题
3. 使用工具完成文件操作、命令执行等任务
`,
  
  // 工具配置
  toolRegistry,
  
  // 存储配置
  memoryManager,
  sessionId: 'my-session-001',  // 可选：恢复已有会话
  
  // 执行配置
  maxLoops: 100,
  maxRetries: 5,
  retryDelayMs: 3000,
  requestTimeout: 60000,
  idleTimeout: 180000,
  
  // 流式配置
  stream: true,
  streamCallback: (msg) => {
    // 处理流式消息
  },
  
  // 上下文压缩配置
  enableCompaction: true,
  compactionConfig: {
    maxTokens: 100000,
    compactionRatio: 0.3,
  },
  
  // 日志配置
  enableEventLogging: true,
  
  // 特殊模式
  thinking: true,  // Kimi 的 thinking 模式
});
```

---

## 开发指南

### 项目结构

```
coding-agent/
├── src/
│   ├── agent-v2/           # Agent v2 核心实现
│   │   ├── agent/          # Agent 引擎
│   │   │   ├── core/       # 核心组件
│   │   │   │   ├── agent-state.ts     # 状态管理
│   │   │   │   ├── llm-caller.ts      # LLM 调用
│   │   │   │   ├── tool-executor.ts   # 工具执行
│   │   │   │   └── retry-strategy.ts  # 重试策略
│   │   │   ├── agent.ts              # Agent 主类
│   │   │   ├── types.ts              # 类型定义
│   │   │   ├── errors.ts             # 错误处理
│   │   │   └── stream-processor.ts   # 流式处理
│   │   ├── session/        # 会话管理
│   │   ├── memory/         # 持久化存储
│   │   ├── tool/           # 工具系统
│   │   ├── logger/         # 日志系统
│   │   ├── eventbus/       # 事件总线
│   │   ├── truncation/     # 截断模块
│   │   └── util/           # 工具函数
│   ├── providers/          # LLM Provider 层
│   │   ├── adapters/       # Provider 适配器
│   │   ├── http/           # HTTP 客户端
│   │   └── registry/       # Provider 注册表
│   ├── agent-chat-react/   # React Hooks
│   └── cli/                # CLI 应用
├── data/                   # 运行时数据
├── test-agent/            # 测试适配器
└── typescript/            # TypeScript 练习
```

### 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 运行测试
pnpm test

# 测试覆盖率
pnpm test:coverage

# 代码检查
pnpm lint

# 代码检查并修复
pnpm lint:fix

# 格式检查
pnpm format:check

# 格式修复
pnpm format

# 类型检查
pnpm typecheck

# 完整 CI 检查
pnpm ci:check

# 运行 CLI
pnpm cli
```

### 代码规范

项目使用以下工具保证代码质量：

- **TypeScript 严格模式**：启用所有严格类型检查
- **ESLint**：代码规范检查
- **Prettier**：代码格式化
- **Vitest**：单元测试（1200+ 测试用例）

### 添加新工具

1. 在 `src/agent-v2/tool/` 创建新文件
2. 继承 `BaseTool` 类
3. 在 `src/agent-v2/tool/index.ts` 导出
4. 添加测试文件

```typescript
// src/agent-v2/tool/my-tool.ts
import { BaseTool, ToolResult } from './base';
import { z } from 'zod';

export class MyTool extends BaseTool<typeof MySchema> {
  name = 'my_tool';
  description = '工具描述';
  
  schema = z.object({
    param: z.string().describe('参数描述'),
  });

  async execute(params: { param: string }): Promise<ToolResult> {
    // 实现逻辑
    return { success: true, output: 'result' };
  }
}
```

---

## 测试

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test agent.core-logic

# 测试覆盖率
pnpm test:coverage

# 测试 UI
pnpm test:ui
```

### 测试结构

```
src/agent-v2/
├── agent/
│   ├── agent.core-logic.test.ts    # 核心逻辑测试
│   ├── agent.deep.test.ts          # 深度测试
│   ├── agent.errors.test.ts        # 错误处理测试
│   ├── agent.retry.test.ts         # 重试机制测试
│   └── stream-processor.test.ts    # 流式处理测试
├── session/
│   ├── session.compaction.test.ts  # 压缩测试
│   ├── session.persistence.test.ts # 持久化测试
│   └── ...
├── tool/
│   └── __tests__/
│       ├── file.test.ts            # 文件工具测试
│       ├── grep.test.ts            # 搜索工具测试
│       └── ...
└── memory/
    └── file-memory.persistence.test.ts
```

### 编写测试

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../agent';
import { createMockProvider } from '../../test-utils';

describe('Agent', () => {
  let agent: Agent;
  
  beforeEach(() => {
    const provider = createMockProvider();
    agent = new Agent({ provider });
  });

  it('should execute simple query', async () => {
    const result = await agent.execute('Hello');
    expect(result.role).toBe('assistant');
  });
});
```

---

## 常见问题

### Q: 如何处理超时？

A: Agent 有多层超时控制：

```typescript
const agent = new Agent({
  provider,
  requestTimeout: 60000,  // 单次调用总时长上限（流式/非流式都生效）
  idleTimeout: 180000,    // 仅流式：chunk 间隔空闲超时
  maxRetries: 5,          // 重试次数
  retryDelayMs: 3000,     // 重试间隔
});
```

### Q: 如何恢复之前的会话？

A: 使用 sessionId 和 memoryManager：

```typescript
const agent = new Agent({
  provider,
  memoryManager,
  sessionId: 'previous-session-id',
});
```

### Q: 如何添加自定义工具？

A: 继承 BaseTool 并注册：

```typescript
const registry = createDefaultToolRegistry({ workingDirectory: cwd });
registry.register(new MyCustomTool());

const agent = new Agent({ provider, toolRegistry: registry });
```

### Q: 如何处理大文件？

A: 使用分块读取：

```typescript
// 工具调用时会自动处理
// 或在 ReadFileTool 参数中指定范围
{
  filePath: 'large-file.log',
  startLine: 1,
  endLine: 100,
}
```

### Q: 如何启用 thinking 模式？

A: 部分模型（如 Kimi）支持 thinking 模式：

```typescript
const agent = new Agent({
  provider: kimiProvider,
  thinking: true,
});
```

### Q: 如何查看 Token 使用情况？

A: 使用 getTokenInfo 方法：

```typescript
const tokenInfo = agent.getTokenInfo();
console.log('Estimated tokens:', tokenInfo.estimatedTotal);
```

### Q: 如何配置日志输出？

A: 创建自定义日志器并传递给 Agent：

```typescript
const logger = createLogger({
  level: 'debug',
  file: { enabled: true, filepath: './logs/agent.log' },
});

const agent = new Agent({
  provider,
  logger,
});
```

---

## 贡献指南

我们欢迎所有形式的贡献！

### 贡献方式

1. **报告问题**：在 GitHub Issues 中提交 bug 报告
2. **功能建议**：提交功能请求或改进建议
3. **代码贡献**：提交 Pull Request

### 提交 PR 流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码规范

- 遵循 ESLint 规则
- 为新功能添加测试
- 更新相关文档
- 运行完整 CI 检查：`pnpm ci:check`

### Commit Message 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <subject>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

**Type 类型：**
- `feat` - 新功能
- `fix` - Bug 修复
- `docs` - 文档更新
- `style` - 代码格式
- `refactor` - 代码重构
- `test` - 测试相关
- `chore` - 构建/工具相关

---

## 更新日志

### v2.0.0 (当前版本)

**新增功能**
- ✅ 企业级日志系统：结构化日志、多 Transport、中间件链、敏感字段脱敏
- ✅ 流式响应智能恢复：检测流式中断，自动恢复响应
- ✅ 多 Agent 协同分析：子 Agent 任务委托，事件冒泡机制
- ✅ Plan 模式只读工具白名单：安全的规划模式

**核心改进**
- ✅ ReAct 引擎优化：Reasoning + Acting 循环，智能决策
- ✅ 工具协议修复：自动修复中断的工具调用
- ✅ 上下文压缩增强：8 章节结构化摘要
- ✅ 错误处理统一：智能错误分类，指数退避重试

**测试覆盖**
- ✅ 1200+ 单元测试
- ✅ 核心逻辑全面覆盖
- ✅ 边界条件测试

### v1.0.0

**核心架构**
- ✅ ReAct 引擎
- ✅ 协调器模式
- ✅ 分层架构
- ✅ 六边形架构

**Agent 核心**
- ✅ 状态机管理
- ✅ 流式处理
- ✅ 响应验证
- ✅ 自动重试
- ✅ 上下文压缩

**工具系统**
- ✅ 16+ 内置工具
- ✅ 模板方法模式
- ✅ 超时控制 + 截断中间件

**Provider 层**
- ✅ 多 LLM 支持
- ✅ 适配器模式
- ✅ 流式 SSE 解析

**存储系统**
- ✅ 多后端支持
- ✅ 会话恢复
- ✅ 压缩记录

---

## 许可证

本项目采用 [ISC](https://opensource.org/licenses/ISC) 许可证。

---

## 联系方式

如有问题或建议，请通过以下方式联系：

- 提交 [GitHub Issue](https://github.com/wangrenren611/coding-agent/issues)
- 查看 [项目仓库](https://github.com/wangrenren611/coding-agent)

---

<p align="center">
  Made with ❤️ by Coding Agent Team
</p>
