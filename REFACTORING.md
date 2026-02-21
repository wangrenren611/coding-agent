# Coding Agent 重构技术文档

> 生成日期: 2026-02-22
> 项目版本: 1.0.0
> 文档目的: 作为后续代码重构的技术指南和参考

---

## 目录

1. [项目概述](#1-项目概述)
2. [当前架构分析](#2-当前架构分析)
3. [问题清单](#3-问题清单)
4. [重构目标](#4-重构目标)
5. [重构方案](#5-重构方案)
6. [实施计划](#6-实施计划)
7. [风险评估](#7-风险评估)
8. [验收标准](#8-验收标准)

---

## 1. 项目概述

### 1.1 项目简介

**项目名称**: agent-v4 (Coding Agent)
**项目类型**: AI 编码助手框架 / 多模态 LLM Agent 系统
**技术栈**: TypeScript 5.9 + Node.js 20+ + React 19 + Zod 4

### 1.2 核心功能

- 多轮对话与上下文管理
- 流式响应处理
- 工具调用与执行
- 会话持久化与恢复
- 上下文自动压缩
- 多 LLM Provider 支持

### 1.3 目录结构

```
D:\work\coding-agent\
├── src/                          # 主要源代码
│   ├── agent-v2/                 # Agent v2 核心实现
│   │   ├── agent/                # Agent 核心引擎
│   │   ├── session/              # 会话管理
│   │   ├── memory/               # 记忆/持久化
│   │   ├── tool/                 # 工具系统
│   │   ├── eventbus/             # 事件总线
│   │   ├── prompts/              # 提示词模板
│   │   └── util/                 # 工具函数
│   │
│   ├── providers/                # LLM Provider 层
│   │   ├── adapters/             # API 适配器
│   │   ├── http/                 # HTTP 客户端
│   │   └── types/                # 类型定义
│   │
│   └── agent-chat-react/         # React Hooks 状态管理
│
├── apps/                         # 应用层
│   ├── agent-cli-ink/            # CLI 应用 v1
│   └── agent-cli-ink-v2/         # CLI 应用 v2
│
└── data/                         # 运行时数据
    └── agent-memory/             # Agent 记忆存储
```

---

## 2. 当前架构分析

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (Applications)                     │
│   CLI (Ink)  │  Web UI  │  API 服务  │  Demo 程序            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent 层 (Core)                           │
│  Agent.execute() → runLoop() → executeLLMCall() → result   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Session  │ │  Tool    │ │ EventBus │ │ Memory   │       │
│  │          │ │ Registry │ │          │ │ Manager  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Provider 层 (LLM)                          │
│  ProviderRegistry │ HTTPClient │ StreamParser │ Adapters   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   LLM 服务层 (External)                      │
│     GLM  │  DeepSeek  │  Kimi  │  MiniMax  │  其他          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块职责

| 模块 | 文件位置 | 职责 | 行数 |
|------|----------|------|------|
| **Agent** | `src/agent-v2/agent/agent.ts` | 任务执行协调、状态管理 | 852 |
| **Session** | `src/agent-v2/session/index.ts` | 消息管理、持久化 | 310 |
| **ToolRegistry** | `src/agent-v2/tool/registry.ts` | 工具注册与执行 | 267 |
| **MemoryManager** | `src/agent-v2/memory/file-memory.ts` | 会话持久化 | - |
| **Provider** | `src/providers/openai-compatible.ts` | LLM API 调用 | - |

### 2.3 数据流

```
用户输入
    │
    ▼
Agent.execute(query)
    │
    ├─→ Session.initialize()  // 加载历史会话
    │
    ├─→ Session.addMessage(userMessage)
    │
    └─→ runLoop()
          │
          ├─→ executeLLMCall()
          │     │
          │     ├─→ Session.compactBeforeLLMCall()  // 可选压缩
          │     │
          │     ├─→ Provider.generate(messages, tools)
          │     │
          │     └─→ handleResponse()
          │           │
          │           ├─→ handleToolCallResponse()  // 执行工具
          │           │     │
          │           │     └─→ ToolRegistry.execute()
          │           │
          │           └─→ handleTextResponse()
          │
          └─→ checkComplete() ? → 返回结果 : 继续循环
```

---

## 3. 问题清单

### 3.1 严重问题 (P0)

#### 3.1.1 代码重复 - agent-chat-react 模块完全复制

**严重级别**: 🔴 严重
**影响范围**: 维护成本、一致性风险

**问题详情**:
- `src/agent-chat-react/` (源模块)
- `apps/agent-cli-ink/src/agent-chat-react/` (复制模块)

两个目录包含几乎相同的代码：
| 文件 | 源模块 | 复制模块 | 差异 |
|------|--------|----------|------|
| reducer.ts | 207行 | 355行 | 复制版本有增强 |
| reducer-helpers.ts | 192行 | 210行 | 小差异 |
| types.ts | 相同 | 相同 | 无 |
| selectors.ts | 相同 | 相同 | 无 |
| use-agent-chat.ts | 相同 | 相同 | 无 |

**当前状态**: 违反 DRY 原则，双倍维护成本

---

#### 3.1.2 Agent 类职责过多 (God Class)

**严重级别**: 🔴 严重
**位置**: `src/agent-v2/agent/agent.ts` (852行)

**问题详情**:
Agent 类承担了过多职责：
- 消息管理
- LLM 调用
- 工具执行
- 状态管理
- 输入验证
- 错误处理
- 流式处理
- 重试逻辑

**圈复杂度估计**: runLoop() 方法 > 15

---

#### 3.1.3 runLoop 方法复杂度过高

**严重级别**: 🔴 严重
**位置**: `src/agent-v2/agent/agent.ts:541-583`

```typescript
private async runLoop(options?: LLMGenerateOptions): Promise<void> {
    while (this.loopCount < this.loopMax) {
        if (this.retryCount > this.maxRetries) { ... }
        if (this.checkComplete()) { break; }
        if (this.retryCount > 0) { await this.handleRetry(); }
        // 复杂的状态转换和错误处理
        try {
            await this.executeLLMCall(options);
            // 多个状态重置
        } catch (error) {
            if (error instanceof CompensationRetryError) { ... }
            if (!isRetryableError(error)) { throw error; }
            // 复杂的重试逻辑
        }
    }
}
```

**问题**: 嵌套层级深，状态转换逻辑分散，难以测试和维护

---

### 3.2 中等问题 (P1)

#### 3.2.1 TaskTool 文件过大

**严重级别**: 🟠 中等
**位置**: `src/agent-v2/tool/task.ts` (824行)

**问题详情**:
单文件包含 7 个工具类：
- TaskTool
- TaskCreateTool
- TaskGetTool
- TaskListTool
- TaskUpdateTool
- TaskOutputTool
- TaskStopTool

**改进方向**: 拆分到独立文件 `task/` 目录

---

#### 3.2.2 类型安全问题 - `as any` 滥用

**严重级别**: 🟠 中等
**位置**: 多个 tool 文件

```typescript
// file.ts:45, 54, 65 等
metadata: { error: 'FILE_NOT_FOUND' } as any

// bash.ts:253, 263, 284 等
metadata: { error: 'COMMAND_REQUIRED' } as any

// task.ts: 多处
metadata: { error: 'TASK_NOT_FOUND' } as any
```

**问题**: 绕过类型检查，隐藏潜在类型错误

---

#### 3.2.3 同步文件操作

**严重级别**: 🟠 中等
**位置**: `src/agent-v2/tool/file.ts`, `surgical.ts`

```typescript
// 使用同步 API
content = fs.readFileSync(fullPath, 'utf-8');
fs.writeFileSync(fullPath, content);
```

**问题**: 阻塞事件循环，高并发场景下影响性能

---

#### 3.2.4 循环依赖风险

**严重级别**: 🟠 中等

**依赖链**:
- `src/agent-v2/agent/agent.ts` → `../session` → `../tool/registry`
- `src/agent-v2/tool/task.ts` → `../agent/agent` (创建子代理)

---

### 3.3 轻微问题 (P2)

#### 3.3.1 工具函数重复

**位置**: `src/agent-v2/tool/file.ts:170-173, 224-227`

```typescript
// 两个类有相同的私有方法
private resolvePath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return path.resolve(process.cwd(), normalizedPath);
}
```

---

#### 3.3.2 代码规范不一致

**导入顺序不一致**:
```typescript
// agent.ts - Node 模块优先
import { v4 as uuid } from "uuid";
import { Session } from "../session";

// surgical.ts - 外部模块优先
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
```

**注释语言混用**: 中英文混用

**空行风格不一致**: 部分文件有多余空行

---

## 4. 重构目标

### 4.1 核心目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| **消除重复** | 合并 agent-chat-react 模块 | P0 |
| **降低复杂度** | 拆分 Agent 类职责 | P0 |
| **提升类型安全** | 消除 `as any` | P1 |
| **改善性能** | 异步化文件操作 | P1 |
| **统一规范** | 代码风格一致性 | P2 |

### 4.2 量化指标

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| Agent.ts 行数 | 852 | < 400 |
| 单方法最大圈复杂度 | ~15 | < 10 |
| `as any` 使用次数 | ~20+ | 0 |
| 代码重复率 | ~15% | < 5% |
| 测试覆盖率 | 未知 | > 80% |

---

## 5. 重构方案

### 5.1 消除代码重复

#### 5.1.1 合并 agent-chat-react 模块

**方案**: 将 `apps/agent-cli-ink/src/agent-chat-react/` 改为从 `src/agent-chat-react/` 导入

**实施步骤**:
1. 增强 `src/agent-chat-react/reducer.ts` 功能
2. 删除 `apps/agent-cli-ink/src/agent-chat-react/` 目录
3. 更新导入路径

```typescript
// apps/agent-cli-ink/src/xxx.ts
// 修改前
import { useAgentChat } from './agent-chat-react/use-agent-chat';

// 修改后
export * from '../../../src/agent-chat-react';
```

---

### 5.2 Agent 类重构

#### 5.2.1 职责拆分方案

```
Agent (协调者) - 约 300 行
├── interfaces/
│   └── IAgentCore.ts           # 核心接口定义
│
├── core/
│   ├── AgentLoop.ts            # 主循环逻辑 (~100行)
│   ├── AgentState.ts           # 状态管理 (~50行)
│   └── AgentValidator.ts       # 输入验证 (~80行)
│
├── execution/
│   ├── LLMCaller.ts            # LLM 调用 (~100行)
│   ├── ToolExecutor.ts         # 工具执行 (~80行)
│   └── ResponseHandler.ts      # 响应处理 (~100行)
│
└── Agent.ts                    # 主类，组合以上模块
```

#### 5.2.2 接口设计

```typescript
// interfaces/IAgentCore.ts
export interface IAgentLoop {
    run(options?: LLMGenerateOptions): Promise<void>;
    shouldContinue(): boolean;
    handleRetry(): Promise<void>;
}

export interface IAgentState {
    status: AgentStatus;
    loopCount: number;
    retryCount: number;
    transitionTo(newStatus: AgentStatus): void;
    reset(): void;
}

export interface ILLMCaller {
    execute(messages: Message[], options?: LLMGenerateOptions): Promise<LLMResponse>;
    abort(): void;
}

export interface IToolExecutor {
    execute(toolCalls: ToolCall[], context: ToolContext): Promise<ToolExecutionResult[]>;
}

export interface IResponseHandler {
    handle(response: LLMResponse, messageId: string): Promise<void>;
}
```

---

### 5.3 TaskTool 拆分

#### 5.3.1 目录结构

```
src/agent-v2/tool/
├── task/
│   ├── index.ts                # 统一导出
│   ├── base.ts                 # 共享基类和工具函数
│   ├── task-tool.ts            # TaskTool
│   ├── task-create.ts          # TaskCreateTool
│   ├── task-get.ts             # TaskGetTool
│   ├── task-list.ts            # TaskListTool
│   ├── task-update.ts          # TaskUpdateTool
│   ├── task-output.ts          # TaskOutputTool
│   ├── task-stop.ts            # TaskStopTool
│   └── __tests__/
│       └── task.test.ts
└── task.ts                     # 废弃，改为 re-export
```

#### 5.3.2 共享基类

```typescript
// task/base.ts
export abstract class BaseTaskTool<T extends z.ZodType> extends BaseTool<T> {
    protected getTaskStore(): ManagedTaskStore {
        return getManagedTaskStore();
    }
    
    protected validateTaskExists(taskId: string): Task | never {
        const task = this.getTaskStore().get(taskId);
        if (!task) {
            throw new TaskNotFoundError(taskId);
        }
        return task;
    }
}
```

---

### 5.4 类型安全增强

#### 5.4.1 定义工具结果元类型

```typescript
// tool/types.ts
export type ToolErrorType = 
    | 'FILE_NOT_FOUND'
    | 'FILE_READ_ERROR'
    | 'FILE_WRITE_ERROR'
    | 'COMMAND_REQUIRED'
    | 'COMMAND_TIMEOUT'
    | 'TASK_NOT_FOUND'
    | 'INVALID_ARGUMENTS'
    | 'PERMISSION_DENIED';

export interface ToolErrorMetadata {
    error: ToolErrorType;
    message?: string;
    details?: Record<string, unknown>;
}

export interface ToolSuccessMetadata<T = unknown> {
    data: T;
    path?: string;
    duration?: number;
}

export type ToolResultMetadata = ToolErrorMetadata | ToolSuccessMetadata;
```

#### 5.4.2 工具返回类型约束

```typescript
// 使用类型推断替代 as any
export class ReadFileTool extends BaseTool<typeof schema> {
    async execute(args: z.infer<typeof schema>): Promise<ToolResult<ToolResultMetadata>> {
        // ...
        return { 
            success: false, 
            metadata: { error: 'FILE_NOT_FOUND', message: '...' }  // 类型安全
        };
    }
}
```

---

### 5.5 异步化文件操作

```typescript
// tool/file.ts
import { promises as fsPromises } from 'fs';
const { readFile, writeFile, stat } = fsPromises;

export class ReadFileTool extends BaseTool<typeof schema> {
    async execute(args): Promise<ToolResult> {
        const content = await readFile(fullPath, 'utf-8');
        // ...
    }
}
```

---

### 5.6 代码规范统一

#### 5.6.1 导入顺序规范

```typescript
// 1. Node.js 内置模块
import fs from 'fs';
import path from 'path';

// 2. 第三方库
import { z } from 'zod';
import { v4 as uuid } from 'uuid';

// 3. 项目内部模块 (相对路径)
import { BaseTool } from './base';
import type { ToolContext } from './types';
```

#### 5.6.2 注释规范

```typescript
/**
 * 工具执行器 - 负责工具的注册和执行
 * 
 * @example
 * ```typescript
 * const registry = new ToolRegistry({ workingDirectory: '/path' });
 * registry.register([new BashTool()]);
 * const result = await registry.execute(toolCalls);
 * ```
 */
export class ToolRegistry { ... }
```

---

## 6. 实施计划

### 6.1 阶段一：消除重复 (1周)

| 任务 | 预计时间 | 负责人 |
|------|----------|--------|
| 增强 src/agent-chat-react/reducer.ts | 2h | - |
| 更新 apps/agent-cli-ink 导入 | 1h | - |
| 删除重复代码 | 0.5h | - |
| 运行测试验证 | 0.5h | - |

### 6.2 阶段二：Agent 类重构 (2周)

| 任务 | 预计时间 | 依赖 |
|------|----------|------|
| 定义核心接口 | 2h | - |
| 提取 AgentState | 3h | 接口定义 |
| 提取 AgentLoop | 4h | AgentState |
| 提取 LLMCaller | 3h | 接口定义 |
| 提取 ResponseHandler | 4h | 接口定义 |
| 重构 Agent 主类 | 4h | 所有子模块 |
| 单元测试编写 | 4h | 重构完成 |
| 集成测试验证 | 2h | 单元测试 |

### 6.3 阶段三：TaskTool 拆分 (1周)

| 任务 | 预计时间 |
|------|----------|
| 创建 task/ 目录结构 | 1h |
| 提取共享基类 | 2h |
| 拆分各个工具类 | 4h |
| 更新导出和导入 | 1h |
| 测试验证 | 2h |

### 6.4 阶段四：类型安全 (1周)

| 任务 | 预计时间 |
|------|----------|
| 定义 ToolResultMetadata 类型 | 2h |
| 替换所有 as any | 4h |
| 修复类型错误 | 4h |
| 测试验证 | 2h |

### 6.5 阶段五：代码规范 (持续)

| 任务 | 预计时间 |
|------|----------|
| 配置 ESLint 规则 | 2h |
| 统一导入顺序 | 2h |
| 统一注释风格 | 4h |
| 添加 pre-commit hook | 1h |

---

## 7. 风险评估

### 7.1 风险矩阵

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Agent 重构导致功能回归 | 中 | 高 | 完整的测试覆盖 |
| 循环依赖问题 | 低 | 中 | 模块边界清晰定义 |
| 性能下降 | 低 | 中 | 性能基准测试 |
| 重构时间超预期 | 中 | 中 | 分阶段实施 |

### 7.2 回滚策略

1. **分支策略**: 在 `refactoring` 分支进行重构
2. **增量提交**: 每个功能点独立提交
3. **版本标签**: 关键节点打 tag
4. **回滚点**: 保留 main 分支作为回滚基准

---

## 8. 验收标准

### 8.1 功能验收

- [ ] 所有现有测试通过
- [ ] Agent execute() 方法行为不变
- [ ] 所有工具执行结果一致
- [ ] CLI 应用功能正常

### 8.2 质量验收

- [ ] Agent.ts 行数 < 400
- [ ] 单方法圈复杂度 < 10
- [ ] 无 `as any` 类型断言
- [ ] 代码重复率 < 5%
- [ ] ESLint 无错误

### 8.3 性能验收

- [ ] 响应时间无明显下降 (< 5%)
- [ ] 内存使用无明显增加 (< 10%)
- [ ] 文件操作使用异步 API

---

## 附录

### A. 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `src/agent-v2/agent/agent.ts` | 修改 | 职责拆分 |
| `src/agent-v2/agent/core/` | 新增 | 核心子模块 |
| `src/agent-v2/agent/execution/` | 新增 | 执行子模块 |
| `src/agent-v2/tool/task.ts` | 修改 | 改为 re-export |
| `src/agent-v2/tool/task/` | 新增 | 拆分的工具类 |
| `src/agent-v2/tool/types.ts` | 新增 | 工具结果类型 |
| `apps/agent-cli-ink/src/agent-chat-react/` | 删除 | 重复代码 |
| `src/agent-chat-react/` | 修改 | 增强功能 |

### B. 参考文档

- [项目架构文档](./docs/ARCHITECTURE.md)
- [执行流程文档](./docs/EXECUTION_FLOW.md)
- [TypeScript 最佳实践](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [Clean Code 原则](https://github.com/ryanmcdermott/clean-code-javascript)

---

## 附录 C: 深度分析报告

> 以下内容由多维度代码分析自动生成

### C.1 安全性分析

#### 🔴 高危问题

| 问题 | 文件 | 风险 | 建议 |
|------|------|------|------|
| 环境变量包含真实凭证 | `.env.development` | 严重 | 立即轮换所有 API 密钥 |
| API Key 可能被记录 | `providers/http/client.ts` | 中等 | 确保 debug 日志脱敏 |
| 路径遍历风险 | `tool/file.ts` | 中等 | 添加路径验证 |

#### 敏感信息处理改进

```typescript
// 改进前 (tool/file.ts:224-227)
private resolvePath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return path.resolve(process.cwd(), normalizedPath);
}

// 改进后
private resolvePath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const resolved = path.resolve(process.cwd(), normalizedPath);
    
    // 防止路径遍历
    if (!resolved.startsWith(process.cwd())) {
        throw new Error('Path traversal detected');
    }
    return resolved;
}
```

### C.2 性能分析

#### 🔴 高优先级

| 问题 | 文件 | 影响 | 解决方案 |
|------|------|------|----------|
| 全局 Map 内存泄漏 | `tool/task/background-runtime.ts` | 高 | 添加定期清理机制 |
| 同步文件读取 | `tool/file.ts:65-67` | 中 | 改为异步 `readFile` |
| 后台任务无并发限制 | `tool/task.ts` | 中 | 添加任务队列和并发限制 |

#### 字符串拼接优化

```typescript
// 改进前 (stream-processor.ts:508-526)
this.buffers.content += content;  // O(n²) 复杂度

// 改进后
interface BufferData {
    contentChunks: string[];
}
this.buffers.contentChunks.push(content);
// 获取时: this.buffers.contentChunks.join('')
```

### C.3 依赖分析

#### 冗余依赖

| 依赖 | 问题 | 建议 |
|------|------|------|
| `uuidv4` | 未使用 | 移除 |
| `glob` | 与 `fast-glob` 重复 | 移除，保留 `fast-glob` |
| `@types/*` | 在 dependencies 中 | 移到 devDependencies |
| `@opentui/*` | 使用 `latest` 标签 | 锁定具体版本 |

#### 模块耦合度评分

| 模块 | 评分 (1-10) | 说明 |
|------|-------------|------|
| `agent/agent.ts` | **9** | 依赖 6+ 个同级模块，是核心枢纽 |
| `tool/task.ts` | **8** | 反向依赖 agent，创建子 Agent |
| `session/index.ts` | **6** | 依赖 memory 和 providers |
| `eventbus/eventbus.ts` | **1** | 完全独立 |

### C.4 类型安全分析

#### `any` 类型使用统计

- 总计: **133 处** `any` 使用，分布在 28 个文件
- 高风险: 函数返回值/参数使用 `any` (10 处)
- 工具类: `BaseTool<any>` (4 处)
- 类型断言: `as any` (70+ 处)

#### 类型定义问题

| 问题 | 文件 | 建议 |
|------|------|------|
| Message 类型不完整 | `session/types.ts` | 添加 `tool_calls`, `reasoning_content` |
| 泛型遮蔽 | `tool/base.ts:64` | `result<T>` 改为 `result<M>` |
| 重复类型定义 | 多处 | 统一 ToolCall 类型 |

### C.5 测试覆盖率分析

#### 当前状态

- **测试文件**: 23 个
- **测试用例**: 511 个
- **估算覆盖率**: 40-50%
- **单元/集成比**: 1.5:1

#### 缺少测试的关键模块

| 模块 | 关键程度 | 估算工作量 |
|------|---------|-----------|
| `agent/agent.ts` | 高 | 3-5 天 |
| `tool/bash.ts` | 高 | 2-3 天 |
| `session/index.ts` | 高 | 2-3 天 |
| `tool/registry.ts` | 中 | 1-2 天 |
| `http/client.ts` | 中 | 1-2 天 |

### C.6 代码质量问题汇总

| 类别 | 数量 | 严重程度 |
|------|------|----------|
| 安全问题 | 5 | 🔴 高 |
| 性能问题 | 8 | 🟡 中 |
| 类型安全问题 | 133 | 🟡 中 |
| 测试缺失 | 12 模块 | 🟡 中 |
| 依赖问题 | 4 | 🟢 低 |
| TODO/FIXME | 1 | 🟢 低 |

---

## 附录 D: 重构优先级矩阵

| 优先级 | 问题类别 | 具体问题 | 工作量 | 影响 |
|--------|----------|----------|--------|------|
| P0 | 安全 | 轮换 API 密钥 | 1h | 高 |
| P0 | 安全 | 路径遍历保护 | 2h | 高 |
| P0 | 依赖 | 移除 uuidv4 | 0.5h | 低 |
| P1 | 性能 | 全局 Map 清理 | 4h | 高 |
| P1 | 性能 | 异步文件读取 | 2h | 中 |
| P1 | 类型 | 扩展 Message 类型 | 4h | 高 |
| P1 | 类型 | 修复泛型遮蔽 | 2h | 中 |
| P2 | 架构 | Agent 依赖注入 | 8h | 高 |
| P2 | 架构 | TaskTool 工厂模式 | 8h | 高 |
| P2 | 测试 | 核心 Agent 测试 | 16h | 高 |
| P3 | 架构 | 分层架构重构 | 40h | 高 |

---

*文档版本: 1.1*
*最后更新: 2026-02-22*
*深度分析完成*
