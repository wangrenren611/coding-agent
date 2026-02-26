# OpenCode 权限系统

> 文档版本: 1.0  
> 基于文件: `/packages/opencode/src/permission/next.ts`  
> 最后更新: 2025-02-26

---

## 目录

1. [概述](#1-概述)
2. [架构设计](#2-架构设计)
3. [核心类型定义](#3-核心类型定义)
4. [规则匹配机制](#4-规则匹配机制)
5. [权限请求流程](#5-权限请求流程)
6. [用户响应处理](#6-用户响应处理)
7. [错误类型体系](#7-错误类型体系)
8. [状态管理](#8-状态管理)
9. [配置系统](#9-配置系统)
10. [与工具系统的集成](#10-与工具系统的集成)
11. [使用示例](#11-使用示例)
12. [最佳实践](#12-最佳实践)

---

## 1. 概述

### 1.1 设计目标

OpenCode 权限系统旨在为 AI 编码助手提供**细粒度的操作控制**：

- **安全保护**：防止 AI 执行危险或未授权的操作
- **灵活控制**：支持多种权限级别和模式匹配
- **用户体验**：最小化用户干预，同时保证安全
- **可追溯性**：记录权限决策和用户选择

### 1.2 核心特性

| 特性 | 描述 |
|------|------|
| 三级权限 | `allow` / `deny` / `ask` |
| 模式匹配 | 支持通配符匹配文件路径和命令 |
| 规则合并 | 多配置源自动合并，后规则优先 |
| 持久化记忆 | `always` 选择持久保存 |
| 级联处理 | 批量批准/拒绝相关请求 |
| 错误分类 | 区分停止执行和带反馈继续 |

### 1.3 权限模型

```
┌─────────────────────────────────────────────────────────────┐
│                      权限请求模型                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   权限类型 (permission)                                      │
│   ├── read      - 读取文件                                   │
│   ├── write     - 写入文件                                   │
│   ├── edit      - 编辑文件 (edit/write/patch/multiedit)     │
│   ├── bash      - 执行命令                                   │
│   ├── task      - 子任务委托                                 │
│   └── ...       - 其他工具权限                               │
│                                                             │
│   匹配模式 (pattern)                                         │
│   ├── *         - 匹配所有                                   │
│   ├── **/*.ts   - 匹配所有 TypeScript 文件                   │
│   ├── /src/*    - 匹配 src 目录下的文件                      │
│   ├── git *     - 匹配所有 git 命令                          │
│   └── ...                                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 架构设计

### 2.1 模块结构

```
PermissionNext Namespace
│
├── 核心类型
│   ├── Action              # 权限动作枚举
│   ├── Rule                # 权限规则
│   ├── Ruleset             # 规则集合
│   ├── Request             # 权限请求
│   └── Reply               # 用户响应
│
├── 事件定义
│   └── Event
│       ├── Asked           # 权限请求事件
│       └── Replied         # 响应事件
│
├── 核心函数
│   ├── fromConfig()        # 从配置加载规则
│   ├── merge()             # 合并规则集
│   ├── evaluate()          # 评估权限
│   ├── ask()               # 请求权限
│   ├── reply()             # 处理响应
│   ├── disabled()          # 获取禁用工具列表
│   └── list()              # 列出待处理请求
│
├── 错误类型
│   ├── RejectedError       # 用户拒绝（无消息）
│   ├── CorrectedError      # 用户拒绝（有反馈）
│   └── DeniedError         # 配置规则拒绝
│
└── 状态管理
    └── state()             # 实例状态（惰性）
```

### 2.2 依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                    PermissionNext                            │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │   Bus    │   │  Config  │   │ Storage  │
   │ 事件总线  │   │   配置    │   │  存储    │
   └──────────┘   └──────────┘   └──────────┘
         │               │               │
         │               │               │
         ▼               ▼               ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │BusEvent  │   │Instance  │   │Identifier│
   │事件定义   │   │ 实例管理  │   │ ID生成   │
   └──────────┘   └──────────┘   └──────────┘
                         │
                         ▼
                   ┌──────────┐
                   │ Wildcard │
                   │ 通配匹配  │
                   └──────────┘
```

### 2.3 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    权限处理数据流                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   工具执行 ──► ctx.ask() ──► evaluate()                      │
│                                │                            │
│                    ┌───────────┼───────────┐                │
│                    │           │           │                │
│                    ▼           ▼           ▼                │
│                 allow        deny        ask                │
│                    │           │           │                │
│                    │           │           ▼                │
│                    │           │    发布 Asked 事件          │
│                    │           │           │                │
│                    │           │           ▼                │
│                    │           │    等待用户响应            │
│                    │           │           │                │
│                    │           │    ┌──────┴──────┐         │
│                    │           │    │             │         │
│                    │           │    ▼             ▼         │
│                    │           │ once/always  reject        │
│                    │           │    │             │         │
│                    ▼           ▼    ▼             ▼         │
│                 继续      抛出错误  继续    抛出错误         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 核心类型定义

### 3.1 权限动作 (Action)

```typescript
export const Action = z.enum(["allow", "deny", "ask"]).meta({
  ref: "PermissionAction",
})

export type Action = z.infer<typeof Action>
```

| 动作 | 含义 | 执行影响 |
|------|------|----------|
| `allow` | 允许执行 | 直接继续，无需用户确认 |
| `deny` | 拒绝执行 | 抛出 `DeniedError`，停止执行 |
| `ask` | 需要确认 | 发布事件等待用户响应 |

### 3.2 权限规则 (Rule)

```typescript
export const Rule = z.object({
  permission: z.string(),   // 权限类型
  pattern: z.string(),      // 匹配模式
  action: Action,           // 动作
}).meta({
  ref: "PermissionRule",
})

export type Rule = z.infer<typeof Rule>
```

**示例规则**：

```typescript
// 允许读取所有文件
{ permission: "read", pattern: "*", action: "allow" }

// 拒绝读取 .env 文件
{ permission: "read", pattern: "*.env", action: "deny" }

// 写入需要确认
{ permission: "write", pattern: "*", action: "ask" }

// 允许所有 git 命令
{ permission: "bash", pattern: "git *", action: "allow" }
```

### 3.3 规则集合 (Ruleset)

```typescript
export const Ruleset = Rule.array().meta({
  ref: "PermissionRuleset",
})

export type Ruleset = z.infer<typeof Ruleset>
```

**规则优先级**：数组中**后面的规则优先级更高**（使用 `findLast` 匹配）。

### 3.4 权限请求 (Request)

```typescript
export const Request = z.object({
  id: Identifier.schema("permission"),     // 请求 ID
  sessionID: Identifier.schema("session"), // 会话 ID
  permission: z.string(),                   // 权限类型
  patterns: z.string().array(),             // 匹配模式列表
  metadata: z.record(z.string(), z.any()),  // 元数据
  always: z.string().array(),               // "always" 时应用的 pattern
  tool: z.object({                          // 工具信息（可选）
    messageID: z.string(),
    callID: z.string(),
  }).optional(),
}).meta({
  ref: "PermissionRequest",
})

export type Request = z.infer<typeof Request>
```

### 3.5 用户响应 (Reply)

```typescript
export const Reply = z.enum(["once", "always", "reject"])
export type Reply = z.infer<typeof Reply>
```

| 响应 | 含义 | 效果 |
|------|------|------|
| `once` | 本次允许 | 仅当前请求允许，下次仍需确认 |
| `always` | 始终允许 | 添加持久规则，后续自动允许 |
| `reject` | 拒绝 | 拒绝当前请求 |

### 3.6 事件定义

```typescript
export const Event = {
  // 权限请求事件：需要用户确认时发布
  Asked: BusEvent.define("permission.asked", Request),
  
  // 响应事件：用户响应后发布
  Replied: BusEvent.define(
    "permission.replied",
    z.object({
      sessionID: z.string(),
      requestID: z.string(),
      reply: Reply,
    }),
  ),
}
```

---

## 4. 规则匹配机制

### 4.1 评估函数

```typescript
export function evaluate(
  permission: string,   // 请求的权限类型
  pattern: string,      // 请求的匹配模式
  ...rulesets: Ruleset[] // 可变规则集参数
): Rule {
  // 1. 合并所有规则集
  const merged = merge(...rulesets)
  
  // 2. 使用 findLast 查找匹配规则
  const match = merged.findLast(
    (rule) => Wildcard.match(permission, rule.permission) 
           && Wildcard.match(pattern, rule.pattern)
  )
  
  // 3. 默认行为：ask（安全优先）
  return match ?? { action: "ask", permission, pattern: "*" }
}
```

**关键设计**：
- 使用 `findLast`：后面的规则覆盖前面的
- 默认返回 `ask`：无匹配时需要用户确认

### 4.2 通配符匹配

通过 `Wildcard.match()` 实现 Shell 风格的通配符匹配：

```typescript
// 来自 src/util/wildcard.ts
export function match(str: string, pattern: string) {
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // 转义正则特殊字符
    .replace(/\*/g, ".*")                   // * → .*（任意字符序列）
    .replace(/\?/g, ".")                    // ? → .（单个字符）

  // 特殊处理：" *" 结尾使尾部可选
  // 例如 "git *" 可以匹配 "git" 和 "git status"
  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?"
  }

  return new RegExp("^" + escaped + "$", "s").test(str)
}
```

### 4.3 匹配示例

| pattern | 输入 | 匹配结果 |
|---------|------|----------|
| `*` | 任意字符串 | ✅ 匹配 |
| `*.ts` | `src/index.ts` | ✅ 匹配 |
| `*.ts` | `src/index.js` | ❌ 不匹配 |
| `**/*.ts` | `a/b/c/index.ts` | ✅ 匹配 |
| `src/*` | `src/index.ts` | ✅ 匹配 |
| `src/*` | `test/index.ts` | ❌ 不匹配 |
| `git *` | `git` | ✅ 匹配（尾部可选） |
| `git *` | `git status` | ✅ 匹配 |
| `git *` | `npm install` | ❌ 不匹配 |
| `rm -rf *` | `rm -rf /tmp` | ✅ 匹配 |

### 4.4 规则合并

```typescript
export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}
```

**合并顺序**（从低到高优先级）：

```
默认规则 → 全局配置 → 项目配置 → Agent 配置 → 已批准规则
```

---

## 5. 权限请求流程

### 5.1 ask 函数

```typescript
export const ask = fn(
  Request.partial({ id: true }).extend({
    ruleset: Ruleset,  // 额外的规则集参数
  }),
  async (input) => {
    const s = await state()
    const { ruleset, ...request } = input

    // 遍历所有 pattern
    for (const pattern of request.patterns ?? []) {
      // 评估权限
      const rule = evaluate(
        request.permission, 
        pattern, 
        ruleset,           // 传入的规则集
        s.approved         // 已批准的规则
      )
      
      log.info("evaluated", { permission: request.permission, pattern, action: rule })

      // 处理不同动作
      if (rule.action === "deny") {
        throw new DeniedError(
          ruleset.filter((r) => Wildcard.match(request.permission, r.permission))
        )
      }
      
      if (rule.action === "ask") {
        const id = input.id ?? Identifier.ascending("permission")
        
        // 返回 Promise，等待用户响应
        return new Promise<void>((resolve, reject) => {
          const info: Request = { id, ...request }
          
          s.pending[id] = {
            info,
            resolve,
            reject,
          }
          
          // 发布事件通知 UI
          Bus.publish(Event.Asked, info)
        })
      }
      
      // allow: 继续检查下一个 pattern
      if (rule.action === "allow") continue
    }
  },
)
```

### 5.2 请求流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    ask() 请求流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ctx.ask({ permission, patterns, always, metadata })       │
│         │                                                   │
│         ▼                                                   │
│   ┌─────────────────────────────────────┐                  │
│   │ for (pattern of patterns) {         │                  │
│   │   const rule = evaluate(...)        │                  │
│   │                                     │                  │
│   │   switch (rule.action) {            │                  │
│   └──────────────────┬──────────────────┘                  │
│                      │                                      │
│         ┌────────────┼────────────┐                        │
│         │            │            │                        │
│         ▼            ▼            ▼                        │
│      "deny"       "ask"       "allow"                      │
│         │            │            │                        │
│         │            │            │                        │
│         ▼            │            │                        │
│   ┌──────────┐       │            │                        │
│   │ throw    │       │            │                        │
│   │DeniedError│      │            │                        │
│   └──────────┘       │            │                        │
│         │            │            │                        │
│         ▼            ▼            ▼                        │
│      停止执行    ┌──────────┐   继续循环                    │
│                  │ 发布事件 │     │                        │
│                  │ 等待响应 │     │                        │
│                  └────┬─────┘     │                        │
│                       │           │                        │
│              ┌────────┴────────┐  │                        │
│              │                 │  │                        │
│              ▼                 ▼  │                        │
│           resolve          reject │                        │
│              │                 │  │                        │
│              ▼                 ▼  │                        │
│           继续执行          抛出错误│                        │
│                             │    │                        │
│                             ▼    ▼                        │
│                          停止执行                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 用户响应处理

### 6.1 reply 函数

```typescript
export const reply = fn(
  z.object({
    requestID: Identifier.schema("permission"),
    reply: Reply,
    message: z.string().optional(),  // reject 时的反馈消息
  }),
  async (input) => {
    const s = await state()
    const existing = s.pending[input.requestID]
    
    if (!existing) return  // 请求不存在，忽略
    
    // 从待处理列表移除
    delete s.pending[input.requestID]
    
    // 发布响应事件
    Bus.publish(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      reply: input.reply,
    })

    switch (input.reply) {
      case "reject":
        handleReject(existing, input.message, s)
        break
      case "once":
        existing.resolve()
        break
      case "always":
        handleAlways(existing, s)
        break
    }
  },
)
```

### 6.2 reject 处理

```typescript
function handleReject(existing, message, s) {
  // 有消息用 CorrectedError，否则用 RejectedError
  const error = message 
    ? new CorrectedError(message) 
    : new RejectedError()
  
  existing.reject(error)
  
  // 级联拒绝：拒绝同会话的所有待处理请求
  const sessionID = existing.info.sessionID
  for (const [id, pending] of Object.entries(s.pending)) {
    if (pending.info.sessionID === sessionID) {
      delete s.pending[id]
      Bus.publish(Event.Replied, {
        sessionID: pending.info.sessionID,
        requestID: pending.info.id,
        reply: "reject",
      })
      pending.reject(new RejectedError())
    }
  }
}
```

### 6.3 always 处理

```typescript
function handleAlways(existing, s) {
  // 添加到已批准列表
  for (const pattern of existing.info.always) {
    s.approved.push({
      permission: existing.info.permission,
      pattern,
      action: "allow",
    })
  }

  existing.resolve()

  // 级联批准：自动解决现在已满足的请求
  const sessionID = existing.info.sessionID
  for (const [id, pending] of Object.entries(s.pending)) {
    if (pending.info.sessionID !== sessionID) continue
    
    // 检查所有 pattern 是否现在都被允许
    const ok = pending.info.patterns.every(
      (pattern) => evaluate(
        pending.info.permission, 
        pattern, 
        s.approved
      ).action === "allow"
    )
    
    if (ok) {
      delete s.pending[id]
      Bus.publish(Event.Replied, {
        sessionID: pending.info.sessionID,
        requestID: pending.info.id,
        reply: "always",
      })
      pending.resolve()
    }
  }
}
```

### 6.4 响应处理流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    reply() 处理流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   用户响应: { requestID, reply, message? }                   │
│         │                                                   │
│         ▼                                                   │
│   ┌─────────────────────────────────────┐                  │
│   │ 获取 pending[requestID]             │                  │
│   └──────────────────┬──────────────────┘                  │
│                      │                                      │
│          ┌───────────┼───────────┐                         │
│          │           │           │                         │
│          ▼           ▼           ▼                         │
│       reject       once       always                       │
│          │           │           │                         │
│          ▼           │           ▼                         │
│   ┌──────────────┐   │    ┌──────────────┐                │
│   │ 有消息?      │   │    │ 添加规则到    │                │
│   │ ├─是→Corrected│   │    │ approved     │                │
│   │ └─否→Rejected│   │    └───────┬──────┘                │
│   └───────┬──────┘   │            │                        │
│           │          │            ▼                        │
│           ▼          │    ┌──────────────┐                │
│   ┌──────────────┐   │    │ 级联批准:     │                │
│   │ reject(error)│   │    │ 检查其他待处理 │                │
│   └───────┬──────┘   │    │ 请求是否现在   │                │
│           │          │    │ 满足条件       │                │
│           ▼          │    └───────┬──────┘                │
│   ┌──────────────┐   │            │                        │
│   │ 级联拒绝:     │   │            ▼                        │
│   │ 拒绝同会话    │   │    ┌──────────────┐                │
│   │ 所有待处理    │   │    │ 自动解决     │                │
│   │ 请求         │   │    │ 满足的请求    │                │
│   └──────────────┘   │    └──────────────┘                │
│                      │                                     │
│                      ▼                                     │
│               resolve()                                    │
│               (继续执行)                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 错误类型体系

### 7.1 三种错误类型

```typescript
/** 用户拒绝无消息 - 停止执行 */
export class RejectedError extends Error {
  constructor() {
    super(`The user rejected permission to use this specific tool call.`)
  }
}

/** 用户拒绝有反馈 - 继续执行（带指导） */
export class CorrectedError extends Error {
  constructor(message: string) {
    super(
      `The user rejected permission to use this specific tool call ` +
      `with the following feedback: ${message}`
    )
  }
}

/** 配置规则自动拒绝 - 停止执行 */
export class DeniedError extends Error {
  constructor(public readonly ruleset: Ruleset) {
    super(
      `The user has specified a rule which prevents you from using ` +
      `this specific tool call. Here are some of the relevant rules ` +
      `${JSON.stringify(ruleset)}`
    )
  }
}
```

### 7.2 错误对比

| 错误类型 | 触发条件 | 执行影响 | 消息来源 |
|----------|----------|----------|----------|
| `DeniedError` | 配置规则 `deny` | **停止执行** | 系统配置 |
| `RejectedError` | 用户拒绝无消息 | **停止执行** | 用户 |
| `CorrectedError` | 用户拒绝有反馈 | **继续执行** | 用户 |

### 7.3 错误处理示例

```typescript
try {
  await ctx.ask({
    permission: "write",
    patterns: [filePath],
    always: ["*"],
    metadata: {},
  })
  
  // 执行写入操作...
  
} catch (e) {
  if (e instanceof PermissionNext.DeniedError) {
    // 配置规则拒绝，告知用户无法执行
    return {
      output: `写入被配置规则拒绝。相关规则: ${JSON.stringify(e.ruleset)}`,
      metadata: {},
    }
  }
  
  if (e instanceof PermissionNext.CorrectedError) {
    // 用户拒绝但有反馈，可以根据反馈调整行为
    return {
      output: `写入被拒绝。用户反馈: ${e.message}`,
      metadata: { userFeedback: e.message },
    }
  }
  
  if (e instanceof PermissionNext.RejectedError) {
    // 用户直接拒绝，停止执行
    throw e  // 重新抛出，让上层处理
  }
  
  throw e  // 其他错误重新抛出
}
```

---

## 8. 状态管理

### 8.1 状态结构

```typescript
const state = Instance.state(async () => {
  const projectID = Instance.project.id
  const stored = await Storage.read<Ruleset>(
    ["permission", projectID]
  ).catch(() => [])

  const pending: Record<string, {
    info: Request
    resolve: () => void
    reject: (e: any) => void
  }> = {}

  return {
    pending,      // 等待用户响应的请求
    approved: stored,  // 已持久化的 "always" 规则
  }
})
```

### 8.2 状态生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                    状态生命周期                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │                    state()                          │  │
│   │  ┌─────────────┐    ┌─────────────┐                │  │
│   │  │   pending   │    │  approved   │                │  │
│   │  │  (内存)     │    │ (持久化)    │                │  │
│   │  └──────┬──────┘    └──────┬──────┘                │  │
│   │         │                  │                        │  │
│   │         │                  ▼                        │  │
│   │         │          ┌─────────────┐                 │  │
│   │         │          │ Storage.read │                 │  │
│   │         │          │ (项目级别)   │                 │  │
│   │         │          └─────────────┘                 │  │
│   │         │                                           │  │
│   │         ▼                                           │  │
│   │  ┌─────────────────────────────────┐               │  │
│   │  │ ask() → 添加到 pending          │               │  │
│   │  │ reply() → 从 pending 移除       │               │  │
│   │  │ always → 添加到 approved        │               │  │
│   │  └─────────────────────────────────┘               │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 惰性初始化

```typescript
// 使用 Instance.state 实现惰性初始化
// 首次调用 state() 时才执行初始化函数
// 后续调用返回缓存的 Promise
const state = Instance.state(async () => {
  // 仅在首次访问时执行
  const projectID = Instance.project.id
  const stored = await Storage.read<Ruleset>(["permission", projectID])
    .catch(() => [])
  
  return {
    pending: {},
    approved: stored,
  }
})
```

---

## 9. 配置系统

### 9.1 配置格式

```typescript
// opencode.jsonc
{
  "permission": {
    // 简写形式：所有操作统一设置
    "read": "allow",
    
    // 详细形式：按模式细分
    "write": {
      "*.ts": "allow",      // TypeScript 文件允许
      "*.env": "deny",      // 环境文件禁止
      "*": "ask"            // 其他需要确认
    },
    
    // bash 命令控制
    "bash": {
      "git *": "allow",     // Git 命令允许
      "npm *": "allow",     // NPM 命令允许
      "rm *": "deny",       // 删除命令禁止
      "sudo *": "deny",     // sudo 命令禁止
      "*": "ask"            // 其他需要确认
    }
  }
}
```

### 9.2 配置解析

```typescript
export function fromConfig(permission: Config.Permission): Ruleset {
  const ruleset: Ruleset = []
  
  for (const [key, value] of Object.entries(permission)) {
    // 简写形式："read": "allow"
    if (typeof value === "string") {
      ruleset.push({
        permission: key,
        action: value,
        pattern: "*",
      })
      continue
    }
    
    // 详细形式："write": { "*.ts": "allow", ... }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({
        permission: key,
        pattern,
        action,
      }))
    )
  }
  
  return ruleset
}
```

### 9.3 配置优先级

```
┌─────────────────────────────────────────────────────────────┐
│                    配置加载优先级                            │
│                    (从低到高)                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. 远程/Well-known 配置    (组织级默认)                    │
│              ↓                                              │
│   2. 全局用户配置             (~/.config/opencode/)          │
│              ↓                                              │
│   3. 自定义配置路径           (OPENCODE_CONFIG)              │
│              ↓                                              │
│   4. 项目配置                 (opencode.jsonc/json)          │
│              ↓                                              │
│   5. 内联配置                 (OPENCODE_CONFIG_CONTENT)      │
│              ↓                                              │
│   6. .opencode 目录配置       (从工作树向上查找)              │
│              ↓                                              │
│   7. Agent 特定配置           (每个 Agent 独立)              │
│              ↓                                              │
│   8. 用户 "always" 选择       (运行时持久化)                 │
│                                                             │
│   后面的配置覆盖前面的配置                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.4 编辑工具映射

```typescript
const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  
  for (const tool of tools) {
    // 编辑类工具统一映射到 "edit" 权限
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    
    const rule = ruleset.findLast(
      (r) => Wildcard.match(permission, r.permission)
    )
    
    if (!rule) continue
    
    // 只有 pattern=* 且 action=deny 才禁用
    if (rule.pattern === "*" && rule.action === "deny") {
      result.add(tool)
    }
  }
  
  return result
}
```

---

## 10. 与工具系统的集成

### 10.1 工具上下文中的 ask 方法

```typescript
// tool.ts
export type Context<M extends Metadata = Metadata> = {
  // ...
  
  // 请求用户权限
  ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
}
```

### 10.2 工具中的权限请求示例

```typescript
// read.ts
export const ReadTool = Tool.define("read", {
  description: "读取文件内容",
  parameters: z.object({
    filePath: z.string(),
  }),
  
  async execute(params, ctx) {
    const filepath = resolvePath(params.filePath)
    
    // 请求读取权限
    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],  // 用户选 "always" 时应用到所有文件
      metadata: {},
    })
    
    // 继续读取文件...
    const content = await readFile(filepath)
    
    return {
      title: path.basename(filepath),
      output: content,
      metadata: {},
    }
  },
})
```

### 10.3 多模式权限请求

```typescript
// bash.ts
export const BashTool = Tool.define("bash", {
  // ...
  async execute(params, ctx) {
    const command = params.command
    
    // 请求执行权限
    await ctx.ask({
      permission: "bash",
      patterns: [command],       // 检查完整命令
      always: [extractBaseCommand(command)],  // "always" 只应用到基础命令
      metadata: {
        command,
        cwd: process.cwd(),
      },
    })
    
    // 执行命令...
  },
})
```

### 10.4 集成流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    工具执行中的权限检查                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Tool.define("read", {                                     │
│     async execute(args, ctx) {                              │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ 1. 准备参数                                          │  │
│   │    const filepath = resolvePath(args.filePath)       │  │
│   └────────────────────────┬────────────────────────────┘  │
│                            │                               │
│                            ▼                               │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ 2. 请求权限                                          │  │
│   │    await ctx.ask({                                   │  │
│   │      permission: "read",                             │  │
│   │      patterns: [filepath],                           │  │
│   │      always: ["*"],                                  │  │
│   │      metadata: {}                                    │  │
│   │    })                                                │  │
│   └────────────────────────┬────────────────────────────┘  │
│                            │                               │
│                ┌───────────┴───────────┐                   │
│                │                       │                   │
│                ▼                       ▼                   │
│           权限允许                  权限拒绝                │
│                │                       │                   │
│                ▼                       ▼                   │
│   ┌─────────────────────┐    ┌─────────────────────┐      │
│   │ 3. 继续执行          │    │ 抛出错误            │      │
│   │    readFile(path)   │    │ 停止执行            │      │
│   └─────────────────────┘    └─────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. 使用示例

### 11.1 基本权限请求

```typescript
// 在工具中请求权限
await ctx.ask({
  permission: "read",
  patterns: ["/path/to/file.ts"],
  always: ["*"],
  metadata: {},
})
```

### 11.2 多文件权限请求

```typescript
// 批量检查多个文件
await ctx.ask({
  permission: "read",
  patterns: [
    "/src/index.ts",
    "/src/utils.ts",
    "/src/config.ts",
  ],
  always: ["*"],
  metadata: { operation: "batch-read" },
})
```

### 11.3 处理权限错误

```typescript
try {
  await ctx.ask({
    permission: "write",
    patterns: [filePath],
    always: ["*"],
    metadata: {},
  })
  
  await writeFile(filePath, content)
  
} catch (e) {
  if (PermissionNext.DeniedError.isInstance(e)) {
    return {
      output: `写入被配置规则拒绝。请检查权限配置。`,
      metadata: { denied: true },
    }
  }
  
  if (PermissionNext.CorrectedError.isInstance(e)) {
    // 用户提供了反馈，可以根据反馈调整
    return {
      output: `操作已取消。用户建议: ${e.message}`,
      metadata: { cancelled: true, feedback: e.message },
    }
  }
  
  throw e
}
```

### 11.4 UI 集成示例

```typescript
// 监听权限请求事件
Bus.subscribe(PermissionNext.Event.Asked, async (request) => {
  // 显示权限对话框
  const response = await showPermissionDialog({
    title: `权限请求: ${request.permission}`,
    message: `是否允许 ${request.permission} 操作？`,
    patterns: request.patterns,
  })
  
  // 发送响应
  await PermissionNext.reply({
    requestID: request.id,
    reply: response.reply,
    message: response.message,
  })
})

// 监听响应事件
Bus.subscribe(PermissionNext.Event.Replied, (event) => {
  console.log(`权限请求 ${event.requestID} 已响应: ${event.reply}`)
})
```

---

## 12. 最佳实践

### 12.1 权限配置建议

```jsonc
{
  "permission": {
    // 读取：通常可以放宽
    "read": "allow",
    
    // 写入：根据项目敏感度调整
    "write": {
      "src/**/*": "allow",      // 源码允许
      "docs/**/*": "allow",     // 文档允许
      "*.env": "deny",          // 环境文件禁止
      "*.key": "deny",          // 密钥文件禁止
      "*": "ask"                // 其他确认
    },
    
    // bash：谨慎控制
    "bash": {
      "git *": "allow",         // Git 安全
      "npm *": "allow",         // NPM 安全
      "pnpm *": "allow",        // PNPM 安全
      "ls *": "allow",          // 列表安全
      "cat *": "allow",         // 查看安全
      "rm *": "deny",           // 删除危险
      "sudo *": "deny",         // sudo 危险
      "curl *": "ask",          // 网络请求需确认
      "*": "ask"                // 其他确认
    },
    
    // 子任务：根据需要
    "task": "ask"
  }
}
```

### 12.2 always 字段使用

```typescript
// 推荐：使用通配符，让用户选择时更灵活
await ctx.ask({
  permission: "read",
  patterns: [filePath],
  always: ["*"],  // 用户选 always 后，所有文件都可读
  metadata: {},
})

// 不推荐：过于具体，可能导致重复确认
await ctx.ask({
  permission: "read",
  patterns: [filePath],
  always: [filePath],  // 只对当前文件生效
  metadata: {},
})
```

### 12.3 模式设计建议

| 权限类型 | 推荐模式 | 原因 |
|----------|----------|------|
| `read` | `*` | 读取通常安全 |
| `write` | `*.ts`, `*.js`, `src/*` | 限制敏感文件 |
| `bash` | `git *`, `npm *`, `ls *` | 白名单安全命令 |
| `task` | `*` | 子任务本身有权限控制 |

### 12.4 错误处理建议

```typescript
// 始终区分三种错误类型
try {
  await ctx.ask({ /* ... */ })
} catch (e) {
  if (PermissionNext.DeniedError.isInstance(e)) {
    // 配置拒绝：告知用户修改配置
    return formatDeniedError(e)
  }
  
  if (PermissionNext.CorrectedError.isInstance(e)) {
    // 用户反馈：可能需要调整行为
    return formatCorrectedError(e)
  }
  
  if (PermissionNext.RejectedError.isInstance(e)) {
    // 用户拒绝：简单告知
    return formatRejectedError()
  }
  
  // 未知错误：重新抛出
  throw e
}
```

---

## 附录

### A. 权限类型参考

| 权限 | 说明 | 常用模式 |
|------|------|----------|
| `read` | 读取文件 | `*`, `*.ts`, `src/*` |
| `write` | 写入文件 | `*.ts`, `*.json`, `!*.env` |
| `edit` | 编辑文件（write/patch/multiedit） | `*.ts`, `src/*` |
| `bash` | 执行命令 | `git *`, `npm *`, `rm *` |
| `task` | 子任务委托 | `*` |
| `grep` | 搜索文件 | `*` |
| `glob` | 文件匹配 | `*` |

### B. 相关文件

- `src/permission/next.ts` - 权限系统实现
- `src/util/wildcard.ts` - 通配符匹配
- `src/config/config.ts` - 配置系统
- `src/tool/tool.ts` - 工具定义
- `src/bus/bus-event.ts` - 事件系统

### C. 事件参考

| 事件 | 触发时机 | 数据 |
|------|----------|------|
| `permission.asked` | 需要用户确认时 | `Request` |
| `permission.replied` | 用户响应后 | `{ sessionID, requestID, reply }` |

### D. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2025-02-26 | 初始版本 |
