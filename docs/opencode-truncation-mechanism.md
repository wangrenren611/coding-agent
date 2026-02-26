# OpenCode 输出截断机制

> 文档版本: 1.0  
> 基于文件: `/packages/opencode/src/tool/truncation.ts`  
> 最后更新: 2025-02-26

---

## 目录

1. [概述](#1-概述)
2. [架构设计](#2-架构设计)
3. [核心类型定义](#3-核心类型定义)
4. [截断算法详解](#4-截断算法详解)
5. [文件生命周期管理](#5-文件生命周期管理)
6. [智能提示生成](#6-智能提示生成)
7. [与工具系统的集成](#7-与工具系统的集成)
8. [配置选项](#8-配置选项)
9. [使用示例](#9-使用示例)
10. [最佳实践](#10-最佳实践)

---

## 1. 概述

### 1.1 设计目标

输出截断机制旨在解决 AI 编码助手中工具输出过长的问题：

- **上下文保护**：防止单个工具输出占用过多 token
- **信息保留**：完整输出保存到文件，支持后续访问
- **智能引导**：根据 Agent 权限提供不同的处理建议

### 1.2 核心功能

| 功能 | 描述 |
|------|------|
| 自动截断 | 超过限制时自动截断输出 |
| 双重限制 | 同时支持行数和字节数限制 |
| 方向控制 | 支持保留头部或尾部内容 |
| 文件持久化 | 完整内容保存到本地文件 |
| 智能提示 | 根据权限生成不同引导信息 |
| 自动清理 | 过期文件自动删除 |

---

## 2. 架构设计

### 2.1 模块结构

```
Truncate Namespace
│
├── 常量定义
│   ├── MAX_LINES = 2000        # 默认最大行数
│   ├── MAX_BYTES = 50 * 1024   # 默认最大字节 (50KB)
│   ├── DIR                     # 截断文件存储目录
│   ├── GLOB                    # 文件匹配模式
│   └── RETENTION_MS            # 文件保留期限 (7天)
│
├── 类型定义
│   ├── Result                  # 截断结果 (判别联合)
│   └── Options                 # 截断选项
│
├── 核心函数
│   ├── output()                # 截断输出
│   └── cleanup()               # 清理过期文件
│
└── 辅助函数
    ├── hasTaskTool()           # 检查 Task 工具权限
    └── init (lazy)             # 惰性初始化清理
```

### 2.2 依赖关系

```
┌─────────────────┐
│  Truncate       │
└───────┬─────────┘
        │
        ├── fs/promises          # 文件操作
        ├── path                 # 路径处理
        ├── Global.Path          # 全局路径配置
        ├── Identifier           # ID 生成
        ├── lazy                 # 惰性初始化
        ├── PermissionNext       # 权限评估
        └── Agent.Info           # Agent 信息
```

### 2.3 数据流

```
工具输出 (string)
       │
       ▼
┌─────────────────────────────────┐
│      Truncate.output()          │
├─────────────────────────────────┤
│  1. 检查行数限制 (2000行)        │
│  2. 检查字节限制 (50KB)          │
│  3. 未超限 → 直接返回            │
│  4. 超限 → 截断 + 保存文件       │
│  5. 生成智能提示                 │
└─────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│  Result                         │
│  ├── content: string            │
│  ├── truncated: boolean         │
│  └── outputPath?: string        │
└─────────────────────────────────┘
```

---

## 3. 核心类型定义

### 3.1 截断结果 (Result)

使用**判别联合**（Discriminated Union）设计：

```typescript
export type Result =
  | { content: string; truncated: false }                    // 未截断
  | { content: string; truncated: true; outputPath: string } // 已截断
```

**设计优势**：

```typescript
const result = await Truncate.output(text)

if (result.truncated) {
  // TypeScript 自动收窄类型
  // result.outputPath 在此分支一定存在
  console.log(`完整输出保存在: ${result.outputPath}`)
} else {
  // 此分支没有 outputPath
  console.log('输出未截断')
}
```

### 3.2 截断选项 (Options)

```typescript
export interface Options {
  // 自定义最大行数 (默认 2000)
  maxLines?: number
  
  // 自定义最大字节数 (默认 50KB)
  maxBytes?: number
  
  // 截断方向：head 保留头部，tail 保留尾部
  direction?: "head" | "tail"
}
```

### 3.3 常量定义

```typescript
export namespace Truncate {
  // 默认最大行数
  export const MAX_LINES = 2000

  // 默认最大字节数 (50KB)
  export const MAX_BYTES = 50 * 1024

  // 截断文件存储目录
  export const DIR = path.join(Global.Path.data, "tool-output")

  // 截断文件匹配模式
  export const GLOB = path.join(DIR, "*")

  // 文件保留期限 (7天)
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
}
```

---

## 4. 截断算法详解

### 4.1 主函数流程

```typescript
export async function output(
  text: string, 
  options: Options = {}, 
  agent?: Agent.Info
): Promise<Result> {
  // 1. 获取限制值
  const maxLines = options.maxLines ?? MAX_LINES
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const direction = options.direction ?? "head"

  // 2. 计算当前输出大小
  const lines = text.split("\n")
  const totalBytes = Buffer.byteLength(text, "utf-8")

  // 3. 快速路径：未超限
  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false }
  }

  // 4. 执行截断
  // ...详见下方

  // 5. 保存完整输出到文件
  // ...

  // 6. 生成智能提示
  // ...

  // 7. 返回结果
  return { content: message, truncated: true, outputPath: filepath }
}
```

### 4.2 双重限制检查

截断机制同时检查**行数**和**字节数**两个维度：

```
┌────────────────────────────────────────────────────┐
│                双重限制检查                         │
├────────────────────────────────────────────────────┤
│                                                    │
│   行数检查                字节数检查               │
│   lines.length            Buffer.byteLength()      │
│       │                        │                   │
│       └────────┬───────────────┘                   │
│                │                                   │
│                ▼                                   │
│   ┌─────────────────────────┐                     │
│   │  任一超限则截断          │                     │
│   │  lines > 2000           │                     │
│   │  OR bytes > 50KB        │                     │
│   └─────────────────────────┘                     │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 4.3 头部截断算法

```typescript
if (direction === "head") {
  // 从头部开始截断
  for (i = 0; i < lines.length && i < maxLines; i++) {
    // 计算当前行的大小（包含换行符）
    const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
    
    // 检查字节限制
    if (bytes + size > maxBytes) {
      hitBytes = true
      break
    }
    
    out.push(lines[i])
    bytes += size
  }
}
```

**特点**：
- 逐行添加，直到达到行数或字节限制
- 字节计算包含换行符
- 记录是否因字节限制而截断

### 4.4 尾部截断算法

```typescript
else {
  // 从尾部开始截断
  for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    
    if (bytes + size > maxBytes) {
      hitBytes = true
      break
    }
    
    out.unshift(lines[i])  // 从前面插入，保持顺序
    bytes += size
  }
}
```

### 4.5 截断方向对比

| 方向 | 保留内容 | 适用场景 | 输出格式 |
|------|----------|----------|----------|
| `head` | 文件开头 | 代码文件、配置文件、日志开头 | `内容\n\n...N lines truncated...\n\n提示` |
| `tail` | 文件末尾 | 错误堆栈、最新日志、输出结果 | `...N lines truncated...\n\n提示\n\n内容` |

---

## 5. 文件生命周期管理

### 5.1 文件存储

```typescript
// 生成唯一文件 ID
const id = Identifier.ascending("tool")
const filepath = path.join(DIR, id)

// 保存完整输出到文件
await Bun.write(Bun.file(filepath), text)
```

**文件命名规则**：
- 格式：`tool_<timestamp>_<random>`
- 示例：`tool_20250226_abc123`
- 目录：`data/tool-output/`

### 5.2 自动清理机制

```typescript
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000  // 7天

export async function cleanup() {
  // 计算截止时间
  const cutoff = Identifier.timestamp(
    Identifier.create("tool", false, Date.now() - RETENTION_MS)
  )

  // 扫描截断文件
  const glob = new Bun.Glob("tool_*")
  const entries = await Array.fromAsync(
    glob.scan({ cwd: DIR, onlyFiles: true })
  ).catch(() => [])

  // 删除过期文件
  for (const entry of entries) {
    if (Identifier.timestamp(entry) >= cutoff) continue
    await fs.unlink(path.join(DIR, entry)).catch(() => {})
  }
}
```

### 5.3 惰性初始化

```typescript
// 使用 lazy 工具实现惰性初始化
const init = lazy(cleanup)

export async function output(...) {
  // ...
  
  // 确保清理任务已初始化（仅首次调用时执行）
  await init()
  
  // 继续截断逻辑...
}
```

**优势**：
- 避免启动时执行清理
- 仅在实际需要截断时才触发
- 单次执行，不重复

### 5.4 生命周期图示

```
┌─────────────────────────────────────────────────────────────┐
│                    截断文件生命周期                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   t=0                                                       │
│    │                                                        │
│    ▼                                                        │
│   ┌─────────────┐                                          │
│   │ 工具输出超限 │                                          │
│   └──────┬──────┘                                          │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────────────────────────────┐                  │
│   │ 1. 生成文件 ID (tool_xxxx)          │                  │
│   │ 2. 保存完整输出到 DIR/tool_xxxx     │                  │
│   │ 3. 返回截断内容 + 文件路径          │                  │
│   └─────────────────────────────────────┘                  │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────┐                                          │
│   │ 文件存储中   │◄─────────────────────────────────┐      │
│   └──────┬──────┘                                  │      │
│          │                                         │      │
│          │ 7天内可访问                             │      │
│          │                                         │      │
│   t=7天  ▼                                         │      │
│   ┌─────────────┐                                  │      │
│   │ cleanup()   │  惰性触发（下次截断时）           │      │
│   │ 删除过期文件 │                                  │      │
│   └─────────────┘                                  │      │
│                                                    │      │
│   ═════════════════════════════════════════════════│══════│
│                                                    │      │
│   注：cleanup 在首次 output() 调用时惰性初始化     │──────┘
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 智能提示生成

### 6.1 权限感知

```typescript
function hasTaskTool(agent?: Agent.Info): boolean {
  // 没有权限配置则认为没有权限
  if (!agent?.permission) return false

  // 评估 task 工具的权限
  const rule = PermissionNext.evaluate("task", "*", agent.permission)
  
  // 未拒绝则认为有权限
  return rule.action !== "deny"
}
```

### 6.2 差异化提示

```typescript
const hint = hasTaskTool(agent)
  ? `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}
Use the Task tool to have a subagent process this file with Grep and Read (with offset/limit). 
Do NOT read the full file yourself - delegate to save context.`
  : `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}
Use Grep to search the full content or Read with offset/limit to view specific sections.`
```

### 6.3 提示策略对比

| 条件 | 建议操作 | 设计意图 |
|------|----------|----------|
| 有 Task 工具权限 | 委托子 Agent 处理 | 保护主 Agent 上下文，提高效率 |
| 无 Task 工具权限 | 使用 Grep/Read 分段读取 | 提供可行的替代方案 |

### 6.4 输出消息格式

```typescript
// 头部截断格式
const message =
  `${preview}\n\n` +                    // 保留的内容
  `...${removed} ${unit} truncated...\n\n` + // 截断说明
  `${hint}`                              // 智能提示

// 尾部截断格式
const message =
  `...${removed} ${unit} truncated...\n\n` + // 截断说明
  `${hint}\n\n` +                        // 智能提示
  `${preview}`                           // 保留的内容
```

---

## 7. 与工具系统的集成

### 7.1 Tool.define 中的集成点

```typescript
export function define<Parameters extends z.ZodType, Result extends Metadata>(
  id: string,
  init: Info["init"] | Awaited<ReturnType<Info["init"]>>
): Info {
  return {
    id,
    init: async (initCtx) => {
      const toolInfo = init instanceof Function ? await init(initCtx) : init
      const execute = toolInfo.execute

      // 包装 execute 函数
      toolInfo.execute = async (args, ctx) => {
        // 1. 参数验证
        toolInfo.parameters.parse(args)

        // 2. 执行原始函数
        const result = await execute(args, ctx)

        // 3. 检查是否需要自动截断
        if (result.metadata.truncated !== undefined) {
          // 工具已自行处理截断，跳过
          return result
        }

        // 4. 自动截断
        const truncated = await Truncate.output(
          result.output, 
          {}, 
          initCtx?.agent  // 传入 Agent 信息用于智能提示
        )

        return {
          ...result,
          output: truncated.content,
          metadata: {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          },
        }
      }
      return toolInfo
    },
  }
}
```

### 7.2 工具自行处理截断

工具可以通过设置 `metadata.truncated` 绕过自动截断：

```typescript
export const CustomTool = Tool.define("custom", {
  // ...
  async execute(args, ctx) {
    const output = generateLargeOutput()
    
    // 自行处理截断逻辑
    const truncated = await Truncate.output(output, { 
      maxLines: 1000,
      direction: "tail" 
    }, ctx.extra?.agent)

    return {
      title: "Custom Tool Result",
      output: truncated.content,
      metadata: {
        truncated: truncated.truncated,  // 设置此字段绕过自动截断
        customPath: truncated.truncated ? truncated.outputPath : undefined,
      },
    }
  },
})
```

### 7.3 集成流程图

```
┌─────────────────────────────────────────────────────────────┐
│                 Tool.define 执行流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Agent 调用工具                                            │
│         │                                                   │
│         ▼                                                   │
│   ┌─────────────────────────────────────┐                  │
│   │ 1. Zod 参数验证                      │                  │
│   └──────────────────┬──────────────────┘                  │
│                      │                                      │
│                      ▼                                      │
│   ┌─────────────────────────────────────┐                  │
│   │ 2. execute(args, ctx)               │                  │
│   │    - 工具业务逻辑                    │                  │
│   │    - 返回 { title, output, metadata }│                  │
│   └──────────────────┬──────────────────┘                  │
│                      │                                      │
│                      ▼                                      │
│   ┌─────────────────────────────────────┐                  │
│   │ 3. 检查 metadata.truncated          │                  │
│   └──────────────────┬──────────────────┘                  │
│                      │                                      │
│          ┌───────────┴───────────┐                         │
│          │                       │                          │
│          ▼                       ▼                          │
│   已定义 (跳过)           未定义 (自动截断)                  │
│          │                       │                          │
│          │                       ▼                          │
│          │              ┌─────────────────────┐            │
│          │              │ Truncate.output()   │            │
│          │              │ - 检查限制          │            │
│          │              │ - 截断 + 保存       │            │
│          │              │ - 生成提示          │            │
│          │              └─────────┬───────────┘            │
│          │                        │                         │
│          └────────────┬───────────┘                         │
│                       │                                     │
│                       ▼                                     │
│   ┌─────────────────────────────────────┐                  │
│   │ 返回最终结果                         │                  │
│   │ {                                    │                  │
│   │   title,                             │                  │
│   │   output: (可能截断后的),            │                  │
│   │   metadata: { truncated, ... }       │                  │
│   │ }                                    │                  │
│   └─────────────────────────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. 配置选项

### 8.1 全局常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `MAX_LINES` | 2000 | 默认最大行数 |
| `MAX_BYTES` | 51200 (50KB) | 默认最大字节数 |
| `RETENTION_MS` | 604800000 (7天) | 文件保留期限 |

### 8.2 运行时选项

```typescript
interface Options {
  maxLines?: number      // 覆盖默认行数限制
  maxBytes?: number      // 覆盖默认字节限制
  direction?: "head" | "tail"  // 截断方向
}
```

### 8.3 使用示例

```typescript
// 自定义限制
const result = await Truncate.output(text, {
  maxLines: 500,
  maxBytes: 10 * 1024,  // 10KB
})

// 保留尾部
const result = await Truncate.output(errorStack, {
  direction: "tail",
  maxLines: 100,
})
```

---

## 9. 使用示例

### 9.1 基本使用

```typescript
import { Truncate } from "./truncation"

// 处理工具输出
const output = "..." // 假设是很长的输出

const result = await Truncate.output(output)

if (result.truncated) {
  console.log("输出已截断")
  console.log(`完整文件: ${result.outputPath}`)
} else {
  console.log("输出完整")
}
```

### 9.2 在工具中使用

```typescript
export const GrepTool = Tool.define("grep", {
  description: "搜索文件内容",
  parameters: z.object({
    pattern: z.string(),
    path: z.string(),
  }),
  async execute(args, ctx) {
    // 执行 grep 搜索
    const matches = await searchFiles(args.pattern, args.path)
    const output = formatMatches(matches)

    // 返回结果，让 Tool.define 自动处理截断
    return {
      title: `搜索结果: ${args.pattern}`,
      output,
      metadata: {
        matchCount: matches.length,
      },
    }
  },
})
```

### 9.3 自定义截断

```typescript
export const LogTool = Tool.define("logs", {
  description: "查看日志",
  parameters: z.object({
    service: z.string(),
    lines: z.number().optional(),
  }),
  async execute(args, ctx) {
    const logs = await readLogs(args.service)
    
    // 自定义截断：日志通常看尾部
    const result = await Truncate.output(logs, {
      direction: "tail",
      maxLines: args.lines ?? 500,
    })

    return {
      title: `${args.service} 日志`,
      output: result.content,
      metadata: {
        truncated: result.truncated,
        logPath: result.truncated ? result.outputPath : undefined,
      },
    }
  },
})
```

---

## 10. 最佳实践

### 10.1 截断方向选择

| 输出类型 | 推荐方向 | 原因 |
|----------|----------|------|
| 代码文件 | `head` | 导入和定义在开头 |
| 日志文件 | `tail` | 最新日志在末尾 |
| 错误堆栈 | `tail` | 关键信息在末尾 |
| 配置文件 | `head` | 主要配置在开头 |
| 搜索结果 | `head` | 最相关的在前 |

### 10.2 限制值设置

```typescript
// 推荐：根据输出类型调整
const PRESETS = {
  code: { maxLines: 2000, maxBytes: 50 * 1024 },
  log: { maxLines: 500, maxBytes: 20 * 1024, direction: "tail" },
  error: { maxLines: 100, maxBytes: 10 * 1024, direction: "tail" },
}
```

### 10.3 错误处理

```typescript
// 始终处理截断结果
const result = await Truncate.output(text)

if (result.truncated) {
  // 记录文件路径，供后续访问
  logger.info(`完整输出保存到: ${result.outputPath}`)
  
  // 在元数据中包含路径
  return {
    output: result.content,
    metadata: {
      truncated: true,
      fullOutputPath: result.outputPath,
    },
  }
}
```

### 10.4 性能考虑

1. **避免重复截断**：设置 `metadata.truncated` 绕过自动截断
2. **合理设置限制**：根据实际需求调整，避免过小导致频繁截断
3. **惰性清理**：清理任务仅在首次截断时触发

---

## 附录

### A. 文件结构

```
data/
└── tool-output/
    ├── tool_20250220_abc123   # 7天前 (待清理)
    ├── tool_20250221_def456   # 6天前
    ├── tool_20250225_ghi789   # 1天前
    └── tool_20250226_jkl012   # 今天
```

### B. 相关文件

- `src/tool/truncation.ts` - 截断模块实现
- `src/tool/tool.ts` - 工具定义，集成截断
- `src/permission/next.ts` - 权限系统，用于智能提示
- `src/agent/agent.ts` - Agent 信息类型

### C. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2025-02-26 | 初始版本 |
